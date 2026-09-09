import hashlib
import io
import json
import os
import socket
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response

from core import db, now_iso, audit_log
from auth import require_roles

router = APIRouter(prefix="/api/admin")
MASTER_ADMIN = require_roles("master_admin")

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

APP_ROOT = Path(__file__).resolve().parents[1]
EXCLUDE_DIRS = {
    "node_modules", ".git", "build", "dist", "__pycache__", ".venv",
    "venv", ".cache", "coverage", ".pytest_cache", "test_reports",
    ".emergent", ".next", "seed_data", "storage", "uploads", "backups",
}
EXCLUDE_SUFFIX = {".pyc", ".log", ".pdf", ".bson", ".dump", ".archive"}

ENV_EXAMPLES = {
    "backend/.env.example": (
        "APP_ENV=\"production\"\n"
        "MONGO_URL=\"mongodb://127.0.0.1:27017\"\n"
        "DB_NAME=\"amt_database\"\n"
        "JWT_SECRET=\"replace-with-at-least-32-random-characters\"\n"
        "ADMIN_EMAIL=\"admin@example.com\"\n"
        "ADMIN_PASSWORD=\"replace-with-a-strong-password\"\n"
        "FRONTEND_URL=\"https://amt.example.com\"\n"
        "STORAGE_ROOT=\"/opt/amt/storage\"\n"
        "LOGI_LICENSE_API_BASE=\"https://crm.logisourcedigital.web.id\"\n"
        "LOGI_LICENSE_KEY=\"replace-with-ls-crm-license-key\"\n"
        "LOGI_LICENSE_PRODUCT_SLUG=\"ls-amt-baroid-uae\"\n"
    ),
    "frontend/.env.example": "REACT_APP_BACKEND_URL=https://amt.example.com\n",
}

NO_STORE_HEADERS = {
    "Cache-Control": "no-store, max-age=0",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
}


def _license_fingerprint() -> str:
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


def _mask_license_key(value: str) -> str:
    value = str(value or "")
    if len(value) <= 10:
        return "••••••••"
    return (
        value[:5]
        + "••••••"
        + value[-4:]
    )


def _sanitize_license_payload(value):
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            lowered = str(key).lower()
            if (
                "secret" in lowered
                or "token" in lowered
                or lowered in {
                    "license_key",
                    "key",
                }
            ):
                result[key] = "••••••••"
            else:
                result[key] = (
                    _sanitize_license_payload(
                        item
                    )
                )
        return result

    if isinstance(value, list):
        return [
            _sanitize_license_payload(item)
            for item in value
        ]

    return value


def _post_license_api(path: str, payload: dict):
    if not LICENSE_KEY:
        raise HTTPException(
            status_code=503,
            detail=(
                "LS CRM license key is not configured "
                "on this AMT server"
            ),
        )

    url = LICENSE_API_BASE + path
    request = urllib.request.Request(
        url,
        data=json.dumps(
            payload
        ).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "LogiSource-AMT-License/1.0",
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
            data = (
                json.loads(body)
                if body
                else {}
            )
            return {
                "http_status": response.status,
                "data": data,
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
    except (
        urllib.error.URLError,
        TimeoutError,
        OSError,
    ) as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "Could not reach LS CRM license service: "
                f"{exc}"
            ),
        )


def _license_summary(remote: dict) -> dict:
    data = remote.get("data") or {}

    nested = (
        data.get("license")
        if isinstance(
            data.get("license"),
            dict,
        )
        else {}
    )

    def pick(*keys):
        for key in keys:
            if key in data:
                return data.get(key)
            if key in nested:
                return nested.get(key)
        return None

    features = (
        pick(
            "features",
            "feature_flags",
        )
        or []
    )
    if isinstance(
        features,
        str,
    ):
        features = [
            item.strip()
            for item in features.split(",")
            if item.strip()
        ]

    status = (
        pick("status")
        or (
            "Active"
            if pick("valid")
            else "Invalid"
        )
    )

    return {
        "configured": bool(LICENSE_KEY),
        "license_key": _mask_license_key(
            LICENSE_KEY
        ),
        "product_slug": LICENSE_PRODUCT_SLUG,
        "crm_url": LICENSE_API_BASE,
        "fingerprint": _license_fingerprint(),
        "hostname": socket.gethostname(),
        "valid": bool(
            pick("valid")
        ),
        "status": status,
        "plan": pick("plan"),
        "features": features,
        "expiry": pick(
            "expiry",
            "expires_at",
            "expiration",
        ),
        "issued": pick(
            "issued",
            "issued_at",
        ),
        "activations": pick(
            "activations",
            "activation_count",
        ),
        "activation_limit": pick(
            "activation_limit",
            "max_activations",
        ),
        "total_checks": pick(
            "total_checks",
            "checks",
        ),
        "message": pick(
            "message",
            "detail",
        ),
        "remote_http_status": (
            remote.get(
                "http_status"
            )
        ),
        "raw": _sanitize_license_payload(
            data
        ),
    }


def _license_request_payload(
    include_hostname: bool = False,
):
    payload = {
        "license_key": LICENSE_KEY,
        "fingerprint": _license_fingerprint(),
        "product_slug": LICENSE_PRODUCT_SLUG,
    }

    if include_hostname:
        payload["hostname"] = (
            socket.gethostname()
        )

    return payload


@router.get("/license")
async def license_status(
    user: dict = Depends(
        MASTER_ADMIN
    ),
):
    if not LICENSE_KEY:
        return {
            "configured": False,
            "license_key": "",
            "product_slug": (
                LICENSE_PRODUCT_SLUG
            ),
            "crm_url": LICENSE_API_BASE,
            "status": "Not configured",
            "valid": False,
            "features": [],
        }

    remote = _post_license_api(
        "/api/public/license/verify",
        _license_request_payload(),
    )

    return _license_summary(
        remote
    )


@router.post("/license/activate")
async def activate_license(
    user: dict = Depends(
        MASTER_ADMIN
    ),
):
    remote = _post_license_api(
        "/api/public/license/activate",
        _license_request_payload(
            include_hostname=True
        ),
    )

    summary = _license_summary(
        remote
    )

    await audit_log(
        "license",
        LICENSE_PRODUCT_SLUG,
        "license.activate",
        user,
        (
            "Requested LS CRM license activation "
            f"(HTTP {summary.get('remote_http_status')})"
        ),
    )

    return summary


@router.get("/download/source")
async def download_source(
    user: dict = Depends(
        MASTER_ADMIN
    ),
):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for base in ["backend", "frontend"]:
            root = APP_ROOT / base
            if not root.exists():
                continue
            for dirpath, dirnames, filenames in os.walk(root):
                dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
                for fn in filenames:
                    if fn == ".env" or fn.startswith(".env") or Path(fn).suffix in EXCLUDE_SUFFIX:
                        continue
                    full = Path(dirpath) / fn
                    try:
                        arc = full.relative_to(APP_ROOT)
                        zf.write(full, arcname=str(arc))
                    except Exception:
                        continue

        readme = APP_ROOT / "README.md"
        if readme.exists():
            zf.write(readme, arcname="README.md")

        for name, content in ENV_EXAMPLES.items():
            zf.writestr(name, content)

    buf.seek(0)
    await audit_log(
        "backup", "source", "backup.source", user,
        "Downloaded source code archive",
    )
    headers = {
        **NO_STORE_HEADERS,
        "Content-Disposition": 'attachment; filename="amt-source-code.zip"',
    }
    return Response(content=buf.read(), media_type="application/zip", headers=headers)


@router.get("/download/database")
async def download_database(
    user: dict = Depends(
        MASTER_ADMIN
    ),
):
    buf = io.BytesIO()
    names = await db.list_collection_names()
    manifest = {
        "generated_at": now_iso(),
        "database": os.environ.get("DB_NAME"),
        "collections": {},
    }

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in sorted(names):
            docs = await db[name].find({}).to_list(None)
            for doc in docs:
                if "_id" in doc:
                    doc["_id"] = str(doc["_id"])
            manifest["collections"][name] = len(docs)
            zf.writestr(
                f"database/{name}.json",
                json.dumps(docs, default=str, indent=2, ensure_ascii=False),
            )
        zf.writestr("database/_manifest.json", json.dumps(manifest, indent=2))

    buf.seek(0)
    await audit_log(
        "backup", "database", "backup.database", user,
        f"Downloaded database dump ({len(names)} collections)",
    )
    headers = {
        **NO_STORE_HEADERS,
        "Content-Disposition": 'attachment; filename="amt-database-backup.zip"',
    }
    return Response(content=buf.read(), media_type="application/zip", headers=headers)
