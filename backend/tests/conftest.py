import os
from urllib.parse import urlparse

import pytest
import requests

PRODUCTION_HOST = "amt.logisourcedigital.web.id"
BASE_URL = os.environ.get("AMT_TEST_BASE_URL", "").rstrip("/")

if not BASE_URL:
    raise RuntimeError(
        "AMT_TEST_BASE_URL is required. Tests no longer fall back to the production frontend URL."
    )

host = (urlparse(BASE_URL).hostname or "").lower()
if host == PRODUCTION_HOST and os.environ.get("AMT_ALLOW_PRODUCTION_TESTS") != "I_UNDERSTAND_THIS_MUTATES_DATA":
    raise RuntimeError(
        "Refusing to run integration tests against production. "
        "Use an isolated test backend/database."
    )


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def test_credentials():
    email = os.environ.get("AMT_TEST_EMAIL")
    password = os.environ.get("AMT_TEST_PASSWORD")
    if not email or not password:
        pytest.skip("AMT_TEST_EMAIL / AMT_TEST_PASSWORD are required")
    return {"email": email, "password": password}


@pytest.fixture(scope="session")
def admin(test_credentials):
    session = requests.Session()
    response = session.post(
        f"{BASE_URL}/api/auth/login",
        json=test_credentials,
        timeout=60,
    )
    if response.status_code != 200:
        pytest.fail(
            f"admin login failed {response.status_code}: {response.text[:300]}"
        )
    return session
