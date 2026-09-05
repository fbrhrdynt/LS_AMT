from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from pymongo import ReturnDocument

from core import db, new_id, now_iso, gen_job_no, audit_log
from auth import get_current_user, require_roles

router = APIRouter(prefix="/api")
MANAGE = require_roles("admin", "supervisor")


class ClientBody(BaseModel):
    name: str
    code: str = ""
    contact: str = ""
    notes: str = ""


class JobBody(BaseModel):
    field_name: str = ""
    job_name: str = ""
    client_id: str
    site_location: str = ""
    start_date: str | None = None
    end_date: str | None = None
    status: str = "Active"
    notes: str = ""


class AssignBody(BaseModel):
    equipment_id: str
    mobilization_date: str | None = None


def _job_field_name(job: dict | None) -> str:
    if not job:
        return ""
    return (job.get("field_name") or job.get("job_name") or "").strip()


# -------- clients --------
@router.get("/clients")
async def list_clients(user: dict = Depends(get_current_user)):
    clients = await db.clients.find({}, {"_id": 0}).sort("name", 1).to_list(1000)
    for c in clients:
        c["job_count"] = await db.jobs.count_documents({"client_id": c["id"]})
    return clients


@router.post("/clients")
async def create_client(body: ClientBody, user: dict = Depends(MANAGE)):
    doc = body.model_dump()
    doc.update({"id": new_id(), "created_at": now_iso()})
    await db.clients.insert_one(doc)
    await audit_log("client", doc["id"], "client.create", user, f"Created {body.name}")
    doc.pop("_id", None)
    return doc


@router.put("/clients/{cid}")
async def update_client(cid: str, body: ClientBody, user: dict = Depends(MANAGE)):
    res = await db.clients.update_one({"id": cid}, {"$set": body.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Client not found")
    await audit_log("client", cid, "client.update", user, f"Updated {body.name}")
    return await db.clients.find_one({"id": cid}, {"_id": 0})


@router.delete("/clients/{cid}")
async def delete_client(cid: str, user: dict = Depends(MANAGE)):
    client = await db.clients.find_one({"id": cid})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    if await db.jobs.count_documents({"client_id": cid}):
        raise HTTPException(status_code=400, detail="Client has jobs. Delete the jobs first.")
    await db.clients.delete_one({"id": cid})
    await audit_log("client", cid, "client.delete", user, f"Deleted {client['name']}")
    return {"ok": True}


# -------- jobs --------
@router.get("/jobs")
async def list_jobs(client_id: str = "", status: str = "", q: str = "",
                    user: dict = Depends(get_current_user)):
    query = {}
    if client_id:
        query["client_id"] = client_id
    if status:
        query["status"] = status
    if q:
        query["$or"] = [
            {"job_number": {"$regex": q, "$options": "i"}},
            {"field_name": {"$regex": q, "$options": "i"}},
            {"job_name": {"$regex": q, "$options": "i"}},
            {"client_name": {"$regex": q, "$options": "i"}},
            {"site_location": {"$regex": q, "$options": "i"}},
        ]
    jobs = await db.jobs.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    for j in jobs:
        j["field_name"] = _job_field_name(j)
        j["equipment_count"] = await db.assignments.count_documents({"job_id": j["id"], "status": "Active"})
    return jobs


@router.post("/jobs")
async def create_job(body: JobBody, user: dict = Depends(MANAGE)):
    field_name = (body.field_name or body.job_name).strip()
    if not field_name:
        raise HTTPException(status_code=400, detail="Field Name is required")
    client = await db.clients.find_one({"id": body.client_id})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    job_no = await gen_job_no()
    doc = body.model_dump()
    doc.update({
        "id": new_id(),
        "job_number": job_no,
        "field_name": field_name,
        "job_name": field_name,
        "client_name": client["name"],
        "created_at": now_iso(),
    })
    await db.jobs.insert_one(doc)
    await audit_log("job", doc["id"], "job.create", user, f"Created {job_no} - {field_name}")
    doc.pop("_id", None)
    return doc


@router.put("/jobs/{jid}")
async def update_job(jid: str, body: JobBody, user: dict = Depends(MANAGE)):
    job = await db.jobs.find_one({"id": jid})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    field_name = (body.field_name or body.job_name).strip()
    if not field_name:
        raise HTTPException(status_code=400, detail="Field Name is required")
    client = await db.clients.find_one({"id": body.client_id})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    updates = body.model_dump()
    updates.update({
        "field_name": field_name,
        "job_name": field_name,
        "client_name": client["name"],
    })
    await db.jobs.update_one({"id": jid}, {"$set": updates})
    await audit_log("job", jid, "job.update", user, f"Updated {job['job_number']}")
    return await db.jobs.find_one({"id": jid}, {"_id": 0})


@router.delete("/jobs/{jid}")
async def delete_job(jid: str, user: dict = Depends(MANAGE)):
    job = await db.jobs.find_one({"id": jid})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if await db.assignments.count_documents({"job_id": jid, "status": "Active"}):
        raise HTTPException(status_code=400, detail="Job has equipment on active assignment. Demobilize first.")
    await db.assignments.delete_many({"job_id": jid})
    await db.jobs.delete_one({"id": jid})
    await audit_log("job", jid, "job.delete", user, f"Deleted {job['job_number']}")
    return {"ok": True}


@router.get("/jobs/{jid}")
async def job_detail(jid: str, user: dict = Depends(get_current_user)):
    job = await db.jobs.find_one({"id": jid}, {"_id": 0})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job["field_name"] = _job_field_name(job)
    assignments = await db.assignments.find({"job_id": jid}, {"_id": 0}).sort("mobilization_date", -1).to_list(1000)
    eq_ids = list({a["equipment_id"] for a in assignments})
    equipment = await db.equipment.find({"id": {"$in": eq_ids}}, {"_id": 0}).to_list(1000)
    maintenance = await db.maintenance.find({"job_id": jid}, {"_id": 0}).sort("maintenance_date", -1).to_list(1000)
    mnt_ids = [m["id"] for m in maintenance]
    failures = await db.failures.find({"maintenance_id": {"$in": mnt_ids}}, {"_id": 0}).to_list(1000)
    parts = await db.inventory_transactions.find(
        {"maintenance_id": {"$in": mnt_ids}, "direction": "out"}, {"_id": 0}).to_list(1000)
    return {"job": job, "assignments": assignments, "equipment": equipment,
            "maintenance": maintenance, "failures": failures, "parts_consumption": parts}


# -------- assignments --------
@router.post("/jobs/{jid}/assign")
async def assign_equipment(jid: str, body: AssignBody, user: dict = Depends(MANAGE)):
    job = await db.jobs.find_one({"id": jid})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.get("status") in ("Completed", "Cancelled"):
        raise HTTPException(status_code=400, detail="Cannot assign equipment to a completed/cancelled Job")
    eq = await db.equipment.find_one({"id": body.equipment_id})
    if not eq:
        raise HTTPException(status_code=404, detail="Equipment not found")
    if await db.assignments.find_one({"equipment_id": eq["id"], "status": "Active"}):
        raise HTTPException(status_code=400, detail="Equipment already has an active Job assignment; demobilize first")

    op_id = new_id()
    claimed = await db.equipment.find_one_and_update(
        {
            "id": eq["id"], "placement": {"$ne": "Job"},
            "$and": [
                {"$or": [{"current_job_id": None}, {"current_job_id": {"$exists": False}}]},
                {"$or": [{"assignment_lock": {"$exists": False}}, {"assignment_lock": None}]},
            ],
        },
        {"$set": {"assignment_lock": {"operation_id": op_id, "job_id": jid, "at": now_iso()}}},
        return_document=ReturnDocument.AFTER,
    )
    if not claimed:
        raise HTTPException(status_code=409, detail="Equipment assignment/location changed concurrently; reload and try again")

    doc = {
        "id": new_id(), "assignment_operation_id": op_id, "equipment_id": eq["id"],
        "equipment_name": eq.get("name"), "sap_no": eq["sap_no"], "job_id": jid,
        "job_number": job["job_number"], "field_name": _job_field_name(job),
        "site_location": job.get("site_location"), "client_id": job["client_id"],
        "client_name": job.get("client_name"),
        "mobilization_date": body.mobilization_date or now_iso()[:10],
        "demobilization_date": None, "status": "Active",
        "return_placement": eq.get("placement") or "Base", "created_at": now_iso(),
    }
    try:
        await db.assignments.insert_one(doc)
        result = await db.equipment.update_one(
            {"id": eq["id"], "assignment_lock.operation_id": op_id, "$or": [
                {"current_job_id": None}, {"current_job_id": {"$exists": False}}
            ]},
            {"$set": {
                "placement": "Job", "placement_detail": job["job_number"],
                "current_job_id": jid, "current_client_id": job["client_id"], "updated_at": now_iso(),
            }, "$unset": {"assignment_lock": ""}},
        )
        if result.matched_count != 1:
            raise RuntimeError("Equipment assignment claim lost")
    except Exception:
        await db.assignments.delete_one({"id": doc["id"], "assignment_operation_id": op_id, "status": "Active"})
        await db.equipment.update_one({"id": eq["id"], "assignment_lock.operation_id": op_id}, {"$unset": {"assignment_lock": ""}})
        raise

    await db.location_history.insert_one({
        "id": new_id(), "operation_id": op_id, "equipment_id": eq["id"],
        "from_placement": eq.get("placement"), "to_placement": "Job",
        "placement_detail": job["job_number"], "job_id": jid,
        "reason": f"Mobilized to {job['job_number']}", "created_by": user["name"], "created_at": now_iso(),
    })
    await audit_log("assignment", doc["id"], "assignment.mobilize", user,
                    f"{eq['sap_no']} -> {job['job_number']}", extra={"operation_id": op_id})
    doc.pop("_id", None)
    return doc


class DemobBody(BaseModel):
    demobilization_date: str | None = None
    return_placement: str = "Base"


@router.post("/assignments/{aid}/demobilize")
async def demobilize(aid: str, body: DemobBody, user: dict = Depends(MANAGE)):
    if body.return_placement != "Base":
        raise HTTPException(status_code=400, detail="Demobilized equipment must return to Base")
    op_id = new_id()
    assignment = await db.assignments.find_one_and_update(
        {"id": aid, "status": "Active", "$or": [
            {"demobilization_lock": {"$exists": False}}, {"demobilization_lock": None}
        ]},
        {"$set": {"demobilization_lock": {"operation_id": op_id, "at": now_iso()}}},
        return_document=ReturnDocument.AFTER,
    )
    if not assignment:
        old = await db.assignments.find_one({"id": aid})
        if not old:
            raise HTTPException(status_code=404, detail="Assignment not found")
        if old.get("status") != "Active":
            raise HTTPException(status_code=400, detail="Assignment already closed")
        raise HTTPException(status_code=409, detail="Demobilization is already in progress")

    eq = await db.equipment.find_one({"id": assignment["equipment_id"]})
    if not eq or eq.get("current_job_id") != assignment.get("job_id") or eq.get("placement") != "Job":
        await db.assignments.update_one(
            {"id": aid, "demobilization_lock.operation_id": op_id}, {"$unset": {"demobilization_lock": ""}}
        )
        raise HTTPException(status_code=409, detail="Assignment and Equipment current location are inconsistent; run integrity preflight")

    moved = await db.equipment.update_one(
        {"id": assignment["equipment_id"], "current_job_id": assignment["job_id"], "placement": "Job"},
        {"$set": {
            "placement": "Base", "placement_detail": "Base", "current_job_id": None,
            "current_client_id": None, "location_operation_id": op_id, "updated_at": now_iso(),
        }},
    )
    if moved.matched_count != 1:
        await db.assignments.update_one({"id": aid, "demobilization_lock.operation_id": op_id}, {"$unset": {"demobilization_lock": ""}})
        raise HTTPException(status_code=409, detail="Equipment changed concurrently; retry demobilization")

    try:
        closed = await db.assignments.update_one(
            {"id": aid, "status": "Active", "demobilization_lock.operation_id": op_id},
            {"$set": {
                "status": "Closed", "demobilization_date": body.demobilization_date or now_iso()[:10],
                "return_placement": "Base",
            }, "$unset": {"demobilization_lock": ""}},
        )
        if closed.matched_count != 1:
            raise RuntimeError("Assignment demobilization claim lost")
    except Exception:
        await db.equipment.update_one(
            {"id": assignment["equipment_id"], "location_operation_id": op_id},
            {"$set": {
                "placement": "Job", "placement_detail": assignment["job_number"],
                "current_job_id": assignment["job_id"], "current_client_id": assignment["client_id"],
                "updated_at": now_iso(),
            }, "$unset": {"location_operation_id": ""}},
        )
        await db.assignments.update_one({"id": aid, "demobilization_lock.operation_id": op_id}, {"$unset": {"demobilization_lock": ""}})
        raise

    await db.equipment.update_one({"id": assignment["equipment_id"], "location_operation_id": op_id}, {"$unset": {"location_operation_id": ""}})
    await db.location_history.insert_one({
        "id": new_id(), "operation_id": op_id, "equipment_id": assignment["equipment_id"],
        "from_placement": "Job", "to_placement": "Base", "placement_detail": "Base",
        "job_id": assignment["job_id"], "reason": f"Demobilized from {assignment['job_number']}",
        "created_by": user["name"], "created_at": now_iso(),
    })
    await audit_log("assignment", aid, "assignment.demobilize", user,
                    f"{assignment['sap_no']} returned to Base", extra={"operation_id": op_id})
    return await db.assignments.find_one({"id": aid}, {"_id": 0})
