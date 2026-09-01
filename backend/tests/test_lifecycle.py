# Full lifecycle: client -> job -> assign -> maintenance(with parts) -> close -> stock -> pdf -> demob
import time

import pytest

STAMP = str(int(time.time()))


@pytest.fixture(scope="module")
def ctx():
    return {}


def test_01_create_client(admin, base_url, ctx):
    r = admin.post(f"{base_url}/api/clients", json={"name": f"TEST_Client_{STAMP}", "code": "TC"}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    assert d["name"] == f"TEST_Client_{STAMP}" and "_id" not in d
    ctx["client_id"] = d["id"]
    lst = admin.get(f"{base_url}/api/clients", timeout=60).json()
    assert any(c["id"] == d["id"] for c in lst)


def test_02_create_job_autonumber(admin, base_url, ctx):
    r = admin.post(f"{base_url}/api/jobs", json={"job_name": f"TEST_Job_{STAMP}",
                                                 "client_id": ctx["client_id"],
                                                 "site_location": "Site A"}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    import re
    assert re.match(r"^JOB-\d{4}-\d{3}$", d["job_number"]), d["job_number"]
    assert d["client_name"] == f"TEST_Client_{STAMP}"
    ctx["job_id"] = d["id"]
    ctx["job_number"] = d["job_number"]


def test_03_job_invalid_client(admin, base_url):
    r = admin.post(f"{base_url}/api/jobs", json={"job_name": "TEST_bad", "client_id": "nope"}, timeout=60)
    assert r.status_code == 404


def test_04_assign_equipment(admin, base_url, ctx):
    items = admin.get(f"{base_url}/api/equipment", params={"placement": "Base", "page_size": 5}, timeout=60).json()["items"]
    assert items, "no Base equipment to assign"
    eq = items[0]
    ctx["eq_id"] = eq["id"]
    r = admin.post(f"{base_url}/api/jobs/{ctx['job_id']}/assign", json={"equipment_id": eq["id"]}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    ctx["assignment_id"] = r.json()["id"]
    det = admin.get(f"{base_url}/api/equipment/{eq['id']}", timeout=60).json()
    assert det["equipment"]["placement"] == "Job"
    assert det["equipment"]["current_job_id"] == ctx["job_id"]
    assert any(a["id"] == ctx["assignment_id"] for a in det["assignments"])
    assert det["location_history"][0]["to_placement"] == "Job"


def test_05_double_assign_rejected(admin, base_url, ctx):
    r = admin.post(f"{base_url}/api/jobs/{ctx['job_id']}/assign",
                   json={"equipment_id": ctx["eq_id"]}, timeout=60)
    assert r.status_code == 400


def test_06_inventory_item(admin, base_url, ctx):
    r = admin.post(f"{base_url}/api/inventory", json={
        "item_code": f"TEST-ITEM-{STAMP}", "item_name": "TEST Filter", "type": "Spare Part",
        "unit": "EA", "stock": 12, "min_stock": 2}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    ctx["item_id"] = r.json()["id"]
    assert r.json()["stock"] == 12


def test_07_create_maintenance_autolinks_job(admin, base_url, ctx):
    r = admin.post(f"{base_url}/api/maintenance", json={
        "equipment_id": ctx["eq_id"], "problem_damage": "TEST_Hydraulic leak",
        "failure_found": "TEST_Seal worn", "root_cause": "TEST_Wear",
        "action_taken": "Replaced seal", "lead_technician": "QA Tech",
        "type_of_maintenance": "Corrective",
        "parts": [{"item_id": ctx["item_id"], "qty": 2}]}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    assert d["job_id"] == ctx["job_id"] and d["job_number"] == ctx["job_number"]
    assert d["status"] == "Open" and d["mnt_no"]
    assert d["parts_consumed"][0]["qty"] == 2
    ctx["mnt_id"] = d["id"]
    eq = admin.get(f"{base_url}/api/equipment/{ctx['eq_id']}", timeout=60).json()
    assert eq["equipment"]["operational_status"] == "Under Maintenance"
    assert any(f["failure_name"] == "TEST_Seal worn" for f in eq["failures"])
    # stock not deducted until close
    item = admin.get(f"{base_url}/api/inventory/{ctx['item_id']}", timeout=60).json()["item"]
    assert item["stock"] == 12


def test_08_maintenance_bad_part(admin, base_url, ctx):
    r = admin.post(f"{base_url}/api/maintenance", json={
        "equipment_id": ctx["eq_id"], "problem_damage": "TEST_x",
        "parts": [{"item_id": "bogus", "qty": 1}]}, timeout=60)
    assert r.status_code == 400


def test_09_close_deducts_stock(admin, base_url, ctx):
    r = admin.post(f"{base_url}/api/maintenance/{ctx['mnt_id']}/close",
                   json={"final_condition": "Good", "checked_by": "QA Sup"}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    assert d["status"] == "Closed" and d["parts_deducted"] is True
    assert d["final_condition"] == "Good"
    inv = admin.get(f"{base_url}/api/inventory/{ctx['item_id']}", timeout=60).json()
    assert inv["item"]["stock"] == 10, inv["item"]
    assert any(t["type"] == "consume" and t["qty"] == 2 for t in inv["transactions"])
    eq = admin.get(f"{base_url}/api/equipment/{ctx['eq_id']}", timeout=60).json()
    assert eq["equipment"]["operational_status"] == "Operational"
    assert any(p["maintenance_id"] == ctx["mnt_id"] for p in eq["parts_consumption"])


def test_10_double_close_rejected(admin, base_url, ctx):
    r = admin.post(f"{base_url}/api/maintenance/{ctx['mnt_id']}/close", json={}, timeout=60)
    assert r.status_code == 400


def test_11_pdf_report(admin, base_url, ctx):
    r = admin.get(f"{base_url}/api/maintenance/{ctx['mnt_id']}/report.pdf", timeout=90)
    assert r.status_code == 200
    assert r.content[:4] == b"%PDF", r.content[:40]
    assert "application/pdf" in r.headers.get("content-type", "")


def test_12_pdf_requires_auth(base_url, ctx):
    import requests
    r = requests.get(f"{base_url}/api/maintenance/{ctx['mnt_id']}/report.pdf", timeout=60)
    assert r.status_code == 401


def test_13_job_detail_crosslinks(admin, base_url, ctx):
    r = admin.get(f"{base_url}/api/jobs/{ctx['job_id']}", timeout=60)
    assert r.status_code == 200
    d = r.json()
    assert d["job"]["id"] == ctx["job_id"]
    assert any(e["id"] == ctx["eq_id"] for e in d["equipment"])
    assert any(m["id"] == ctx["mnt_id"] for m in d["maintenance"])
    assert len(d["failures"]) >= 1
    assert len(d["parts_consumption"]) >= 1


def test_14_demobilize(admin, base_url, ctx):
    r = admin.post(f"{base_url}/api/assignments/{ctx['assignment_id']}/demobilize",
                   json={"return_placement": "Workshop"}, timeout=60)
    assert r.status_code == 200, r.text[:300]
    a = r.json()
    assert a["status"] == "Closed" and a["demobilization_date"]
    eq = admin.get(f"{base_url}/api/equipment/{ctx['eq_id']}", timeout=60).json()
    assert eq["equipment"]["placement"] == "Workshop"
    assert eq["equipment"]["current_job_id"] is None
    assert any(x["id"] == ctx["assignment_id"] and x["status"] == "Closed" for x in eq["assignments"])
    r2 = admin.post(f"{base_url}/api/assignments/{ctx['assignment_id']}/demobilize", json={}, timeout=60)
    assert r2.status_code == 400


def test_15_audit_contains_actions(admin, base_url, ctx):
    rows = admin.get(f"{base_url}/api/audit", params={"limit": 200}, timeout=60).json()
    actions = {r["action"] for r in rows}
    for expected in ["client.create", "job.create", "assignment.mobilize",
                     "maintenance.create", "maintenance.close", "assignment.demobilize"]:
        assert expected in actions, f"{expected} missing from audit"


def test_16_reopen_restores_stock(admin, base_url, ctx):
    r = admin.post(f"{base_url}/api/maintenance/{ctx['mnt_id']}/reopen", timeout=60)
    assert r.status_code == 200, r.text[:300]
    inv = admin.get(f"{base_url}/api/inventory/{ctx['item_id']}", timeout=60).json()["item"]
    assert inv["stock"] == 12
    # close again to leave data consistent
    admin.post(f"{base_url}/api/maintenance/{ctx['mnt_id']}/close",
               json={"final_condition": "Good"}, timeout=60)
