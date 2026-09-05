import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import (APIRouter, Depends, HTTPException, UploadFile, File, Form,
                     Header, Query, Response, Request)
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from core import db, new_id, now_iso, gen_maintenance_no, audit_log
from auth import get_current_user, require_roles
from storage import (
    put_object,
    get_object,
    delete_object,
    APP_NAME,
    ALLOWED_EXT,
    MAX_SIZE,
    MIME_TYPES,
    DOCUMENT_TYPES,
    read_upload_limited,
    validate_file_bytes,
    safe_original_filename,
    content_disposition,
)
from pdf_report import build_maintenance_pdf

router = APIRouter(prefix="/api")

EDIT = require_roles("admin", "supervisor", "technician")
MANAGE = require_roles("admin", "supervisor")

SUPPLY_SOURCES = ("Ex-Stock", "Purchase")


class PartLine(BaseModel):
    item_id: str
    qty: float = Field(gt=0)
    supply_source: Literal["Ex-Stock", "Purchase"] = "Ex-Stock"
    stock_override: bool = False


class MaintenanceBody(BaseModel):
    equipment_id: str
    maintenance_date: str | None = None
    type_of_maintenance: str = ""
    maintenance_category: str = ""
    maintenance_purpose: str = ""
    problem_damage: str = ""
    failure_found: str = ""
    root_cause: str = ""
    action_taken: str = ""
    duration_days: int = 0
    lead_technician: str = ""
    support_technicians: list[str] = []
    checked_by: str = ""
    final_condition: str = ""
    remark: str = ""
    client_id: str | None = None
    job_id: str | None = None
    notes: str = ""
    parts: list[PartLine] = []


class CloseBody(BaseModel):
    date_closed: str | None = None
    duration_days: int | None = None
    failure_found: str | None = None
    root_cause: str | None = None
    action_taken: str | None = None
    final_condition: str | None = None
    checked_by: str | None = None
    remark: str | None = None
    support_technicians: list[str] | None = None
    parts: list[PartLine] | None = None


def _part_source(part: dict) -> str:
    source = part.get("supply_source") or "Ex-Stock"
    return source if source in SUPPLY_SOURCES else "Ex-Stock"


def _part_uses_inventory(part: dict) -> bool:
    return _part_source(part) == "Ex-Stock"


async def _resolve_parts(part_lines):
    resolved = []
    for pl in part_lines:
        item = await db.inventory_items.find_one({"id": pl.item_id})
        if not item:
            raise HTTPException(status_code=400, detail=f"Inventory item not found: {pl.item_id}")

        source = pl.supply_source if pl.supply_source in SUPPLY_SOURCES else "Ex-Stock"
        stock_override = bool(pl.stock_override) if source == "Ex-Stock" else False
        price = float(item.get("unit_price") or 0)
        purchase_price = price if source == "Purchase" else 0.0
        purchase_cost = (
            round(price * float(pl.qty), 2)
            if source == "Purchase"
            else 0.0
        )

        resolved.append({
            "item_id": item["id"],
            "item_code": item["item_code"],
            "item_name": item["item_name"],
            "type": item["type"],
            "unit": item["unit"],
            "qty": float(pl.qty),
            # Maintenance pricing represents direct Purchase spend only.
            # Ex-Stock valuation stays in Inventory and is intentionally
            # omitted from maintenance display/reporting.
            "unit_price": purchase_price,
            "cost": purchase_cost,
            "supply_source": source,
            "stock_override": stock_override,
            "stock_override_applied": False,
        })
    return resolved


def _total_cost(parts):
    """Direct Purchase spend only; Ex-Stock pricing is intentionally excluded."""
    return round(
        sum(
            float(p.get("cost") or 0)
            for p in parts
            if _part_source(p) == "Purchase"
        ),
        2,
    )



LIFECYCLE_LEASE_SECONDS = 120
STOCK_OPERATION_LOG_LIMIT = 5000


def _lock_age_seconds(lock: dict | None) -> float:
    if not lock or not lock.get("at"):
        return 10**9
    try:
        when = datetime.fromisoformat(str(lock["at"]).replace("Z", "+00:00"))
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - when.astimezone(timezone.utc)).total_seconds()
    except Exception:
        return 10**9


async def _claim_lifecycle(mid: str, expected_status: str, action: str, payload: dict | None = None):
    operation_id = new_id()
    lease_id = new_id()
    lock = {
        "action": action,
        "operation_id": operation_id,
        "lease_id": lease_id,
        "at": now_iso(),
        "payload": payload or {},
    }
    claimed = await db.maintenance.find_one_and_update(
        {
            "id": mid,
            "status": expected_status,
            "$or": [
                {"lifecycle_lock": {"$exists": False}},
                {"lifecycle_lock": None},
            ],
        },
        {"$set": {"lifecycle_lock": lock}},
        return_document=ReturnDocument.AFTER,
    )
    if claimed:
        return claimed, lock, False

    current = await db.maintenance.find_one({"id": mid})
    if not current:
        raise HTTPException(status_code=404, detail="Maintenance not found")
    if current.get("status") != expected_status:
        if action == "close" and current.get("status") == "Closed":
            raise HTTPException(status_code=400, detail="Already closed")
        if action == "reopen":
            raise HTTPException(status_code=400, detail="Only closed maintenance can be reopened")
        raise HTTPException(status_code=409, detail="Maintenance state changed. Reload and try again.")

    old = current.get("lifecycle_lock") or {}
    if old.get("action") != action:
        raise HTTPException(status_code=409, detail="Maintenance is busy with another lifecycle operation.")
    if _lock_age_seconds(old) < LIFECYCLE_LEASE_SECONDS:
        raise HTTPException(status_code=409, detail="Maintenance operation is already in progress. Retry shortly.")

    new_lease = new_id()
    resumed = await db.maintenance.find_one_and_update(
        {
            "id": mid,
            "status": expected_status,
            "lifecycle_lock.operation_id": old.get("operation_id"),
            "lifecycle_lock.lease_id": old.get("lease_id"),
        },
        {"$set": {"lifecycle_lock.lease_id": new_lease, "lifecycle_lock.at": now_iso()}},
        return_document=ReturnDocument.AFTER,
    )
    if not resumed:
        raise HTTPException(status_code=409, detail="Maintenance operation was resumed by another request.")
    return resumed, resumed["lifecycle_lock"], True


async def _owns_lease(mid: str, lease_id: str) -> bool:
    return bool(await db.maintenance.find_one(
        {"id": mid, "lifecycle_lock.lease_id": lease_id},
        {"_id": 1},
    ))


async def _release_lease(mid: str, lease_id: str):
    await db.maintenance.update_one(
        {"id": mid, "lifecycle_lock.lease_id": lease_id},
        {"$unset": {"lifecycle_lock": ""}},
    )


def _stock_log(item: dict, key: str):
    for row in item.get("stock_operation_log") or []:
        if row.get("key") == key:
            return row
    return None


async def _stock_mutation(item_id: str, delta: float, key: str, allow_negative: bool):
    delta = float(delta)
    for _ in range(20):
        current = await db.inventory_items.find_one({"id": item_id})
        if not current:
            raise HTTPException(status_code=400, detail=f"Inventory item not found: {item_id}")

        old_log = _stock_log(current, key)
        if old_log:
            return {
                "before": float(old_log.get("before") or 0),
                "after": float(old_log.get("after") or 0),
                "applied_now": False,
            }

        raw_before = current.get("stock", 0)
        before = float(raw_before or 0)
        after = before + delta
        if not allow_negative and after < 0:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Insufficient stock for {current.get('item_name') or item_id} "
                    f"(have {before:g}, need {abs(delta):g}). "
                    "Enable Stock Override or choose Purchase."
                ),
            )

        op = {"key": key, "before": before, "after": after, "delta": delta, "at": now_iso()}
        updated = await db.inventory_items.find_one_and_update(
            {
                "id": item_id,
                "stock": raw_before,
                "stock_operation_log.key": {"$ne": key},
            },
            {
                "$inc": {"stock": delta},
                "$set": {"updated_at": now_iso()},
                "$push": {
                    "stock_operation_log": {
                        "$each": [op],
                        "$slice": -STOCK_OPERATION_LOG_LIMIT,
                    }
                },
            },
            return_document=ReturnDocument.AFTER,
        )
        if updated:
            return {"before": before, "after": after, "applied_now": True}

    raise HTTPException(status_code=409, detail="Inventory changed concurrently. Retry the operation.")


async def _upsert_inventory_tx(key: str, doc: dict):
    payload = dict(doc)
    payload["operation_key"] = key
    await db.inventory_transactions.update_one(
        {"operation_key": key},
        {"$setOnInsert": payload},
        upsert=True,
    )


async def _rollback_stock(parts: list[dict], operation_id: str, action: str):
    for index, part in enumerate(parts):
        if not _part_uses_inventory(part):
            continue
        original_key = f"{operation_id}:{action}:{index}"
        item = await db.inventory_items.find_one({"id": part["item_id"]})
        if not item or not _stock_log(item, original_key):
            continue
        qty = float(part.get("qty") or 0)
        inverse = qty if action == "close" else -qty
        await _stock_mutation(
            part["item_id"],
            inverse,
            f"{operation_id}:rollback-{action}:{index}",
            True,
        )
    await db.inventory_transactions.delete_many({"operation_id": operation_id})


async def _sync_failure(mnt: dict):
    failure_name = (mnt.get("failure_found") or mnt.get("problem_damage") or "").strip()
    existing = await db.failures.find({"maintenance_id": mnt["id"]}).sort("created_at", 1).to_list(100)
    if not failure_name:
        if existing:
            await db.failures.delete_many({"maintenance_id": mnt["id"]})
        return

    values = {
        "equipment_id": mnt["equipment_id"],
        "maintenance_id": mnt["id"],
        "mnt_no": mnt["mnt_no"],
        "failure_name": failure_name,
        "description": mnt.get("action_taken") or "",
        "root_cause": mnt.get("root_cause") or "",
        "occurred_date": mnt.get("maintenance_date"),
    }
    if existing:
        await db.failures.update_one({"id": existing[0]["id"]}, {"$set": values})
        dup_ids = [row.get("id") for row in existing[1:] if row.get("id")]
        if dup_ids:
            await db.failures.delete_many({"id": {"$in": dup_ids}})
    else:
        await db.failures.insert_one({"id": new_id(), "created_at": now_iso(), **values})


async def _sync_equipment_status(equipment_id: str):
    count = await db.maintenance.count_documents({"equipment_id": equipment_id, "status": "Open"})
    await db.equipment.update_one(
        {"id": equipment_id},
        {"$set": {
            "operational_status": "Under Maintenance" if count else "Operational",
            "updated_at": now_iso(),
        }},
    )


@router.get("/maintenance")
async def list_maintenance(equipment_id: str = "", status: str = "", page: int = 1,
                           page_size: int = 20, user: dict = Depends(get_current_user)):
    query = {}
    if equipment_id:
        query["equipment_id"] = equipment_id
    if status:
        query["status"] = status
    page_size = min(max(1, page_size), 200)
    total = await db.maintenance.count_documents(query)
    items = await db.maintenance.find(query, {"_id": 0}).sort("maintenance_date", -1)\
        .skip((max(1, page) - 1) * page_size).limit(page_size).to_list(page_size)
    return {"total": total, "items": items, "page": page}


@router.get("/maintenance/{mid}")
async def get_maintenance(mid: str, user: dict = Depends(get_current_user)):
    m = await db.maintenance.find_one({"id": mid}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Maintenance not found")
    m["attachments"] = await db.files.find(
        {"maintenance_id": mid, "is_deleted": False}, {"_id": 0}
    ).to_list(100)
    return m


@router.post("/maintenance")
async def create_maintenance(body: MaintenanceBody, user: dict = Depends(EDIT)):
    eq = await db.equipment.find_one({"id": body.equipment_id})
    if not eq:
        raise HTTPException(status_code=404, detail="Equipment not found")

    client_id, job_id = body.client_id, body.job_id
    if not job_id and eq.get("current_job_id"):
        job_id = eq["current_job_id"]
        client_id = client_id or eq.get("current_client_id")
    job = await db.jobs.find_one({"id": job_id}) if job_id else None
    if job:
        client_id = job.get("client_id")
    client = await db.clients.find_one({"id": client_id}) if client_id else None
    purpose = body.maintenance_purpose.strip() or (
        ((job.get("field_name") or job.get("job_name") or "").strip()) if job else ""
    )
    parts = await _resolve_parts(body.parts)
    mnt_no = await gen_maintenance_no()
    doc = {
        "id": new_id(), "mnt_no": mnt_no, "equipment_id": eq["id"],
        "sap_no": eq["sap_no"], "equipment_name": eq.get("name"),
        "maintenance_date": body.maintenance_date or now_iso()[:10], "date_closed": None,
        "maintenance_category": body.maintenance_category, "maintenance_purpose": purpose,
        "type_of_maintenance": body.type_of_maintenance, "problem_damage": body.problem_damage,
        "failure_found": body.failure_found, "root_cause": body.root_cause,
        "action_taken": body.action_taken, "current_status": body.problem_damage,
        "duration_days": body.duration_days, "lead_technician": body.lead_technician,
        "support_technicians": body.support_technicians, "checked_by": body.checked_by,
        "final_condition": body.final_condition, "remark": body.remark,
        "pending_maintenance": "", "progress_update": "", "client_id": client_id,
        "client_name": client["name"] if client else None, "job_id": job_id,
        "job_number": job["job_number"] if job else None, "parts_consumed": parts,
        "total_cost": _total_cost(parts), "notes": body.notes, "parts_deducted": False,
        "attachments": [], "status": "Open", "source": "manual",
        "created_by": user["name"], "created_at": now_iso(), "closed_at": None,
    }
    await db.maintenance.insert_one(doc)
    await _sync_failure(doc)
    await _sync_equipment_status(eq["id"])
    await audit_log("maintenance", doc["id"], "maintenance.create", user, f"Created {mnt_no}")
    doc.pop("_id", None)
    return doc


@router.put("/maintenance/{mid}")
async def update_maintenance(mid: str, body: MaintenanceBody, user: dict = Depends(EDIT)):
    m = await db.maintenance.find_one({"id": mid})
    if not m:
        raise HTTPException(status_code=404, detail="Maintenance not found")
    if m.get("status") == "Closed":
        raise HTTPException(status_code=400, detail="Closed maintenance cannot be edited. Reopen first.")
    if m.get("lifecycle_lock"):
        raise HTTPException(status_code=409, detail="Maintenance lifecycle operation is in progress.")

    parts = await _resolve_parts(body.parts)
    job = await db.jobs.find_one({"id": body.job_id}) if body.job_id else None
    client_id = job.get("client_id") if job else body.client_id
    client = await db.clients.find_one({"id": client_id}) if client_id else None
    purpose = body.maintenance_purpose.strip() or (
        ((job.get("field_name") or job.get("job_name") or "").strip()) if job else ""
    )
    updates = {
        "maintenance_date": body.maintenance_date, "type_of_maintenance": body.type_of_maintenance,
        "maintenance_category": body.maintenance_category, "maintenance_purpose": purpose,
        "problem_damage": body.problem_damage, "failure_found": body.failure_found,
        "root_cause": body.root_cause, "action_taken": body.action_taken,
        "duration_days": body.duration_days, "lead_technician": body.lead_technician,
        "support_technicians": body.support_technicians, "checked_by": body.checked_by,
        "final_condition": body.final_condition, "remark": body.remark,
        "client_id": client_id, "client_name": client["name"] if client else None,
        "job_id": body.job_id, "job_number": job["job_number"] if job else None,
        "parts_consumed": parts, "total_cost": _total_cost(parts), "notes": body.notes,
        "updated_at": now_iso(),
    }
    result = await db.maintenance.update_one(
        {"id": mid, "status": "Open", "$or": [
            {"lifecycle_lock": {"$exists": False}}, {"lifecycle_lock": None}
        ]},
        {"$set": updates},
    )
    if result.matched_count != 1:
        raise HTTPException(status_code=409, detail="Maintenance changed concurrently. Reload and try again.")
    updated = await db.maintenance.find_one({"id": mid})
    await _sync_failure(updated)
    await audit_log("maintenance", mid, "maintenance.update", user, f"Updated {m['mnt_no']}")
    updated.pop("_id", None)
    return updated


@router.post("/maintenance/{mid}/close")
async def close_maintenance(mid: str, body: CloseBody, user: dict = Depends(EDIT)):
    initial = await db.maintenance.find_one({"id": mid})
    if not initial:
        raise HTTPException(status_code=404, detail="Maintenance not found")
    if initial.get("status") == "Closed":
        raise HTTPException(status_code=400, detail="Already closed")

    requested_parts = initial.get("parts_consumed") or []
    if body.parts is not None:
        requested_parts = await _resolve_parts(body.parts)
    close_values = {"date_closed": body.date_closed or now_iso()[:10]}
    for field in ["duration_days", "failure_found", "root_cause", "action_taken",
                  "final_condition", "checked_by", "remark", "support_technicians"]:
        value = getattr(body, field)
        if value is not None:
            close_values[field] = value

    claimed, lock, resumed = await _claim_lifecycle(
        mid, "Open", "close", {"parts": requested_parts, "close_values": close_values}
    )
    payload = lock.get("payload") or {}
    parts = payload.get("parts") or []
    close_values = payload.get("close_values") or close_values
    op_id, lease_id = lock["operation_id"], lock["lease_id"]

    try:
        for index, part in enumerate(parts):
            qty = float(part.get("qty") or 0)
            if qty <= 0:
                raise HTTPException(status_code=400, detail="Part quantity must be greater than zero")
            item = await db.inventory_items.find_one({"id": part["item_id"]})
            if not item:
                raise HTTPException(status_code=400, detail=f"Item missing: {part.get('item_name') or part['item_id']}")

            source = _part_source(part)
            override = bool(part.get("stock_override")) if source == "Ex-Stock" else False
            if source == "Ex-Stock":
                key = f"{op_id}:close:{index}"
                stock = await _stock_mutation(item["id"], -qty, key, override)
                before, after = stock["before"], stock["after"]
                override_applied = override and before < qty
                affects_stock, tx_type = True, "consume"
                note = (f"Consumed on {claimed['mnt_no']} with Stock Override ({before:g} available, {qty:g} used)"
                        if override_applied else f"Consumed on {claimed['mnt_no']}")
            else:
                key = f"{op_id}:purchase:{index}"
                fresh = await db.inventory_items.find_one({"id": item["id"]})
                before = after = float((fresh or item).get("stock") or 0)
                override_applied, affects_stock, tx_type = False, False, "purchase_direct_use"
                note = f"Purchased/direct-use on {claimed['mnt_no']} (inventory not deducted)"

            part.update({
                "supply_source": source, "stock_override": override,
                "stock_override_applied": override_applied,
                "stock_before": before, "stock_after": after,
            })
            await _upsert_inventory_tx(key, {
                "id": new_id(), "operation_id": op_id, "item_id": item["id"],
                "item_code": item["item_code"], "item_name": item["item_name"],
                "type": tx_type, "direction": "out", "qty": qty, "unit": item["unit"],
                "maintenance_id": mid, "mnt_no": claimed["mnt_no"],
                "equipment_id": claimed["equipment_id"], "supply_source": source,
                "affects_stock": affects_stock, "stock_override": override,
                "stock_override_applied": override_applied, "stock_before": before,
                "balance_after": after, "note": note, "created_by": user["name"],
                "created_at": now_iso(),
            })

        updates = {
            "status": "Closed", "closed_at": now_iso(), "parts_deducted": bool(parts),
            "parts_consumed": parts, "total_cost": _total_cost(parts), **close_values,
        }
        if updates.get("final_condition"):
            updates["current_status"] = updates["final_condition"]
        result = await db.maintenance.update_one(
            {"id": mid, "status": "Open", "lifecycle_lock.lease_id": lease_id},
            {"$set": updates, "$unset": {"lifecycle_lock": ""}},
        )
        if result.matched_count != 1:
            raise HTTPException(status_code=409, detail="Maintenance lifecycle lease changed")
    except Exception:
        if await _owns_lease(mid, lease_id):
            try:
                await _rollback_stock(parts, op_id, "close")
                await _release_lease(mid, lease_id)
            except Exception:
                pass
        raise

    final = await db.maintenance.find_one({"id": mid})
    await _sync_failure(final)
    await _sync_equipment_status(final["equipment_id"])
    await audit_log(
        "maintenance", mid, "maintenance.close", user, f"Closed {final['mnt_no']}",
        extra={"operation_id": op_id, "resumed": resumed},
    )
    final.pop("_id", None)
    return final


@router.post("/maintenance/{mid}/reopen")
async def reopen_maintenance(mid: str, user: dict = Depends(MANAGE)):
    claimed, lock, resumed = await _claim_lifecycle(mid, "Closed", "reopen")
    parts = claimed.get("parts_consumed") or []
    op_id, lease_id = lock["operation_id"], lock["lease_id"]
    try:
        if claimed.get("parts_deducted"):
            for index, part in enumerate(parts):
                item = await db.inventory_items.find_one({"id": part["item_id"]})
                if not item:
                    raise HTTPException(status_code=409, detail=f"Cannot reopen; inventory item missing for {part.get('item_name') or part['item_id']}")
                source, qty = _part_source(part), float(part.get("qty") or 0)
                if source == "Ex-Stock":
                    key = f"{op_id}:reopen:{index}"
                    stock = await _stock_mutation(item["id"], qty, key, True)
                    before, after, affects, tx_type = stock["before"], stock["after"], True, "reversal"
                    note = f"Reversal on reopen {claimed['mnt_no']}"
                else:
                    key = f"{op_id}:purchase-reopen:{index}"
                    fresh = await db.inventory_items.find_one({"id": item["id"]})
                    before = after = float((fresh or item).get("stock") or 0)
                    affects, tx_type = False, "purchase_reversal"
                    note = f"Purchase usage reversal on reopen {claimed['mnt_no']} (inventory unchanged)"
                await _upsert_inventory_tx(key, {
                    "id": new_id(), "operation_id": op_id, "item_id": item["id"],
                    "item_code": item["item_code"], "item_name": item["item_name"],
                    "type": tx_type, "direction": "in", "qty": qty, "unit": item["unit"],
                    "maintenance_id": mid, "mnt_no": claimed["mnt_no"],
                    "equipment_id": claimed["equipment_id"], "supply_source": source,
                    "affects_stock": affects, "stock_override": bool(part.get("stock_override")),
                    "stock_override_applied": bool(part.get("stock_override_applied")),
                    "stock_before": before, "balance_after": after, "note": note,
                    "created_by": user["name"], "created_at": now_iso(),
                })
        result = await db.maintenance.update_one(
            {"id": mid, "status": "Closed", "lifecycle_lock.lease_id": lease_id},
            {"$set": {"status": "Open", "parts_deducted": False, "closed_at": None, "date_closed": None},
             "$unset": {"lifecycle_lock": ""}},
        )
        if result.matched_count != 1:
            raise HTTPException(status_code=409, detail="Maintenance lifecycle lease changed")
    except Exception:
        if await _owns_lease(mid, lease_id):
            try:
                await _rollback_stock(parts, op_id, "reopen")
                await _release_lease(mid, lease_id)
            except Exception:
                pass
        raise
    await _sync_equipment_status(claimed["equipment_id"])
    await audit_log(
        "maintenance", mid, "maintenance.reopen", user, f"Reopened {claimed['mnt_no']}",
        extra={"operation_id": op_id, "resumed": resumed},
    )
    return await db.maintenance.find_one({"id": mid}, {"_id": 0})


@router.delete("/maintenance/{mid}")
async def delete_maintenance(mid: str, user: dict = Depends(MANAGE)):
    m = await db.maintenance.find_one({"id": mid})
    if not m:
        raise HTTPException(status_code=404, detail="Maintenance not found")
    if m.get("lifecycle_lock"):
        raise HTTPException(status_code=409, detail="Maintenance lifecycle operation is in progress")
    if m.get("status") == "Closed":
        raise HTTPException(status_code=400, detail="Closed maintenance cannot be hard-deleted. Reopen it first.")
    if await db.inventory_transactions.count_documents({"maintenance_id": mid}):
        raise HTTPException(
            status_code=400,
            detail="Maintenance has inventory ledger history and cannot be hard-deleted. Retain the reopened record for auditability.",
        )
    result = await db.maintenance.delete_one(
        {"id": mid, "status": "Open", "$or": [
            {"lifecycle_lock": {"$exists": False}}, {"lifecycle_lock": None}
        ]}
    )
    if result.deleted_count != 1:
        raise HTTPException(status_code=409, detail="Maintenance changed concurrently")
    await db.failures.delete_many({"maintenance_id": mid})
    related_files = await db.files.find(
        {"maintenance_id": mid, "is_deleted": False}
    ).to_list(5000)
    for file_rec in related_files:
        try:
            delete_object(file_rec["storage_path"])
        except Exception:
            pass
    await db.files.update_many(
        {"maintenance_id": mid},
        {"$set": {"is_deleted": True, "deleted_at": now_iso(), "deleted_by": user["name"]}},
    )
    await _sync_equipment_status(m["equipment_id"])
    await audit_log("maintenance", mid, "maintenance.delete", user, f"Deleted open maintenance {m['mnt_no']}")
    return {"ok": True}


async def _equipment_current_location(eq: dict) -> str:
    placement = str(eq.get("placement") or "Base").strip()
    detail = str(eq.get("placement_detail") or "").strip()

    if placement != "Job":
        if not detail or detail.lower() == placement.lower():
            return placement
        return f"{placement} - {detail}"

    job_id = eq.get("current_job_id")
    if not job_id:
        active = await db.assignments.find_one({
            "equipment_id": eq.get("id"),
            "status": "Active",
        })
        job_id = active.get("job_id") if active else None

    job = (
        await db.jobs.find_one({"id": job_id})
        if job_id
        else None
    )

    if not job:
        return "Job"

    return " - ".join(
        part
        for part in [
            "Job",
            job.get("client_name") or "",
            job.get("site_location") or "",
        ]
        if part
    )


@router.get("/maintenance/{mid}/report.pdf")
async def maintenance_pdf(
    mid: str,
    user: dict = Depends(get_current_user),
):

    m = await db.maintenance.find_one({"id": mid}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Maintenance not found")

    eq = await db.equipment.find_one(
        {"id": m["equipment_id"]}, {"_id": 0}
    ) or {}
    if eq:
        eq["current_location"] = (
            await _equipment_current_location(eq)
        )

    if not m.get("maintenance_purpose") and m.get("job_id"):
        purpose_job = await db.jobs.find_one(
            {"id": m["job_id"]},
            {"_id": 0, "field_name": 1, "job_name": 1},
        )
        if purpose_job:
            m["maintenance_purpose"] = (
                purpose_job.get("field_name")
                or purpose_job.get("job_name")
                or ""
            )

    settings = await db.settings.find_one({"_id": "app"}) or {}
    currency = settings.get("currency", "USD")
    timezone_name = settings.get("timezone", "Asia/Jakarta")
    pdf = build_maintenance_pdf(m, eq, currency, timezone_name)

    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{m["mnt_no"]}.pdf"',
            "Cache-Control": "no-store, max-age=0",
            "Pragma": "no-cache",
            "X-Content-Type-Options": "nosniff",
        },
    )


# -------- failures --------
@router.get("/failures")
async def list_failures(
    equipment_id: str = "",
    user: dict = Depends(get_current_user),
):
    query = {}
    if equipment_id:
        query["equipment_id"] = equipment_id
    return await db.failures.find(
        query, {"_id": 0}
    ).sort("occurred_date", -1).to_list(2000)


@router.get("/failures/recurring")
async def recurring_failures(user: dict = Depends(get_current_user)):
    pipeline = [
        {
            "$group": {
                "_id": {"$toLower": "$failure_name"},
                "failure_name": {"$first": "$failure_name"},
                "count": {"$sum": 1},
                "occurrences": {
                    "$push": {
                        "maintenance_id": "$maintenance_id",
                        "mnt_no": "$mnt_no",
                        "equipment_id": "$equipment_id",
                        "occurred_date": "$occurred_date",
                    }
                },
            }
        },
        {"$sort": {"count": -1}},
    ]
    rows = await db.failures.aggregate(pipeline).to_list(2000)
    return [
        {
            "failure_name": r["failure_name"],
            "count": r["count"],
            "occurrences": r["occurrences"],
        }
        for r in rows
        if r.get("failure_name")
    ]


# -------- files / attachments --------
@router.post("/files/upload")
async def upload_file(
    file: UploadFile = File(...),
    doc_type: str = Form("Other Document"),
    equipment_id: str = Form(...),
    maintenance_id: str = Form(...),
    user: dict = Depends(EDIT),
):
    filename = safe_original_filename(file.filename)
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"File type .{ext or 'unknown'} not allowed",
        )

    normalized_type = (doc_type or "Other Document").strip() or "Other Document"
    if normalized_type == "Document":
        normalized_type = "Other Document"
    if normalized_type not in DOCUMENT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid document type")

    maintenance = await db.maintenance.find_one({"id": maintenance_id})
    if not maintenance:
        raise HTTPException(status_code=404, detail="Maintenance not found")
    if maintenance.get("equipment_id") != equipment_id:
        raise HTTPException(
            status_code=400,
            detail="Maintenance does not belong to the selected equipment",
        )
    if not await db.equipment.find_one({"id": equipment_id}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Equipment not found")

    try:
        data = await read_upload_limited(file, MAX_SIZE)
        validate_file_bytes(ext, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    content_type = MIME_TYPES[ext]
    storage_path = f"{APP_NAME}/uploads/{user['id']}/{uuid.uuid4()}.{ext}"
    result = put_object(storage_path, data, content_type)

    rec = {
        "id": new_id(),
        "storage_path": result["path"],
        "original_filename": filename,
        "content_type": content_type,
        "size": result.get("size", len(data)),
        "doc_type": normalized_type,
        "equipment_id": equipment_id,
        "maintenance_id": maintenance_id,
        "is_deleted": False,
        "uploaded_by": user["name"],
        "created_at": now_iso(),
    }

    try:
        await db.files.insert_one(rec)
        linked = await db.maintenance.update_one(
            {"id": maintenance_id, "equipment_id": equipment_id},
            {"$addToSet": {"attachments": rec["id"]}},
        )
        if linked.matched_count != 1:
            raise RuntimeError("Maintenance attachment link failed")
    except Exception:
        await db.files.delete_one({"id": rec["id"]})
        try:
            delete_object(result["path"])
        except Exception:
            pass
        raise

    await audit_log(
        "file",
        rec["id"],
        "file.upload",
        user,
        f"{filename} ({normalized_type})",
    )
    rec.pop("_id", None)
    return rec


@router.get("/files/{file_id}/download")
async def download_file(
    file_id: str,
    user: dict = Depends(get_current_user),
):
    rec = await db.files.find_one({"id": file_id, "is_deleted": False})
    if not rec:
        raise HTTPException(status_code=404, detail="File not found")

    try:
        data, detected_type = get_object(rec["storage_path"])
    except (FileNotFoundError, ValueError, KeyError):
        raise HTTPException(status_code=404, detail="Stored file not found on VPS")

    return Response(
        content=data,
        media_type=rec.get("content_type") or detected_type,
        headers={
            "Content-Disposition": content_disposition(
                rec.get("original_filename") or "document",
                "inline",
            ),
            "Cache-Control": "no-store, max-age=0",
            "Pragma": "no-cache",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/files/{file_id}")
async def delete_file(file_id: str, user: dict = Depends(EDIT)):
    rec = await db.files.find_one({"id": file_id, "is_deleted": False})
    if not rec:
        raise HTTPException(status_code=404, detail="File not found")

    await db.files.update_one(
        {"id": file_id, "is_deleted": False},
        {
            "$set": {
                "is_deleted": True,
                "deleted_at": now_iso(),
                "deleted_by": user["name"],
            }
        },
    )
    if rec.get("maintenance_id"):
        await db.maintenance.update_one(
            {"id": rec["maintenance_id"]},
            {"$pull": {"attachments": file_id}},
        )
    try:
        delete_object(rec["storage_path"])
    except Exception:
        pass

    await audit_log(
        "file",
        file_id,
        "file.delete",
        user,
        rec.get("original_filename") or "Document",
    )
    return {"ok": True}
