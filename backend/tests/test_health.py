# Health / auth basics
import requests


def test_login_success(base_url, test_credentials):
    s = requests.Session()
    r = s.post(f"{base_url}/api/auth/login", json=test_credentials, timeout=60)
    assert r.status_code == 200, r.text[:300]
    d = r.json()
    assert d["email"] == test_credentials["email"].lower()
    assert d["role"] == "admin"
    assert "password_hash" not in d
    assert "_id" not in d
    assert "access_token" in s.cookies.get_dict()


def test_me_requires_auth(base_url):
    r = requests.get(f"{base_url}/api/auth/me", timeout=60)
    assert r.status_code == 401


def test_me_authenticated(admin, base_url):
    r = admin.get(f"{base_url}/api/auth/me", timeout=60)
    assert r.status_code == 200
    assert r.json()["role"] == "admin"


def test_login_invalid_password(base_url, test_credentials):
    r = requests.post(f"{base_url}/api/auth/login",
                      json={"email": "TEST_nobody_xyz@example.com", "password": "wrong"}, timeout=60)
    assert r.status_code == 401


def test_protected_endpoints_reject_anonymous(base_url):
    for path in ["/api/dashboard", "/api/equipment", "/api/clients", "/api/jobs",
                 "/api/inventory", "/api/audit", "/api/failures/recurring"]:
        r = requests.get(f"{base_url}{path}", timeout=60)
        assert r.status_code == 401, f"{path} -> {r.status_code}"
