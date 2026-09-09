import asyncio
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import HTTPException

from license_service import (
    LICENSE_API_BASE,
    LICENSE_KEY,
    LICENSE_PRODUCT_SLUG,
    get_license_state,
    has_feature,
    license_fingerprint,
)

APP_ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = APP_ROOT / "VERSION"
UPDATE_CHANNEL = os.environ.get(
    "AMT_RELEASE_CHANNEL",
    "stable",
).strip().lower()

VALID_CHANNELS = {"dev", "beta", "stable"}


def current_version() -> str:
    try:
        value = VERSION_FILE.read_text(
            encoding="utf-8"
        ).strip()
    except OSError:
        value = "0.0.0"
    return value or "0.0.0"


def _post_update_check_sync(payload: dict) -> dict:
    url = LICENSE_API_BASE + "/api/public/update/check"

    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "LogiSource-AMT-Updater/1.0",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=8,
        ) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(
            "utf-8",
            errors="replace",
        )
        try:
            detail = json.loads(body)
        except Exception:
            detail = {
                "message": body[:500]
                or "Update service rejected request"
            }

        raise HTTPException(
            status_code=502,
            detail={
                "message": "LS CRM update check failed",
                "remote_status": exc.code,
                "remote": detail,
            },
        )
    except (
        urllib.error.URLError,
        TimeoutError,
        OSError,
    ) as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "Could not reach LS CRM update service: "
                f"{exc}"
            ),
        )


async def check_for_update() -> dict:
    channel = (
        UPDATE_CHANNEL
        if UPDATE_CHANNEL in VALID_CHANNELS
        else "stable"
    )

    state = await get_license_state()

    if not has_feature(state, "update_version"):
        return {
            "current_version": current_version(),
            "channel": channel,
            "update_available": False,
            "reason": "feature_not_enabled",
            "message": (
                "Version updates are not available "
                "for the current license"
            ),
        }

    if not LICENSE_KEY:
        return {
            "current_version": current_version(),
            "channel": channel,
            "update_available": False,
            "reason": "no_license",
        }

    payload = {
        "license_key": LICENSE_KEY,
        "fingerprint": license_fingerprint(),
        "product_slug": LICENSE_PRODUCT_SLUG,
        "current_version": current_version(),
        "channel": channel,
    }

    result = await asyncio.to_thread(
        _post_update_check_sync,
        payload,
    )

    result.pop("license_key", None)
    result.pop("fingerprint", None)
    result.setdefault(
        "current_version",
        current_version(),
    )
    result.setdefault("channel", channel)

    return result
