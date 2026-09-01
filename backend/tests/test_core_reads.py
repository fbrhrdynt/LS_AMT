# Dashboard, search, equipment list/detail, failures, inventory, audit, reports
import pytest


@pytest.fixture(scope="module")
def dash(admin, base_url):
    r = admin.get(f"{base_url}/api/dashboard", timeout=90)
    assert r.status_code == 200, r.text[:300]
    return r.json()


def test_dashboard_kpis(dash):
    assert dash["total_equipment"] >= 100  # seeded set (may shrink slightly from prior test deletes)
    for k in ["operational", "under_maintenance", "at_base", "at_workshop", "on_job",
              "active_jobs", "maintenance_this_month", "open_maintenance", "low_stock",
              "recent_maintenance", "most_common_failures", "most_consumed_parts",
              "equipment_most_failures", "low_stock_items"]:
        assert k in dash, f"missing {k}"
    assert isinstance(dash["recent_maintenance"], list)


def test_search_by_sap(admin, base_url):
    r = admin.get(f"{base_url}/api/search", params={"q": "11752235"}, timeout=60)
    assert r.status_code == 200
    d = r.json()
    assert len(d["equipment"]) >= 1
    assert "11752235" in d["equipment"][0]["sap_no"]


def test_search_empty_query(admin, base_url):
    r = admin.get(f"{base_url}/api/search", params={"q": ""}, timeout=60)
    assert r.status_code == 200
    assert r.json() == {"equipment": [], "jobs": [], "clients": []}


def test_equipment_list_pagination(admin, base_url):
    r = admin.get(f"{base_url}/api/equipment", params={"page": 1, "page_size": 20}, timeout=60)
    assert r.status_code == 200
    d = r.json()
    assert d["total"] >= 100 and len(d["items"]) == 20
    r2 = admin.get(f"{base_url}/api/equipment", params={"page": 2, "page_size": 20}, timeout=60)
    assert r2.json()["items"][0]["id"] != d["items"][0]["id"]


def test_equipment_filters(admin, base_url):
    r = admin.get(f"{base_url}/api/equipment", params={"placement": "Base"}, timeout=60)
    assert r.status_code == 200
    assert all(i["placement"] == "Base" for i in r.json()["items"])
    r = admin.get(f"{base_url}/api/equipment", params={"status": "Operational"}, timeout=60)
    assert all(i["operational_status"] == "Operational" for i in r.json()["items"])


def test_equipment_detail_bundle(admin, base_url):
    lid = admin.get(f"{base_url}/api/equipment", params={"page_size": 1}, timeout=60).json()["items"][0]["id"]
    r = admin.get(f"{base_url}/api/equipment/{lid}", timeout=60)
    assert r.status_code == 200
    d = r.json()
    for k in ["equipment", "maintenance", "failures", "recurring_failures",
              "location_history", "assignments", "documents", "parts_consumption"]:
        assert k in d
    assert d["equipment"]["id"] == lid


def test_equipment_404(admin, base_url):
    r = admin.get(f"{base_url}/api/equipment/does-not-exist", timeout=60)
    assert r.status_code == 404


def test_maintenance_history_sorted_desc(admin, base_url):
    r = admin.get(f"{base_url}/api/maintenance", params={"page_size": 50}, timeout=60)
    assert r.status_code == 200
    items = r.json()["items"]
    dates = [i.get("maintenance_date") or "" for i in items]
    assert dates == sorted(dates, reverse=True)


def test_recurring_failures(admin, base_url):
    r = admin.get(f"{base_url}/api/failures/recurring", timeout=60)
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list) and len(rows) > 0
    assert rows[0]["count"] >= rows[-1]["count"]
    assert "occurrences" in rows[0]


def test_inventory_list(admin, base_url):
    r = admin.get(f"{base_url}/api/inventory", timeout=60)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_audit_list(admin, base_url):
    r = admin.get(f"{base_url}/api/audit", timeout=60)
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list)
    if rows:
        assert "action" in rows[0] and "_id" not in rows[0]


def test_reports_and_exports(admin, base_url):
    r = admin.get(f"{base_url}/api/reports/maintenance", params={"status": "Closed"}, timeout=90)
    assert r.status_code == 200
    assert all(i["status"] == "Closed" for i in r.json()["items"])
    csv_r = admin.get(f"{base_url}/api/reports/maintenance/export.csv", timeout=90)
    assert csv_r.status_code == 200 and "Maintenance No" in csv_r.text
    xl = admin.get(f"{base_url}/api/reports/maintenance/export.xlsx", timeout=90)
    assert xl.status_code == 200 and xl.content[:2] == b"PK"


def test_export_requires_auth(base_url):
    import requests
    r = requests.get(f"{base_url}/api/reports/maintenance/export.csv", timeout=60)
    assert r.status_code == 401
