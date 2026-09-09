import asyncio
import hashlib
import json
import os
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import HTTPException

from core import db, now_iso


LICENSE_API_BASE = os.environ.get(
    "LOGI_LICENSE_API_BASE",
    "https://crm.logisourcedigital.web.id",
).strip().rstrip("/")
LICENSE_KEY = os.environ.get(
    "LOGI_LICENSE_KEY",
    "",
).strip()
LICENSE_PRODUCT_SLUG = os.environ.get(
    "LOGI_LICENSE_PRODUCT_SLUG",
    "ls-amt-baroid-uae",
).strip()

CACHE_SECONDS = int(
    os.environ.get(
        "LOGI_LICENSE_CACHE_SECONDS",
        "300",
    )
)
GRACE_SECONDS = int(
    os.environ.get(
        "LOGI_LICENSE_GRACE_SECONDS",
        "86400",
    )
)

ALL_FEATURES = [
    "update_version",
    "export_code_db",
    "export_data",
    "audit_log",
    "qr_public_view",
    "custom_branding",
]


def license_fingerprint() -> str:
    raw = ""
    machine_id = Path("/etc/machine-id")

    try:
        if machine_id.exists():
            raw = machine_id.read_text(
                encoding="utf-8"
            ).strip()
    except Exception:
        raw = ""

    if not raw:
        raw = socket.gethostname()

    digest = hashlib.sha256(
        raw.encode("utf-8")
    ).hexdigest()

    return f"amt-{digest[:32]}"


def mask_license_key(value: str) -> str:
    value = str(value or "")
    if not value:
        return ""
    if len(value) <= 10:
        return "••••••••"
    return (
        value[:5]
        + "••••••"
        + value[-4:]
    )


def _post_json_sync(
    path: str,
    payload: dict,
):
    url = LICENSE_API_BASE + path

    request = urllib.request.Request(
        url,
        data=json.dumps(
            payload
        ).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": (
                "LogiSource-AMT-License/2.0"
            ),
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=5,
        ) as response:
            body = response.read().decode(
                "utf-8"
            )
            return {
                "http_status": response.status,
                "data": (
                    json.loads(body)
                    if body
                    else {}
                ),
            }
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(
            "utf-8",
            errors="replace",
        )

        try:
            data = json.loads(body)
        except Exception:
            data = {
                "message": (
                    body[:500]
                    or "LS CRM rejected the request"
                )
            }

        return {
            "http_status": exc.code,
            "data": data,
        }


def _pick(
    data: dict,
    nested: dict,
    *keys,
):
    for key in keys:
        if key in data:
            return data.get(key)
        if key in nested:
            return nested.get(key)
    return None


def _normalize_remote(remote: dict) -> dict:
    data = remote.get("data") or {}

    nested = (
        data.get("license")
        if isinstance(
            data.get("license"),
            dict,
        )
        else {}
    )

    status_raw = str(
        _pick(
            data,
            nested,
            "status",
        )
        or ""
    ).strip()

    valid_raw = _pick(
        data,
        nested,
        "valid",
    )

    valid = bool(valid_raw)
    if valid_raw is None:
        valid = (
            status_raw.lower()
            in {
                "active",
                "valid",
            }
        )

    plan_raw = str(
        _pick(
            data,
            nested,
            "plan",
        )
        or ""
    ).strip()

    plan = (
        plan_raw.lower()
        if plan_raw
        else "trial"
    )

    paid = (
        valid
        and plan
        not in {
            "",
            "trial",
        }
    )

    # Requested product behavior:
    # - no/invalid/trial license => Trial, no feature flags;
    # - any valid non-Trial plan => full product feature set.
    effective_features = (
        list(ALL_FEATURES)
        if paid
        else []
    )

    return {
        "configured": bool(
            LICENSE_KEY
        ),
        "valid": paid,
        "status": (
            status_raw
            if paid and status_raw
            else (
                "active"
                if paid
                else "trial"
            )
        ),
        "plan": (
            plan
            if paid
            else "trial"
        ),
        "features": (
            effective_features
        ),
        "remote_features": (
            _pick(
                data,
                nested,
                "features",
                "feature_flags",
            )
            or []
        ),
        "expiry": _pick(
            data,
            nested,
            "expiry",
            "expires_at",
            "expiration",
        ),
        "issued": _pick(
            data,
            nested,
            "issued",
            "issued_at",
        ),
        "activations": _pick(
            data,
            nested,
            "activations",
            "activation_count",
        ),
        "activation_limit": _pick(
            data,
            nested,
            "activation_limit",
            "max_activations",
        ),
        "total_checks": _pick(
            data,
            nested,
            "total_checks",
            "checks",
        ),
        "message": _pick(
            data,
            nested,
            "message",
            "detail",
        ),
        "remote_http_status": (
            remote.get(
                "http_status"
            )
        ),
        "stale": False,
    }


def _trial_state(
    message: str = "",
    configured: bool | None = None,
) -> dict:
    return {
        "configured": (
            bool(LICENSE_KEY)
            if configured is None
            else configured
        ),
        "valid": False,
        "status": "trial",
        "plan": "trial",
        "features": [],
        "remote_features": [],
        "expiry": None,
        "issued": None,
        "activations": 0,
        "activation_limit": None,
        "total_checks": None,
        "message": message or None,
        "remote_http_status": None,
        "stale": False,
    }


def _private_fields() -> dict:
    return {
        "license_key": mask_license_key(
            LICENSE_KEY
        ),
        "product_slug": (
            LICENSE_PRODUCT_SLUG
        ),
        "crm_url": LICENSE_API_BASE,
        "fingerprint": (
            license_fingerprint()
        ),
        "hostname": (
            socket.gethostname()
        ),
    }


def _request_payload(
    include_hostname: bool = False,
):
    payload = {
        "license_key": LICENSE_KEY,
        "fingerprint": (
            license_fingerprint()
        ),
        "product_slug": (
            LICENSE_PRODUCT_SLUG
        ),
    }

    if include_hostname:
        payload["hostname"] = (
            socket.gethostname()
        )

    return payload


async def _cache_read():
    return await db.settings.find_one(
        {"_id": "license_cache"},
        {"_id": 0},
    )


async def _cache_write(
    state: dict,
):
    await db.settings.update_one(
        {"_id": "license_cache"},
        {
            "$set": {
                "state": state,
                "checked_at_epoch": (
                    int(time.time())
                ),
                "checked_at": now_iso(),
            }
        },
        upsert=True,
    )


async def get_license_state(
    force: bool = False,
    include_private: bool = False,
) -> dict:
    if not LICENSE_KEY:
        state = _trial_state(
            "No license configured",
            configured=False,
        )
        if include_private:
            state.update(
                _private_fields()
            )
        return state

    now = int(time.time())
    cached = await _cache_read()
    cached_state = (
        dict(
            cached.get("state")
            or {}
        )
        if cached
        else {}
    )
    checked_at = int(
        (cached or {}).get(
            "checked_at_epoch"
        )
        or 0
    )
    age = (
        now - checked_at
        if checked_at
        else None
    )

    if (
        not force
        and cached_state
        and age is not None
        and age <= CACHE_SECONDS
    ):
        state = cached_state
    else:
        try:
            remote = await asyncio.to_thread(
                _post_json_sync,
                "/api/public/license/verify",
                _request_payload(),
            )
            state = _normalize_remote(
                remote
            )
            await _cache_write(
                state
            )
        except (
            urllib.error.URLError,
            TimeoutError,
            OSError,
        ) as exc:
            # Do not instantly break a paid production installation
            # during a short LS CRM/network outage. Keep the most recent
            # valid paid snapshot for a bounded grace period.
            if (
                cached_state.get(
                    "valid"
                )
                and age is not None
                and age
                <= GRACE_SECONDS
            ):
                state = cached_state
                state["stale"] = True
                state["message"] = (
                    "Using last verified license "
                    "during LS CRM connectivity issue"
                )
            else:
                state = _trial_state(
                    (
                        "LS CRM license check "
                        f"unavailable: {exc}"
                    ),
                    configured=True,
                )

    if include_private:
        state = dict(state)
        state.update(
            _private_fields()
        )

    return state


async def activate_license_state() -> dict:
    if not LICENSE_KEY:
        raise HTTPException(
            status_code=503,
            detail=(
                "LS CRM license key is not "
                "configured on this AMT server"
            ),
        )

    try:
        remote = await asyncio.to_thread(
            _post_json_sync,
            "/api/public/license/activate",
            _request_payload(
                include_hostname=True
            ),
        )
    except (
        urllib.error.URLError,
        TimeoutError,
        OSError,
    ) as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "Could not reach LS CRM "
                f"license service: {exc}"
            ),
        )

    state = _normalize_remote(
        remote
    )
    await _cache_write(
        state
    )

    state = dict(state)
    state.update(
        _private_fields()
    )
    return state


def has_feature(
    state: dict,
    feature: str,
) -> bool:
    return feature in set(
        state.get("features")
        or []
    )


async def require_feature_enabled(
    feature: str,
) -> dict:
    state = await get_license_state()

    if not has_feature(
        state,
        feature,
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                f"{feature} is not available "
                "in the Trial license"
            ),
        )

    return state


async def qr_equipment_allowed(
    equipment_id: str,
    claim: bool = False,
) -> bool:
    state = await get_license_state()

    if has_feature(
        state,
        "qr_public_view",
    ):
        return True

    # Trial quota: exactly one Equipment Passport.
    await db.settings.update_one(
        {"_id": "license_runtime"},
        {
            "$setOnInsert": {
                "created_at": now_iso(),
            }
        },
        upsert=True,
    )

    runtime = await db.settings.find_one(
        {"_id": "license_runtime"},
        {"_id": 0},
    ) or {}

    current = (
        runtime.get(
            "trial_qr_equipment_id"
        )
        or ""
    )

    if current:
        return (
            current
            == equipment_id
        )

    if not claim:
        return False

    result = await db.settings.update_one(
        {
            "_id": "license_runtime",
            "$or": [
                {
                    "trial_qr_equipment_id": {
                        "$exists": False
                    }
                },
                {
                    "trial_qr_equipment_id": None
                },
                {
                    "trial_qr_equipment_id": ""
                },
            ],
        },
        {
            "$set": {
                "trial_qr_equipment_id": (
                    equipment_id
                ),
                "trial_qr_claimed_at": (
                    now_iso()
                ),
            }
        },
    )

    if result.modified_count:
        return True

    runtime = await db.settings.find_one(
        {"_id": "license_runtime"},
        {"_id": 0},
    ) or {}

    return (
        runtime.get(
            "trial_qr_equipment_id"
        )
        == equipment_id
    )


async def public_capabilities() -> dict:
    state = await get_license_state()

    return {
        "plan": (
            state.get("plan")
            or "trial"
        ),
        "status": (
            state.get("status")
            or "trial"
        ),
        "valid": bool(
            state.get("valid")
        ),
        "features": list(
            state.get("features")
            or []
        ),
        "trial_qr_limit": (
            None
            if has_feature(
                state,
                "qr_public_view",
            )
            else 1
        ),
        "stale": bool(
            state.get("stale")
        ),
    }
