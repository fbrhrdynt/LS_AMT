import logging
import os

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

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

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("asset-maintenance")

app = FastAPI(title="AMT - Asset Maintenance Tracker")


@app.get("/api/")
async def root():
    return {"message": "AMT - Asset Maintenance Tracker API", "brand": "LogiSource Digital"}


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

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[os.environ.get("FRONTEND_URL", "http://localhost:3000"), "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.equipment.create_index("sap_no")
    await db.equipment.create_index("mfg_no")
    await db.equipment.create_index("name")
    await db.maintenance.create_index("equipment_id")
    await db.maintenance.create_index("mnt_no")
    await db.failures.create_index("equipment_id")
    await db.jobs.create_index("job_number")
    await db.assignments.create_index("equipment_id")
    await db.audit_logs.create_index("timestamp")

    try:
        await seed_admin()
        logger.info("Admin seeded")
    except Exception as e:
        logger.error(f"Admin seed failed: {e}")

    try:
        result = await seed_from_excel()
        logger.info(f"Excel seed: {result}")
    except Exception as e:
        logger.error(f"Excel seed failed: {e}")

    try:
        count = await backfill_equipment_public_tokens()
        logger.info(f"Public QR token backfill: {count} equipment updated")
        await db.equipment.create_index("public_token", unique=True, sparse=True)
        logger.info("Public QR token unique index ready")
    except Exception as e:
        logger.error(f"Public QR token initialization failed: {e}")

    try:
        init_storage()
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")


@app.on_event("shutdown")
async def shutdown():
    from core import client
    client.close()
