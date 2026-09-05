import logging
import os
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from core import db
from auth import auth_router, users_router, seed_admin
from equipment_routes import router as equipment_router
from maintenance_routes import router as maintenance_router
from inventory_routes import router as inventory_router
from jobs_routes import router as jobs_router
from misc_routes import router as misc_router
from admin_routes import router as admin_router
from public_routes import router as public_router
from settings_routes import router as settings_router
from export_routes import router as export_router
from public_access import backfill_equipment_public_tokens
from importer import seed_from_excel
from storage import init_storage

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("asset-maintenance")

APP_ENV = os.environ.get("APP_ENV", "production").strip().lower()
IS_PRODUCTION = APP_ENV == "production"
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000").rstrip("/")


def _allowed_origins():
    configured = os.environ.get("CORS_ORIGINS", "")
    values = [FRONTEND_URL]
    if configured:
        values.extend(part.strip().rstrip("/") for part in configured.split(",") if part.strip())
    if not IS_PRODUCTION:
        values.extend(["http://localhost:3000", "http://127.0.0.1:3000"])
    return sorted({value for value in values if value and value != "*"})


def _allowed_hosts():
    hosts = {"localhost", "127.0.0.1"}
    for origin in _allowed_origins():
        parsed = urlparse(origin)
        if parsed.hostname:
            hosts.add(parsed.hostname)
    extra = os.environ.get("ALLOWED_HOSTS", "")
    hosts.update(part.strip() for part in extra.split(",") if part.strip())
    return sorted(hosts)


def _validate_runtime_security():
    secret = os.environ.get("JWT_SECRET", "")
    weak = {
        "",
        "CHANGE_ME",
        "change-me",
        "change-me-to-a-long-random-secret",
        "REPLACE_WITH_A_LONG_RANDOM_SECRET",
    }
    if secret in weak or len(secret) < 32:
        raise RuntimeError("JWT_SECRET must contain at least 32 non-default characters")

    if IS_PRODUCTION and not FRONTEND_URL.startswith("https://"):
        raise RuntimeError("FRONTEND_URL must use https:// in production")


app = FastAPI(
    title="AMT - Asset Maintenance Tracker",
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None if IS_PRODUCTION else "/redoc",
    openapi_url=None if IS_PRODUCTION else "/openapi.json",
)

ALLOWED_ORIGINS = _allowed_origins()

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=_allowed_hosts(),
)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def browser_origin_guard(request: Request, call_next):
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") not in ALLOWED_ORIGINS:
            return JSONResponse(
                status_code=403,
                content={"detail": "Untrusted request origin"},
            )
    return await call_next(request)


@app.get("/api/")
async def root():
    return {
        "message": "AMT - Asset Maintenance Tracker API",
        "brand": "LogiSource Digital",
    }


app.include_router(auth_router)
app.include_router(users_router)
app.include_router(equipment_router)
app.include_router(maintenance_router)
app.include_router(inventory_router)
app.include_router(jobs_router)
app.include_router(misc_router)
app.include_router(admin_router)
app.include_router(public_router)
app.include_router(settings_router)
app.include_router(export_router)


async def _ensure_indexes():
    partial_string = lambda field: {field: {"$gt": ""}}

    await db.users.create_index("email", unique=True, name="uniq_users_email")
    await db.users.create_index(
        "id", unique=True, name="uniq_users_id",
        partialFilterExpression=partial_string("id"),
    )

    await db.auth_sessions.create_index("jti_hash", unique=True, name="uniq_auth_session_jti")
    await db.auth_sessions.create_index("expires_at", expireAfterSeconds=0, name="ttl_auth_sessions")
    await db.login_attempts.create_index("identifier", name="idx_login_identifier")
    await db.login_attempts.create_index("locked_until", expireAfterSeconds=3600, name="ttl_login_attempts")

    await db.equipment.create_index(
        "id", unique=True, name="uniq_equipment_id",
        partialFilterExpression=partial_string("id"),
    )
    await db.equipment.create_index(
        "sap_no", unique=True, name="uniq_equipment_sap",
        partialFilterExpression=partial_string("sap_no"),
    )
    await db.equipment.create_index("mfg_no", name="idx_equipment_mfg")
    await db.equipment.create_index("name", name="idx_equipment_name")

    await db.maintenance.create_index(
        "id", unique=True, name="uniq_maintenance_id",
        partialFilterExpression=partial_string("id"),
    )
    await db.maintenance.create_index(
        "mnt_no", unique=True, name="uniq_maintenance_no",
        partialFilterExpression=partial_string("mnt_no"),
    )
    await db.maintenance.create_index("equipment_id", name="idx_maintenance_equipment")
    await db.maintenance.create_index("lifecycle_lock.operation_id", name="idx_maintenance_lifecycle")

    await db.failures.create_index(
        "id", unique=True, name="uniq_failure_id",
        partialFilterExpression=partial_string("id"),
    )
    await db.failures.create_index(
        "maintenance_id", unique=True, name="uniq_failure_maintenance",
        partialFilterExpression=partial_string("maintenance_id"),
    )
    await db.failures.create_index("equipment_id", name="idx_failure_equipment")

    await db.clients.create_index(
        "id", unique=True, name="uniq_client_id",
        partialFilterExpression=partial_string("id"),
    )
    await db.jobs.create_index(
        "id", unique=True, name="uniq_job_id",
        partialFilterExpression=partial_string("id"),
    )
    await db.jobs.create_index(
        "job_number", unique=True, name="uniq_job_number",
        partialFilterExpression=partial_string("job_number"),
    )

    await db.assignments.create_index(
        "id", unique=True, name="uniq_assignment_id",
        partialFilterExpression=partial_string("id"),
    )
    await db.assignments.create_index("equipment_id", name="idx_assignment_equipment")
    await db.assignments.create_index(
        [("equipment_id", 1), ("status", 1)],
        unique=True,
        name="uniq_active_assignment_equipment",
        partialFilterExpression={"status": "Active"},
    )

    await db.inventory_items.create_index(
        "id", unique=True, name="uniq_inventory_id",
        partialFilterExpression=partial_string("id"),
    )
    await db.inventory_items.create_index(
        "item_code", unique=True, name="uniq_inventory_item_code",
        partialFilterExpression=partial_string("item_code"),
    )

    await db.inventory_transactions.create_index(
        "id", unique=True, name="uniq_inventory_tx_id",
        partialFilterExpression=partial_string("id"),
    )
    await db.inventory_transactions.create_index(
        "operation_key", unique=True, sparse=True, name="uniq_inventory_operation_key"
    )

    await db.files.create_index(
        "id", unique=True, name="uniq_file_id",
        partialFilterExpression=partial_string("id"),
    )
    await db.files.create_index("maintenance_id", name="idx_file_maintenance")
    await db.files.create_index("equipment_id", name="idx_file_equipment")

    await db.location_history.create_index("equipment_id", name="idx_location_equipment")
    await db.audit_logs.create_index("timestamp", name="idx_audit_timestamp")


@app.on_event("startup")
async def startup():
    _validate_runtime_security()
    await _ensure_indexes()

    try:
        await seed_admin()
        logger.info("Admin seeded/verified")
    except Exception as exc:
        logger.error("Admin seed failed: %s", exc)
        raise

    try:
        result = await seed_from_excel()
        logger.info("Excel seed: %s", result)
    except Exception as exc:
        logger.error("Excel seed failed: %s", exc)

    try:
        count = await backfill_equipment_public_tokens()
        logger.info("Public QR token backfill: %s equipment updated", count)
        await db.equipment.create_index(
            "public_token",
            unique=True,
            name="uniq_equipment_public_token",
            partialFilterExpression={"public_token": {"$gt": ""}},
        )
    except Exception as exc:
        logger.error("Public QR token initialization failed: %s", exc)
        raise

    try:
        init_storage()
        logger.info("Storage initialized")
    except Exception as exc:
        logger.error("Storage init failed: %s", exc)
        raise


@app.on_event("shutdown")
async def shutdown():
    from core import client
    client.close()
