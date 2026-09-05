# Read-only AMT integrity preflight. No data is modified.
import asyncio
from core import db

async def duplicates(collection, field):
    return await collection.aggregate([
        {"$match": {field: {"$exists": True, "$nin": [None, ""]}}},
        {"$group": {"_id": f"${field}", "count": {"$sum": 1}, "ids": {"$push": "$id"}}},
        {"$match": {"count": {"$gt": 1}}},
    ]).to_list(1000)

async def main():
    issues = []
    for label, collection, field in [
        ("equipment.sap_no", db.equipment, "sap_no"),
        ("maintenance.mnt_no", db.maintenance, "mnt_no"),
        ("jobs.job_number", db.jobs, "job_number"),
        ("inventory.item_code", db.inventory_items, "item_code"),
    ]:
        for row in await duplicates(collection, field):
            issues.append(f"DUPLICATE {label}={row['_id']!r} count={row['count']} ids={row['ids']}")

    for row in await db.assignments.aggregate([
        {"$match": {"status": "Active"}},
        {"$group": {"_id": "$equipment_id", "count": {"$sum": 1}, "ids": {"$push": "$id"}, "jobs": {"$push": "$job_id"}}},
        {"$match": {"count": {"$gt": 1}}},
    ]).to_list(1000):
        issues.append(f"MULTIPLE ACTIVE ASSIGNMENTS equipment={row['_id']} count={row['count']} assignments={row['ids']} jobs={row['jobs']}")

    for eq in await db.equipment.find({"assignment_lock": {"$exists": True, "$ne": None}}, {"_id": 0, "id": 1, "sap_no": 1, "assignment_lock": 1}).to_list(10000):
        issues.append(f"PENDING ASSIGNMENT LOCK equipment={eq.get('id')} sap={eq.get('sap_no')} lock={eq.get('assignment_lock')}")

    for row in await db.assignments.find({"demobilization_lock": {"$exists": True, "$ne": None}}, {"_id": 0, "id": 1, "equipment_id": 1, "demobilization_lock": 1}).to_list(10000):
        issues.append(f"PENDING DEMOBILIZATION LOCK assignment={row.get('id')} equipment={row.get('equipment_id')} lock={row.get('demobilization_lock')}")

    active = await db.assignments.find({"status": "Active"}, {"_id": 0}).to_list(100000)
    for a in active:
        eq = await db.equipment.find_one({"id": a["equipment_id"]}, {"_id": 0})
        if not eq:
            issues.append(f"ORPHAN ACTIVE ASSIGNMENT {a['id']} equipment={a['equipment_id']}")
        elif eq.get("placement") != "Job" or eq.get("current_job_id") != a.get("job_id"):
            issues.append(f"ASSIGNMENT/LOCATION MISMATCH equipment={eq['id']} assignment={a['id']} assignment_job={a.get('job_id')} placement={eq.get('placement')} current_job={eq.get('current_job_id')}")

    for row in await db.failures.aggregate([
        {"$match": {"maintenance_id": {"$exists": True, "$nin": [None, ""]}}},
        {"$group": {"_id": "$maintenance_id", "count": {"$sum": 1}, "ids": {"$push": "$id"}}},
        {"$match": {"count": {"$gt": 1}}},
    ]).to_list(1000):
        issues.append(f"MULTIPLE FAILURE ROWS maintenance={row['_id']} count={row['count']} ids={row['ids']}")

    for row in await db.maintenance.find({"status": "Open", "parts_deducted": True}, {"_id": 0, "id": 1, "mnt_no": 1}).to_list(10000):
        issues.append(f"OPEN MAINTENANCE WITH parts_deducted=True {row.get('mnt_no')} ({row.get('id')})")

    print("AMT Integrity Preflight")
    print("=======================")
    if not issues:
        print("PASS: no critical integrity inconsistencies detected.")
        return 0
    print(f"FAIL: {len(issues)} issue(s) detected:")
    for issue in issues:
        print(" -", issue)
    print("\nDo not restart with P1 until these rows are reviewed.")
    return 2

if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
