"""Admin Backup & Export endpoints + RBAC (iteration 3)."""
import io
import json
import zipfile

import pytest
import requests

from conftest import BASE_URL

VIEWER = {"email": "viewer2@test.com", "password": "View@123", "name": "TEST_Viewer2", "role": "viewer"}


@pytest.fixture(scope="module")
def viewer_session(admin_module):
    # ensure viewer exists (idempotent)
    r = admin_module.post(f"{BASE_URL}/api/users", json=VIEWER, timeout=60)
    assert r.status_code in (200, 201, 400, 409), f"unexpected {r.status_code}: {r.text[:300]}"
    s = requests.Session()
    lr = s.post(f"{BASE_URL}/api/auth/login",
                json={"email": VIEWER["email"], "password": VIEWER["password"]}, timeout=60)
    if lr.status_code != 200:
        pytest.fail(f"viewer login failed {lr.status_code}: {lr.text[:300]}")
    me = s.get(f"{BASE_URL}/api/auth/me", timeout=60)
    assert me.status_code == 200
    assert me.json().get("role") == "viewer", f"viewer role wrong: {me.json()}"
    return s


@pytest.fixture(scope="module")
def admin_module(test_credentials):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=test_credentials, timeout=60)
    if r.status_code != 200:
        pytest.fail(f"admin login failed {r.status_code}: {r.text[:300]}")
    return s


class TestSourceDownload:
    def test_source_zip_admin(self, admin_module):
        r = admin_module.get(f"{BASE_URL}/api/admin/download/source", timeout=180)
        assert r.status_code == 200, r.text[:300]
        assert r.headers.get("content-type", "").startswith("application/zip")
        assert "attachment" in r.headers.get("content-disposition", "")
        zf = zipfile.ZipFile(io.BytesIO(r.content))
        names = zf.namelist()
        assert len(names) > 20, f"only {len(names)} files"
        assert "backend/server.py" in names
        assert any(n.startswith("frontend/src/") for n in names)
        # secrets excluded
        assert "backend/.env" not in names and "frontend/.env" not in names
        assert not any(n.endswith("/.env") or n == ".env" for n in names)
        assert "backend/.env.example" in names
        assert not any("node_modules" in n for n in names)

    def test_source_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/admin/download/source", timeout=60)
        assert r.status_code == 401, r.status_code

    def test_source_forbidden_for_viewer(self, viewer_session):
        r = viewer_session.get(f"{BASE_URL}/api/admin/download/source", timeout=120)
        assert r.status_code == 403, f"expected 403 got {r.status_code}"


class TestDatabaseDownload:
    def test_database_zip_admin(self, admin_module):
        r = admin_module.get(f"{BASE_URL}/api/admin/download/database", timeout=180)
        assert r.status_code == 200, r.text[:300]
        assert r.headers.get("content-type", "").startswith("application/zip")
        zf = zipfile.ZipFile(io.BytesIO(r.content))
        names = zf.namelist()
        assert "database/_manifest.json" in names
        manifest = json.loads(zf.read("database/_manifest.json"))
        assert manifest.get("database")
        assert isinstance(manifest.get("collections"), dict)
        assert len(manifest["collections"]) > 0
        for coll in manifest["collections"]:
            assert f"database/{coll}.json" in names
        # sample collection parses as json list
        sample = next(iter(manifest["collections"]))
        docs = json.loads(zf.read(f"database/{sample}.json"))
        assert isinstance(docs, list)

    def test_database_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/admin/download/database", timeout=60)
        assert r.status_code == 401

    def test_database_forbidden_for_viewer(self, viewer_session):
        r = viewer_session.get(f"{BASE_URL}/api/admin/download/database", timeout=120)
        assert r.status_code == 403, f"expected 403 got {r.status_code}"

    def test_bad_token_rejected(self):
        r = requests.get(f"{BASE_URL}/api/admin/download/database?auth=garbage", timeout=60)
        assert r.status_code == 401


class TestSettingsCurrency:
    def test_get_settings_public_to_authed(self, viewer_session):
        r = viewer_session.get(f"{BASE_URL}/api/settings", timeout=60)
        assert r.status_code == 200, r.text[:200]
        assert "currency" in r.json()

    def test_put_settings_viewer_forbidden(self, viewer_session):
        r = viewer_session.put(f"{BASE_URL}/api/settings", json={"currency": "USD"}, timeout=60)
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text[:200]}"

    def test_put_settings_admin_and_persist(self, admin_module):
        orig = admin_module.get(f"{BASE_URL}/api/settings", timeout=60).json().get("currency")
        r = admin_module.put(f"{BASE_URL}/api/settings", json={"currency": "EUR"}, timeout=60)
        assert r.status_code == 200, r.text[:200]
        got = admin_module.get(f"{BASE_URL}/api/settings", timeout=60).json()
        assert got["currency"] == "EUR"
        # restore
        admin_module.put(f"{BASE_URL}/api/settings", json={"currency": orig or "IDR"}, timeout=60)
