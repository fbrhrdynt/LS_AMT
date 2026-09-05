# Security regression checks for AMT hardening.

import requests


def test_public_self_registration_disabled(base_url):
    response = requests.post(
        f"{base_url}/api/auth/register",
        json={
            "email": "should-not-register@example.com",
            "password": "DoNotCreateThis123!",
            "name": "Blocked Self Registration",
            "role": "viewer",
        },
        timeout=60,
    )
    assert response.status_code == 403


def test_admin_download_does_not_accept_query_token(
    admin,
    base_url,
):
    token = admin.cookies.get("access_token")
    assert token

    response = requests.get(
        f"{base_url}/api/admin/download/source",
        params={"auth": token},
        timeout=60,
    )
    assert response.status_code == 401


def test_maintenance_pdf_does_not_accept_query_token(
    admin,
    base_url,
):
    page = admin.get(
        f"{base_url}/api/maintenance",
        params={"page_size": 1},
        timeout=60,
    )
    assert page.status_code == 200

    items = page.json().get("items") or []
    if not items:
        return

    token = admin.cookies.get("access_token")
    assert token

    response = requests.get(
        (
            f"{base_url}/api/maintenance/"
            f"{items[0]['id']}/report.pdf"
        ),
        params={"auth": token},
        timeout=60,
    )
    assert response.status_code == 401


def test_authenticated_maintenance_pdf_still_works(
    admin,
    base_url,
):
    page = admin.get(
        f"{base_url}/api/maintenance",
        params={"page_size": 1},
        timeout=60,
    )
    assert page.status_code == 200

    items = page.json().get("items") or []
    if not items:
        return

    response = admin.get(
        (
            f"{base_url}/api/maintenance/"
            f"{items[0]['id']}/report.pdf"
        ),
        timeout=60,
    )
    assert response.status_code == 200
    assert response.content[:4] == b"%PDF"
