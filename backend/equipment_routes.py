import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, new_id, now_iso, now_utc, audit_log
from auth import get_current_user, require_roles

router = APIRouter(prefix="/api")

MANAGE = require_roles("admin", "supervisor")


def rx(q):
    return {"$regex": re.escape(q), "$options": "i"}


class EquipmentBody(BaseModel):
    sap_no: str
    mfg_no: str = ""
    name: str = ""
    category: str = ""
    manufacturer: str = ""
    date_of_purchase: str | None = None
    physical_condition: str = ""
    placement: str = "Base"
    placement_detail: str = "Base"
    operational_status: str = "Operational"


class MoveBody(BaseModel):
    placement: str
    placement_detail: str = ""
    reason: str = ""


@router.get("/equipment")
async def list_equipment(q: str = "", placement: str = "", status: str = "",
                         category: str = "", page: int = 1, page_size: int = 20,
                         user: dict = Depends(get_current_user)):
    query = {}
    if q:
        query["$or"] = [{"sap_no": rx(q)}, {"mfg_no": rx(q)}, {"name": rx(q)},
                        {"category": rx(q)}, {"manufacturer": rx(q)}]
    if placement:
        query["placement"] = placement
    if status:
        query["operational_status"] = status
    if category:
        query["category"] = category
    total = await db.equipment.count_documents(query)
    page = max(1, page)
    cursor = db.equipment.find(query, {"_id": 0}).sort("sap_no", 1).skip((page - 1) * page_size).limit(page_size)
    items = await cursor.to_list(page_size)
    return {"total": total, "page": page, "page_size": page_size, "items": items}


@router.get("/equipment/categories")
async def categories(user: dict = Depends(get_current_user)):
    return await db.equipment.distinct("category")


@router.get("/equipment/{eid}")
async def get_equipment(eid: str, user: dict = Depends(get_current_user)):
    eq = await db.equipment.find_one({"id": eid}, {"_id": 0})
    if not eq:
        raise HTTPException(status_code=404, detail="Equipment not found")
    mnts = await db.maintenance.find({"equipment_id": eid}, {"_id": 0}).sort("maintenance_date", -1).to_list(1000)
    failures = await db.failures.find({"equipment_id": eid}, {"_id": 0}).sort("occurred_date", -1).to_list(1000)
    loc_hist = await db.location_history.find({"equipment_id": eid}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    assignments = await db.assignments.find({"equipment_id": eid}, {"_id": 0}).sort("mobilization_date", -1).to_list(1000)
    files = await db.files.find({"equipment_id": eid, "is_deleted": False}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    # parts consumption history from transactions
    parts = await db.inventory_transactions.find(
        {"equipment_id": eid, "direction": "out"}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    # recurring failure summary for this equipment
    agg = {}
    for f in failures:
        key = (f.get("failure_name") or "").strip().lower()
        if not key:
            continue
        agg.setdefault(key, {"failure_name": f["failure_name"], "count": 0, "occurrences": []})
        agg[key]["count"] += 1
        agg[key]["occurrences"].append({"maintenance_id": f.get("maintenance_id"), "mnt_no": f.get("mnt_no"),
                                        "occurred_date": f.get("occurred_date")})
    recurring = sorted(agg.values(), key=lambda x: -x["count"])
    return {"equipment": eq, "maintenance": mnts, "failures": failures,
            "recurring_failures": recurring, "location_history": loc_hist,
            "assignments": assignments, "documents": files, "parts_consumption": parts}


@router.post("/equipment")
async def create_equipment(body: EquipmentBody, user: dict = Depends(MANAGE)):
    if await db.equipment.find_one({"sap_no": body.sap_no}):
        raise HTTPException(status_code=400, detail="SAP number already exists")
    doc = body.model_dump()
    doc.update({"id": new_id(), "current_job_id": None, "current_client_id": None,
                "source": "manual", "created_at": now_iso(), "updated_at": now_iso()})
    await db.equipment.insert_one(doc)
    await db.location_history.insert_one({
        "id": new_id(), "equipment_id": doc["id"], "from_placement": None,
        "to_placement": doc["placement"], "placement_detail": doc["placement_detail"],
        "job_id": None, "reason": "Initial registration", "created_by": user["name"],
        "created_at": now_iso()})
    await audit_log("equipment", doc["id"], "equipment.create", user, f"Created {body.sap_no}")
    doc.pop("_id", None)
    return doc


@router.put("/equipment/{eid}")
async def update_equipment(eid: str, body: EquipmentBody, user: dict = Depends(MANAGE)):
    eq = await db.equipment.find_one({"id": eid})
    if not eq:
        raise HTTPException(status_code=404, detail="Equipment not found")
    updates = body.model_dump()
    updates["updated_at"] = now_iso()
    await db.equipment.update_one({"id": eid}, {"$set": updates})
    await audit_log("equipment", eid, "equipment.update", user, f"Updated {eq['sap_no']}")
    return await db.equipment.find_one({"id": eid}, {"_id": 0})


@router.post("/equipment/{eid}/move")
async def move_equipment(eid: str, body: MoveBody, user: dict = Depends(MANAGE)):
    eq = await db.equipment.find_one({"id": eid})
    if not eq:
        raise HTTPException(status_code=404, detail="Equipment not found")
    await db.equipment.update_one({"id": eid}, {"$set": {
        "placement": body.placement, "placement_detail": body.placement_detail or body.placement,
        "updated_at": now_iso()}})
    await db.location_history.insert_one({
        "id": new_id(), "equipment_id": eid, "from_placement": eq.get("placement"),
        "to_placement": body.placement, "placement_detail": body.placement_detail or body.placement,
        "job_id": None, "reason": body.reason or "Manual move", "created_by": user["name"],
        "created_at": now_iso()})
    await audit_log("equipment", eid, "equipment.move", user,
                    f"{eq.get('placement')} -> {body.placement}")
    return await db.equipment.find_one({"id": eid}, {"_id": 0})


class StatusBody(BaseModel):
    operational_status: str


@router.delete("/equipment/{eid}")
async def delete_equipment(eid: str, user: dict = Depends(MANAGE)):
    eq = await db.equipment.find_one({"id": eid})
    if not eq:
        raise HTTPException(status_code=404, detail="Equipment not found")
    active = await db.assignments.find_one({"equipment_id": eid, "status": "Active"})
    if active:
        raise HTTPException(status_code=400, detail="Equipment is on an active job. Demobilize first.")
    await db.maintenance.delete_many({"equipment_id": eid})
    await db.failures.delete_many({"equipment_id": eid})
    await db.assignments.delete_many({"equipment_id": eid})
    await db.location_history.delete_many({"equipment_id": eid})
    await db.files.update_many({"equipment_id": eid}, {"$set": {"is_deleted": True}})
    await db.equipment.delete_one({"id": eid})
    await audit_log("equipment", eid, "equipment.delete", user, f"Deleted {eq['sap_no']} (+ related records)")
    return {"ok": True}


@router.patch("/equipment/{eid}/status")
async def set_status(eid: str, body: StatusBody, user: dict = Depends(MANAGE)):
    res = await db.equipment.update_one({"id": eid}, {"$set": {
        "operational_status": body.operational_status, "updated_at": now_iso()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Equipment not found")
    await audit_log("equipment", eid, "equipment.status", user, body.operational_status)
    return await db.equipment.find_one({"id": eid}, {"_id": 0})


# -------- global search --------
@router.get("/search")
async def global_search(q: str = "", user: dict = Depends(get_current_user)):
    if not q or len(q) < 1:
        return {"equipment": [], "jobs": [], "clients": []}
    eq = await db.equipment.find(
        {"$or": [{"sap_no": rx(q)}, {"mfg_no": rx(q)}, {"name": rx(q)}, {"category": rx(q)}]},
        {"_id": 0}).limit(10).to_list(10)
    jobs = await db.jobs.find(
        {"$or": [{"job_number": rx(q)}, {"job_name": rx(q)}]}, {"_id": 0}).limit(10).to_list(10)
    clients = await db.clients.find({"name": rx(q)}, {"_id": 0}).limit(10).to_list(10)
    return {"equipment": eq, "jobs": jobs, "clients": clients}


# -------- dashboard --------
@router.get("/dashboard")
async def dashboard(user: dict = Depends(get_current_user)):
    total = await db.equipment.count_documents({})
    operational = await db.equipment.count_documents({"operational_status": "Operational"})
    under_maint = await db.equipment.count_documents({"operational_status": "Under Maintenance"})
    at_base = await db.equipment.count_documents({"placement": "Base"})
    at_workshop = await db.equipment.count_documents({"placement": "Workshop"})
    on_job = await db.equipment.count_documents({"placement": "Job"})
    in_transit = await db.equipment.count_documents({"placement": "Transit"})
    active_jobs = await db.jobs.count_documents({"status": {"$in": ["Active", "Open", "In Progress"]}})
    open_maint = await db.maintenance.count_documents({"status": "Open"})
    low_stock_items = await db.inventory_items.find({"$expr": {"$lte": ["$stock", "$min_stock"]}}, {"_id": 0}).to_list(1000)

    now = now_utc()
    month_prefix = f"{now.year}-{now.month:02d}"
    maint_this_month = await db.maintenance.count_documents({"maintenance_date": {"$regex": f"^{month_prefix}"}})

    # recurring failures (>=2)
    pipeline = [{"$group": {"_id": {"$toLower": "$failure_name"},
                            "failure_name": {"$first": "$failure_name"},
                            "count": {"$sum": 1}}},
                {"$match": {"count": {"$gte": 2}}}, {"$sort": {"count": -1}}]
    recurring = await db.failures.aggregate(pipeline).to_list(1000)
    recurring = [{"failure_name": r["failure_name"], "count": r["count"]} for r in recurring if r.get("failure_name")]

    recent = await db.maintenance.find({}, {"_id": 0}).sort("created_at", -1).limit(8).to_list(8)

    # equipment with most failures
    eqpipe = [{"$group": {"_id": "$equipment_id", "count": {"$sum": 1}}},
              {"$sort": {"count": -1}}, {"$limit": 5}]
    topeq = await db.failures.aggregate(eqpipe).to_list(5)
    equipment_most_failures = []
    for t in topeq:
        eqd = await db.equipment.find_one({"id": t["_id"]}, {"_id": 0})
        if eqd:
            equipment_most_failures.append({"equipment": eqd, "count": t["count"]})

    # most consumed parts
    ppipe = [{"$match": {"direction": "out"}},
             {"$group": {"_id": "$item_id", "item_name": {"$first": "$item_name"},
                         "item_code": {"$first": "$item_code"}, "qty": {"$sum": "$qty"}}},
             {"$sort": {"qty": -1}}, {"$limit": 5}]
    most_parts = await db.inventory_transactions.aggregate(ppipe).to_list(5)

    return {
        "total_equipment": total, "operational": operational, "under_maintenance": under_maint,
        "at_base": at_base, "at_workshop": at_workshop, "on_job": on_job, "in_transit": in_transit,
        "active_jobs": active_jobs, "maintenance_this_month": maint_this_month,
        "open_maintenance": open_maint, "repeated_failures": len(recurring),
        "low_stock": len(low_stock_items),
        "recent_maintenance": recent,
        "equipment_most_failures": equipment_most_failures,
        "most_common_failures": recurring[:5],
        "most_consumed_parts": [{"item_name": p.get("item_name"), "item_code": p.get("item_code"), "qty": p["qty"]} for p in most_parts],
        "low_stock_items": low_stock_items,
    }
