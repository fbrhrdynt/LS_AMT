from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError
from core import db, now_iso, audit_log
from auth import get_current_user

router = APIRouter(prefix="/api/trash")
async def trash_admin(user: dict = Depends(get_current_user)):
    import os
    role = str(user.get("role") or "").lower()
    env = os.environ.get("APP_ENV", "production").strip().lower()
    if role == "master_admin" or (env != "production" and role == "admin"):
        return user
    raise HTTPException(status_code=403, detail="Trash access is restricted to MASTER ADMIN")
COLLECTIONS = {
    "equipment": ("equipment", "Equipment"),
    "inventory": ("inventory_items", "Inventory"),
    "jobs": ("jobs", "Job"),
    "clients": ("clients", "Client"),
}

@router.get("")
async def list_trash(entity_type: str = "", q: str = "", user: dict = Depends(trash_admin)):
    selected = {entity_type: COLLECTIONS[entity_type]} if entity_type in COLLECTIONS else COLLECTIONS
    items = []
    for key, (collection_name, label) in selected.items():
        query = {"deleted_at": {"$exists": True, "$nin": [None, ""]}}
        if q:
            query["$or"] = [{field: {"$regex": q[:80], "$options": "i"}} for field in ("name", "item_name", "item_code", "sap_no", "job_number", "field_name")]
        cursor = db[collection_name].find(query, {"_id": 0}).sort("deleted_at", -1).limit(250)
        for doc in await cursor.to_list(250):
            doc["entity_type"] = key
            doc["entity_label"] = label
            items.append(doc)
    items.sort(key=lambda x: x.get("deleted_at") or "", reverse=True)
    return {"total": len(items), "items": items[:500]}

@router.post("/{entity_type}/{record_id}/restore")
async def restore_record(entity_type: str, record_id: str, user: dict = Depends(MASTER_ADMIN)):
    config = COLLECTIONS.get(entity_type)
    if not config:
        raise HTTPException(status_code=404, detail="Unsupported Trash record type")
    collection_name, label = config
    collection = db[collection_name]
    record = await collection.find_one({"id": record_id, "deleted_at": {"$exists": True, "$nin": [None, ""]}})
    if not record:
        raise HTTPException(status_code=404, detail="Deleted record not found")
    if entity_type == "equipment":
        active = await db.assignments.find_one({"equipment_id": record_id, "status": "Active"})
        if active or record.get("current_job_id") or record.get("placement") == "Job":
            raise HTTPException(status_code=409, detail="Cannot restore equipment with an active Job assignment")
    if entity_type == "jobs" and record.get("client_id"):
        if not await db.clients.find_one({"id": record["client_id"], "deleted_at": None}):
            raise HTTPException(status_code=409, detail="Restore the related Client first")
    if entity_type == "inventory":
        duplicate = await collection.find_one({"item_code": record.get("item_code"), "id": {"$ne": record_id}, "deleted_at": None})
        if duplicate:
            raise HTTPException(status_code=409, detail="An active item already uses this item code")
    try:
        result = await collection.update_one(
            {"id": record_id, "deleted_at": {"$exists": True, "$nin": [None, ""]}},
            {"$set": {"updated_at": now_iso()}, "$unset": {"deleted_at": "", "deleted_by": "", "deleted_by_name": "", "delete_reason": ""}},
        )
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Restore conflicts with an existing unique record")
    if result.modified_count != 1:
        raise HTTPException(status_code=409, detail="Record changed; refresh Trash and try again")
    await audit_log(entity_type, record_id, entity_type + ".restore", user, "Restored " + label)
    return {"ok": True, "restored": True}
