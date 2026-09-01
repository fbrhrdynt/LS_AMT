# RBAC (viewer/technician) + user management + Excel import wizard
import io
import time

import pytest
import requests

STAMP = str(int(time.time()))
VIEWER = {"email": f"test_viewer_{STAMP}@example.com", "name": "TEST Viewer", "password": "Viewer@12345", "role": "viewer"}
TECH = {"email": f"test_tech_{STAMP}@example.com", "name": "TEST Tech", "password": "Tech@12345", "role": "technician"}


@pytest.fixture(scope="module")
def users(admin, base_url):
    created = {}
    for body in (VIEWER, TECH):
        r = admin.post(f"{base_url}/api/users", json=body, timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["role"] == body["role"] and "password_hash" not in d
        created[body["role"]] = d
    yield created
    for d in created.values():
        admin.delete(f"{base_url}/api/users/{d['id']}", timeout=60)


def _session(base_url, email, password):
    s = requests.Session()
    r = s.post(f"{base_url}/api/auth/login", json={"email": email, "password": password}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    return s


def test_viewer_can_read_but_not_write(base_url, users):
    s = _session(base_url, VIEWER["email"], VIEWER["password"])
    assert s.get(f"{base_url}/api/dashboard", timeout=90).status_code == 200
    assert s.get(f"{base_url}/api/equipment", timeout=60).status_code == 200
    forbidden = [
        ("post", "/api/clients", {"name": "TEST_x"}),
        ("post", "/api/jobs", {"job_name": "TEST_x", "client_id": "x"}),
        ("post", "/api/equipment", {"sap_no": f"TEST{STAMP}"}),
        ("post", "/api/inventory", {"item_code": f"TEST{STAMP}", "item_name": "x"}),
        ("post", "/api/maintenance", {"equipment_id": "x"}),
    ]
    for method, path, body in forbidden:
        r = getattr(s, method)(f"{base_url}{path}", json=body, timeout=60)
        assert r.status_code == 403, f"{path} -> {r.status_code}"
    assert s.get(f"{base_url}/api/users", timeout=60).status_code == 403


def test_technician_can_create_maintenance_but_not_manage(base_url, admin, users):
    s = _session(base_url, TECH["email"], TECH["password"])
    eq = admin.get(f"{base_url}/api/equipment", params={"page_size": 1}, timeout=60).json()["items"][0]
    r = s.post(f"{base_url}/api/maintenance", json={
        "equipment_id": eq["id"], "problem_damage": "TEST_tech problem",
        "failure_found": "TEST_tech failure", "lead_technician": TECH["name"]}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    mid = r.json()["id"]
    c = s.post(f"{base_url}/api/maintenance/{mid}/close", json={"final_condition": "Good"}, timeout=60)
    assert c.status_code == 200, c.text[:300]
    # technician cannot manage equipment/clients or reopen
    assert s.post(f"{base_url}/api/clients", json={"name": "TEST_y"}, timeout=60).status_code == 403
    assert s.post(f"{base_url}/api/maintenance/{mid}/reopen", timeout=60).status_code == 403


def test_admin_can_change_role(admin, base_url, users):
    uid = users["viewer"]["id"]
    r = admin.patch(f"{base_url}/api/users/{uid}/role", json={"role": "supervisor"}, timeout=60)
    assert r.status_code == 200
    lst = admin.get(f"{base_url}/api/users", timeout=60).json()
    assert next(u for u in lst if u["id"] == uid)["role"] == "supervisor"
    assert all("password_hash" not in u for u in lst)
    bad = admin.patch(f"{base_url}/api/users/{uid}/role", json={"role": "godmode"}, timeout=60)
    assert bad.status_code == 400
    admin.patch(f"{base_url}/api/users/{uid}/role", json={"role": "viewer"}, timeout=60)


def test_duplicate_user_rejected(admin, base_url, users):
    r = admin.post(f"{base_url}/api/users", json=VIEWER, timeout=60)
    assert r.status_code == 400


# ---- Excel import wizard ----
SEED = "/app/backend/seed_data/dashboard.xlsx"


def test_import_analyze_and_execute_skips_duplicates(admin, base_url):
    with open(SEED, "rb") as f:
        data = f.read()
    r = admin.post(f"{base_url}/api/import/analyze",
                   files={"file": ("dashboard.xlsx", io.BytesIO(data),
                                   "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
                   timeout=180)
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    assert d["equipment"]["total"] > 0
    assert d["equipment"]["duplicates"] > 0, "seeded data should be detected as duplicates"
    assert d["maintenance"]["duplicates"] > 0
    ex = admin.post(f"{base_url}/api/import/execute",
                    files={"file": ("dashboard.xlsx", io.BytesIO(data),
                                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
                    timeout=300)
    assert ex.status_code == 200, ex.text[:300]
    res = ex.json()
    assert res["maintenance_skipped"] > 0
    assert res["equipment_added"] == d["equipment"]["new"]


def test_import_rejects_non_excel(admin, base_url):
    r = admin.post(f"{base_url}/api/import/analyze",
                   files={"file": ("bad.txt", io.BytesIO(b"not-an-excel"), "text/plain")}, timeout=60)
    assert r.status_code == 400


def test_import_forbidden_for_viewer(base_url, users):
    s = _session(base_url, VIEWER["email"], VIEWER["password"])
    r = s.post(f"{base_url}/api/import/analyze",
               files={"file": ("bad.txt", io.BytesIO(b"x"), "text/plain")}, timeout=60)
    assert r.status_code == 403
