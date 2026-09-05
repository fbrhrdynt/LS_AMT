import uuid
from typing import Literal

from fastapi import (APIRouter, Depends, HTTPException, UploadFile, File, Form,
                     Header, Query, Response, Request)
from pydantic import BaseModel, Field

from core import db, new_id, now_iso, gen_maintenance_no, audit_log
from auth import get_current_user, require_roles, _user_from_token
from storage import put_object, get_object, APP_NAME, ALLOWED_EXT, MAX_SIZE, MIME_TYPES
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


@router.get("/maintenance")
async def list_maintenance(equipment_id: str = "", status: str = "", page: int = 1,
                           page_size: int = 20, user: dict = Depends(get_current_user)):
    query = {}
    if equipment_id:
        query["equipment_id"] = equipment_id
    if status:
        query["status"] = status
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
        client_id = eq.get("current_client_id")

    job = await db.jobs.find_one({"id": job_id}) if job_id else None
    client = await db.clients.find_one({"id": client_id}) if client_id else None
    parts = await _resolve_parts(body.parts)
    mnt_no = await gen_maintenance_no()

    doc = {
        "id": new_id(),
        "mnt_no": mnt_no,
        "equipment_id": eq["id"],
        "sap_no": eq["sap_no"],
        "equipment_name": eq.get("name"),
        "maintenance_date": body.maintenance_date or now_iso()[:10],
        "date_closed": None,
        "maintenance_category": body.maintenance_category,
        "type_of_maintenance": body.type_of_maintenance,
        "problem_damage": body.problem_damage,
        "failure_found": body.failure_found,
        "root_cause": body.root_cause,
        "action_taken": body.action_taken,
        "current_status": body.problem_damage,
        "duration_days": body.duration_days,
        "lead_technician": body.lead_technician,
        "support_technicians": body.support_technicians,
        "checked_by": body.checked_by,
        "final_condition": body.final_condition,
        "remark": body.remark,
        "pending_maintenance": "",
        "progress_update": "",
        "client_id": client_id,
        "client_name": client["name"] if client else None,
        "job_id": job_id,
        "job_number": job["job_number"] if job else None,
        "parts_consumed": parts,
        "total_cost": _total_cost(parts),
        "notes": body.notes,
        "parts_deducted": False,
        "attachments": [],
        "status": "Open",
        "source": "manual",
        "created_by": user["name"],
        "created_at": now_iso(),
        "closed_at": None,
    }

    await db.maintenance.insert_one(doc)
    await db.equipment.update_one(
        {"id": eq["id"]},
        {"$set": {"operational_status": "Under Maintenance"}}
    )

    fname = (body.failure_found or body.problem_damage or "").strip()
    if fname:
        await db.failures.insert_one({
            "id": new_id(),
            "equipment_id": eq["id"],
            "maintenance_id": doc["id"],
            "mnt_no": mnt_no,
            "failure_name": fname,
            "description": body.action_taken,
            "root_cause": body.root_cause,
            "occurred_date": doc["maintenance_date"],
            "created_at": now_iso(),
        })

    await audit_log(
        "maintenance", doc["id"], "maintenance.create", user, f"Created {mnt_no}"
    )
    doc.pop("_id", None)
    return doc


@router.put("/maintenance/{mid}")
async def update_maintenance(mid: str, body: MaintenanceBody, user: dict = Depends(EDIT)):
    m = await db.maintenance.find_one({"id": mid})
    if not m:
        raise HTTPException(status_code=404, detail="Maintenance not found")
    if m["status"] == "Closed":
        raise HTTPException(
            status_code=400,
            detail="Closed maintenance cannot be edited. Reopen first."
        )

    parts = await _resolve_parts(body.parts)
    job = await db.jobs.find_one({"id": body.job_id}) if body.job_id else None
    client = await db.clients.find_one({"id": body.client_id}) if body.client_id else None

    updates = {
        "maintenance_date": body.maintenance_date,
        "type_of_maintenance": body.type_of_maintenance,
        "maintenance_category": body.maintenance_category,
        "problem_damage": body.problem_damage,
        "failure_found": body.failure_found,
        "root_cause": body.root_cause,
        "action_taken": body.action_taken,
        "duration_days": body.duration_days,
        "lead_technician": body.lead_technician,
        "support_technicians": body.support_technicians,
        "checked_by": body.checked_by,
        "final_condition": body.final_condition,
        "remark": body.remark,
        "client_id": body.client_id,
        "client_name": client["name"] if client else None,
        "job_id": body.job_id,
        "job_number": job["job_number"] if job else None,
        "parts_consumed": parts,
        "total_cost": _total_cost(parts),
        "notes": body.notes,
    }

    await db.maintenance.update_one({"id": mid}, {"$set": updates})

    fname = (body.failure_found or body.problem_damage or "").strip()
    existing_f = await db.failures.find_one({"maintenance_id": mid})
    if fname:
        fdoc = {
            "failure_name": fname,
            "description": body.action_taken,
            "root_cause": body.root_cause,
            "occurred_date": body.maintenance_date,
        }
        if existing_f:
            await db.failures.update_one({"id": existing_f["id"]}, {"$set": fdoc})
        else:
            await db.failures.insert_one({
                "id": new_id(),
                "equipment_id": m["equipment_id"],
                "maintenance_id": mid,
                "mnt_no": m["mnt_no"],
                "created_at": now_iso(),
                **fdoc,
            })

    await audit_log(
        "maintenance", mid, "maintenance.update", user, f"Updated {m['mnt_no']}"
    )
    return await db.maintenance.find_one({"id": mid}, {"_id": 0})


@router.post("/maintenance/{mid}/close")
async def close_maintenance(mid: str, body: CloseBody, user: dict = Depends(EDIT)):
    m = await db.maintenance.find_one({"id": mid})
    if not m:
        raise HTTPException(status_code=404, detail="Maintenance not found")
    if m["status"] == "Closed":
        raise HTTPException(status_code=400, detail="Already closed")

    parts = m.get("parts_consumed") or []
    if body.parts is not None:
        parts = await _resolve_parts(body.parts)

    # Validate all selected parts before any stock is changed.
    for p in parts:
        qty = float(p.get("qty") or 0)
        if qty <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"Quantity must be greater than 0 for {p.get('item_name') or p.get('item_id')}"
            )

        item = await db.inventory_items.find_one({"id": p["item_id"]})
        if not item:
            raise HTTPException(
                status_code=400,
                detail=f"Item missing: {p.get('item_name') or p['item_id']}"
            )

        source = _part_source(p)
        stock = float(item.get("stock") or 0)
        override = bool(p.get("stock_override")) if source == "Ex-Stock" else False

        if source == "Ex-Stock" and stock < qty and not override:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Insufficient stock for {item['item_name']} "
                    f"(have {stock:g}, need {qty:g}). "
                    "Enable Stock Override or choose Purchase."
                ),
            )

    # Apply each consumption line.
    for p in parts:
        item = await db.inventory_items.find_one({"id": p["item_id"]})
        qty = float(p["qty"])
        source = _part_source(p)
        stock_before = float(item.get("stock") or 0)
        stock_override = bool(p.get("stock_override")) if source == "Ex-Stock" else False
        override_applied = (
            source == "Ex-Stock"
            and stock_override
            and stock_before < qty
        )

        affects_stock = source == "Ex-Stock"
        stock_after = stock_before - qty if affects_stock else stock_before

        p["supply_source"] = source
        p["stock_override"] = stock_override
        p["stock_override_applied"] = override_applied
        p["stock_before"] = stock_before
        p["stock_after"] = stock_after

        if affects_stock:
            await db.inventory_items.update_one(
                {"id": item["id"]},
                {"$set": {"stock": stock_after, "updated_at": now_iso()}}
            )

        if source == "Purchase":
            tx_type = "purchase_direct_use"
            note = f"Purchased/direct-use on {m['mnt_no']} (inventory not deducted)"
        elif override_applied:
            tx_type = "consume"
            note = (
                f"Consumed on {m['mnt_no']} with Stock Override "
                f"({stock_before:g} available, {qty:g} used)"
            )
        else:
            tx_type = "consume"
            note = f"Consumed on {m['mnt_no']}"

        await db.inventory_transactions.insert_one({
            "id": new_id(),
            "item_id": item["id"],
            "item_code": item["item_code"],
            "item_name": item["item_name"],
            "type": tx_type,
            "direction": "out",
            "qty": qty,
            "unit": item["unit"],
            "maintenance_id": mid,
            "mnt_no": m["mnt_no"],
            "equipment_id": m["equipment_id"],
            "supply_source": source,
            "affects_stock": affects_stock,
            "stock_override": stock_override,
            "stock_override_applied": override_applied,
            "stock_before": stock_before,
            "balance_after": stock_after,
            "note": note,
            "created_by": user["name"],
            "created_at": now_iso(),
        })

    updates = {
        "status": "Closed",
        "closed_at": now_iso(),
        "parts_deducted": True,
        "parts_consumed": parts,
        "total_cost": _total_cost(parts),
        "date_closed": body.date_closed or now_iso()[:10],
    }

    for field in [
        "duration_days", "failure_found", "root_cause", "action_taken",
        "final_condition", "checked_by", "remark", "support_technicians"
    ]:
        val = getattr(body, field)
        if val is not None:
            updates[field] = val

    if updates.get("final_condition"):
        updates["current_status"] = updates["final_condition"]

    await db.maintenance.update_one({"id": mid}, {"$set": updates})

    other_open = await db.maintenance.count_documents({
        "equipment_id": m["equipment_id"],
        "status": "Open",
        "id": {"$ne": mid},
    })
    if other_open == 0:
        await db.equipment.update_one(
            {"id": m["equipment_id"]},
            {"$set": {"operational_status": "Operational"}}
        )

    override_count = sum(1 for p in parts if p.get("stock_override_applied"))
    purchase_count = sum(1 for p in parts if _part_source(p) == "Purchase")
    await audit_log(
        "maintenance",
        mid,
        "maintenance.close",
        user,
        (
            f"Closed {m['mnt_no']}; {len(parts)} item(s) consumed; "
            f"{purchase_count} purchase line(s); {override_count} stock override(s)"
        ),
    )

    return await db.maintenance.find_one({"id": mid}, {"_id": 0})


@router.post("/maintenance/{mid}/reopen")
async def reopen_maintenance(mid: str, user: dict = Depends(MANAGE)):
    m = await db.maintenance.find_one({"id": mid})
    if not m:
        raise HTTPException(status_code=404, detail="Maintenance not found")
    if m["status"] != "Closed":
        raise HTTPException(
            status_code=400,
            detail="Only closed maintenance can be reopened"
        )

    if m.get("parts_deducted"):
        for p in m.get("parts_consumed") or []:
            item = await db.inventory_items.find_one({"id": p["item_id"]})
            if not item:
                continue

            source = _part_source(p)
            qty = float(p.get("qty") or 0)
            stock_before = float(item.get("stock") or 0)
            affects_stock = source == "Ex-Stock"
            stock_after = stock_before + qty if affects_stock else stock_before

            if affects_stock:
                await db.inventory_items.update_one(
                    {"id": item["id"]},
                    {"$set": {"stock": stock_after, "updated_at": now_iso()}}
                )

            await db.inventory_transactions.insert_one({
                "id": new_id(),
                "item_id": item["id"],
                "item_code": item["item_code"],
                "item_name": item["item_name"],
                "type": "reversal" if affects_stock else "purchase_reversal",
                "direction": "in",
                "qty": qty,
                "unit": item["unit"],
                "maintenance_id": mid,
                "mnt_no": m["mnt_no"],
                "equipment_id": m["equipment_id"],
                "supply_source": source,
                "affects_stock": affects_stock,
                "stock_override": bool(p.get("stock_override")),
                "stock_override_applied": bool(p.get("stock_override_applied")),
                "stock_before": stock_before,
                "balance_after": stock_after,
                "note": (
                    f"Reversal on reopen {m['mnt_no']}"
                    if affects_stock
                    else f"Purchase usage reversal on reopen {m['mnt_no']} (inventory unchanged)"
                ),
                "created_by": user["name"],
                "created_at": now_iso(),
            })

    await db.maintenance.update_one(
        {"id": mid},
        {"$set": {
            "status": "Open",
            "parts_deducted": False,
            "closed_at": None,
            "date_closed": None,
        }}
    )
    await db.equipment.update_one(
        {"id": m["equipment_id"]},
        {"$set": {"operational_status": "Under Maintenance"}}
    )
    await audit_log(
        "maintenance", mid, "maintenance.reopen", user, f"Reopened {m['mnt_no']}"
    )
    return await db.maintenance.find_one({"id": mid}, {"_id": 0})


async def _token(request, auth, authorization):
    return (
        request.cookies.get("access_token")
        or auth
        or (
            authorization[7:]
            if authorization and authorization.startswith("Bearer ")
            else None
        )
    )


@router.delete("/maintenance/{mid}")
async def delete_maintenance(mid: str, user: dict = Depends(MANAGE)):
    m = await db.maintenance.find_one({"id": mid})
    if not m:
        raise HTTPException(status_code=404, detail="Maintenance not found")

    if m.get("parts_deducted"):
        for p in m.get("parts_consumed") or []:
            item = await db.inventory_items.find_one({"id": p["item_id"]})
            if not item:
                continue

            source = _part_source(p)
            qty = float(p.get("qty") or 0)
            stock_before = float(item.get("stock") or 0)
            affects_stock = source == "Ex-Stock"
            stock_after = stock_before + qty if affects_stock else stock_before

            if affects_stock:
                await db.inventory_items.update_one(
                    {"id": item["id"]},
                    {"$set": {"stock": stock_after, "updated_at": now_iso()}}
                )

            await db.inventory_transactions.insert_one({
                "id": new_id(),
                "item_id": item["id"],
                "item_code": item["item_code"],
                "item_name": item["item_name"],
                "type": "reversal" if affects_stock else "purchase_reversal",
                "direction": "in",
                "qty": qty,
                "unit": item["unit"],
                "maintenance_id": mid,
                "mnt_no": m["mnt_no"],
                "equipment_id": m["equipment_id"],
                "supply_source": source,
                "affects_stock": affects_stock,
                "stock_override": bool(p.get("stock_override")),
                "stock_override_applied": bool(p.get("stock_override_applied")),
                "stock_before": stock_before,
                "balance_after": stock_after,
                "note": (
                    f"Reversal on delete {m['mnt_no']}"
                    if affects_stock
                    else f"Purchase usage reversal on delete {m['mnt_no']} (inventory unchanged)"
                ),
                "created_by": user["name"],
                "created_at": now_iso(),
            })

    await db.failures.delete_many({"maintenance_id": mid})
    await db.files.update_many(
        {"maintenance_id": mid},
        {"$set": {"is_deleted": True}}
    )
    await db.maintenance.delete_one({"id": mid})

    other_open = await db.maintenance.count_documents({
        "equipment_id": m["equipment_id"],
        "status": "Open",
    })
    if other_open == 0:
        await db.equipment.update_one(
            {"id": m["equipment_id"]},
            {"$set": {"operational_status": "Operational"}}
        )

    await audit_log(
        "maintenance", mid, "maintenance.delete", user, f"Deleted {m['mnt_no']}"
    )
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
    request: Request,
    auth: str = Query(None),
    authorization: str = Header(None),
):
    token = await _token(request, auth, authorization)
    if not token or not await _user_from_token(token):
        raise HTTPException(status_code=401, detail="Not authenticated")

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

    settings = await db.settings.find_one({"_id": "app"}) or {}
    currency = settings.get("currency", "USD")
    pdf = build_maintenance_pdf(m, eq, currency)

    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{m["mnt_no"]}.pdf"'
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
    doc_type: str = Form("Document"),
    equipment_id: str = Form(None),
    maintenance_id: str = Form(None),
    user: dict = Depends(EDIT),
):
    ext = (
        file.filename.rsplit(".", 1)[-1].lower()
        if "." in file.filename
        else "bin"
    )
    if ext not in ALLOWED_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"File type .{ext} not allowed"
        )

    data = await file.read()
    if len(data) > MAX_SIZE:
        raise HTTPException(
            status_code=400,
            detail="File exceeds 15MB limit"
        )

    content_type = MIME_TYPES.get(
        ext,
        file.content_type or "application/octet-stream"
    )
    path = f"{APP_NAME}/uploads/{user['id']}/{uuid.uuid4()}.{ext}"
    result = put_object(path, data, content_type)

    rec = {
        "id": new_id(),
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": content_type,
        "size": result.get("size", len(data)),
        "doc_type": doc_type,
        "equipment_id": equipment_id,
        "maintenance_id": maintenance_id,
        "is_deleted": False,
        "uploaded_by": user["name"],
        "created_at": now_iso(),
    }
    await db.files.insert_one(rec)

    if maintenance_id:
        await db.maintenance.update_one(
            {"id": maintenance_id},
            {"$push": {"attachments": rec["id"]}}
        )

    await audit_log(
        "file",
        rec["id"],
        "file.upload",
        user,
        f"{file.filename} ({doc_type})",
    )
    rec.pop("_id", None)
    return rec


@router.get("/files/{file_id}/download")
async def download_file(
    file_id: str,
    request: Request,
    auth: str = Query(None),
    authorization: str = Header(None),
):
    token = await _token(request, auth, authorization)
    if not token or not await _user_from_token(token):
        raise HTTPException(status_code=401, detail="Not authenticated")

    rec = await db.files.find_one(
        {"id": file_id, "is_deleted": False}
    )
    if not rec:
        raise HTTPException(status_code=404, detail="File not found")

    try:
        data, ct = get_object(rec["storage_path"])
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="Stored file not found on VPS"
        )

    return Response(
        content=data,
        media_type=rec.get("content_type", ct),
        headers={
            "Content-Disposition": (
                f'inline; filename="{rec["original_filename"]}"'
            )
        },
    )


@router.delete("/files/{file_id}")
async def delete_file(file_id: str, user: dict = Depends(EDIT)):
    rec = await db.files.find_one({"id": file_id})
    if not rec:
        raise HTTPException(status_code=404, detail="File not found")

    await db.files.update_one(
        {"id": file_id},
        {"$set": {"is_deleted": True}}
    )
    await audit_log(
        "file",
        file_id,
        "file.delete",
        user,
        rec["original_filename"],
    )
    return {"ok": True}
