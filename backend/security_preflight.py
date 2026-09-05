# Read-only production hardening preflight. No database records are modified.

import asyncio
import os
import stat
from pathlib import Path
from urllib.parse import urlparse

from core import db
from storage import STORAGE_ROOT

BACKEND_DIR = Path(__file__).resolve().parent
ROOT = BACKEND_DIR.parent


def add(issues, message):
    issues.append(message)


def check_environment(issues, warnings):
    app_env = os.environ.get("APP_ENV", "production").strip().lower()
    secret = os.environ.get("JWT_SECRET", "")
    weak = {
        "",
        "CHANGE_ME",
        "change-me",
        "change-me-to-a-long-random-secret",
        "REPLACE_WITH_A_LONG_RANDOM_SECRET",
    }
    if secret in weak or len(secret) < 32:
        add(issues, "JWT_SECRET is default/short; use at least 32 random characters")

    admin_password = os.environ.get("ADMIN_PASSWORD", "")
    if len(admin_password) < 12 or admin_password.upper() in {"CHANGE_ME", "PASSWORD", "ADMIN"}:
        add(issues, "ADMIN_PASSWORD is too weak; use at least 12 characters")

    frontend = os.environ.get("FRONTEND_URL", "")
    if app_env == "production" and not frontend.startswith("https://"):
        add(issues, "FRONTEND_URL must use https:// in production")

    cors = os.environ.get("CORS_ORIGINS", "")
    if "*" in [part.strip() for part in cors.split(",") if part.strip()]:
        add(issues, "CORS_ORIGINS must not contain * when credentials are enabled")

    mongo = os.environ.get("MONGO_URL", "")
    parsed = urlparse(mongo)
    host = (parsed.hostname or "").lower()
    if app_env == "production" and host not in {"127.0.0.1", "localhost", "::1"}:
        warnings.append(
            f"MongoDB host is {host or 'unknown'}, not loopback. Confirm it is private/firewalled."
        )

    if STORAGE_ROOT.exists():
        mode = stat.S_IMODE(STORAGE_ROOT.stat().st_mode)
        if mode & 0o007:
            add(issues, f"STORAGE_ROOT is world-accessible ({oct(mode)}); expected no world permissions")


def check_source(issues):
    index = ROOT / "frontend/public/index.html"
    text = index.read_text(encoding="utf-8", errors="ignore").lower() if index.exists() else ""
    for marker in ["emergent.sh", "posthog", "fonts.googleapis.com", "fonts.gstatic.com"]:
        if marker in text:
            add(issues, f"frontend/public/index.html still references {marker}")

    for rel in ["backend/admin_routes.py", "backend/misc_routes.py", "backend/maintenance_routes.py"]:
        path = ROOT / rel
        if not path.exists():
            continue
        source = path.read_text(encoding="utf-8", errors="ignore")
        if "auth: str = Query(None)" in source or "or auth or" in source:
            add(issues, f"{rel} still appears to accept authentication from a query parameter")

    auth = (ROOT / "backend/auth.py").read_text(encoding="utf-8", errors="ignore")
    if "Self-registration is disabled" not in auth:
        add(issues, "Public self-registration does not appear disabled")
    if "auth_sessions" not in auth:
        add(issues, "Refresh-session replay protection is not installed")


def nonempty_duplicate_pipeline(field):
    return [
        {"$match": {field: {"$exists": True, "$nin": [None, ""]}}},
        {"$group": {"_id": f"${field}", "count": {"$sum": 1}, "ids": {"$push": "$id"}}},
        {"$match": {"count": {"$gt": 1}}},
    ]


async def find_duplicates(collection, field):
    return await collection.aggregate(nonempty_duplicate_pipeline(field)).to_list(2000)


async def check_database(issues):
    business_checks = [
        ("users.email", db.users, "email"),
        ("equipment.sap_no", db.equipment, "sap_no"),
        ("maintenance.mnt_no", db.maintenance, "mnt_no"),
        ("jobs.job_number", db.jobs, "job_number"),
        ("inventory.item_code", db.inventory_items, "item_code"),
        ("failures.maintenance_id", db.failures, "maintenance_id"),
        ("equipment.public_token", db.equipment, "public_token"),
    ]
    for label, collection, field in business_checks:
        for row in await find_duplicates(collection, field):
            add(issues, f"DUPLICATE {label}={row['_id']!r} count={row['count']} ids={row['ids'][:10]}")

    id_collections = [
        "users", "equipment", "maintenance", "failures", "clients", "jobs",
        "assignments", "inventory_items", "inventory_transactions", "files",
    ]
    for name in id_collections:
        collection = db[name]
        for row in await find_duplicates(collection, "id"):
            add(issues, f"DUPLICATE {name}.id={row['_id']!r} count={row['count']}")

    active_dupes = await db.assignments.aggregate([
        {"$match": {"status": "Active"}},
        {"$group": {"_id": "$equipment_id", "count": {"$sum": 1}, "ids": {"$push": "$id"}}},
        {"$match": {"count": {"$gt": 1}}},
    ]).to_list(2000)
    for row in active_dupes:
        add(issues, f"MULTIPLE ACTIVE ASSIGNMENTS equipment={row['_id']} ids={row['ids']}")

    active = await db.assignments.find({"status": "Active"}, {"_id": 0}).to_list(100000)
    for assignment in active:
        eq = await db.equipment.find_one({"id": assignment.get("equipment_id")}, {"_id": 0})
        if not eq:
            add(issues, f"ORPHAN ACTIVE ASSIGNMENT {assignment.get('id')} missing equipment")
            continue
        if eq.get("placement") != "Job" or eq.get("current_job_id") != assignment.get("job_id"):
            add(
                issues,
                f"ASSIGNMENT/LOCATION MISMATCH equipment={eq.get('id')} assignment={assignment.get('id')} "
                f"placement={eq.get('placement')} current_job={eq.get('current_job_id')} assignment_job={assignment.get('job_id')}",
            )

    open_deducted = await db.maintenance.find(
        {"status": "Open", "parts_deducted": True},
        {"_id": 0, "id": 1, "mnt_no": 1},
    ).to_list(10000)
    for row in open_deducted:
        add(issues, f"OPEN MAINTENANCE WITH parts_deducted=True {row.get('mnt_no')} ({row.get('id')})")

    orphan_files = await db.files.find(
        {"maintenance_id": {"$nin": [None, ""]}, "is_deleted": False},
        {"_id": 0, "id": 1, "maintenance_id": 1, "equipment_id": 1},
    ).to_list(100000)
    for file in orphan_files:
        mnt = await db.maintenance.find_one({"id": file.get("maintenance_id")}, {"_id": 0, "equipment_id": 1})
        if not mnt:
            add(issues, f"ORPHAN FILE {file.get('id')} maintenance={file.get('maintenance_id')} missing")
        elif file.get("equipment_id") and file.get("equipment_id") != mnt.get("equipment_id"):
            add(issues, f"FILE/EQUIPMENT MISMATCH file={file.get('id')} maintenance={file.get('maintenance_id')}")


async def main():
    issues = []
    warnings = []
    check_environment(issues, warnings)
    check_source(issues)
    await check_database(issues)

    print("AMT Final Security Preflight")
    print("============================")
    for warning in warnings:
        print(f"WARNING: {warning}")

    if issues:
        print(f"FAIL: {len(issues)} blocking issue(s):")
        for issue in issues:
            print(f" - {issue}")
        return 2

    print("PASS: source, environment, and critical data checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
