import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from core import db, new_id, now_iso, audit_log
from auth import get_current_user, require_roles


router = APIRouter(prefix="/api")
MANAGE = require_roles("admin", "supervisor")


class ItemBody(BaseModel):
    item_code: str
    item_name: str
    category: str = ""
    type: str = "Spare Part"
    part_number: str = ""
    unit: str = "EA"
    stock: float = 0
    min_stock: float = 0
    storage_location: str = ""
    unit_price: float = 0


class AdjustBody(BaseModel):
    qty: float = Field(ne=0)
    note: str = ""


SORTS = {
    "category_asc": [
        ("category", 1),
        ("item_code", 1),
    ],
    "category_desc": [
        ("category", -1),
        ("item_code", 1),
    ],
    "item_code_asc": [
        ("item_code", 1),
    ],
    "item_name_asc": [
        ("item_name", 1),
        ("item_code", 1),
    ],
}


def _clean_item_payload(body: ItemBody) -> dict:
    payload = body.model_dump()

    for key in (
        "item_code",
        "item_name",
        "category",
        "type",
        "part_number",
        "unit",
        "storage_location",
    ):
        payload[key] = str(payload.get(key) or "").strip()

    if not payload["item_code"]:
        raise HTTPException(
            status_code=400,
            detail="Item code is required",
        )

    if not payload["item_name"]:
        raise HTTPException(
            status_code=400,
            detail="Item name is required",
        )

    if not payload["unit"]:
        payload["unit"] = "EA"

    return payload


@router.get("/inventory-categories")
async def list_inventory_categories(
    user: dict = Depends(get_current_user),
):
    values = await db.inventory_items.distinct(
        "category",
        {
            "category": {
                "$nin": [None, ""],
            }
        },
    )

    return sorted(
        {
            str(value).strip()
            for value in values
            if str(value or "").strip()
        },
        key=str.casefold,
    )


@router.get("/inventory")
async def list_inventory(
    q: str = "",
    type: str = "",
    category: str = "",
    low: str = "",
    sort: str = "category_asc",
    user: dict = Depends(get_current_user),
):
    query = {}

    if q:
        escaped = re.escape(q)
        query["$or"] = [
            {
                "item_code": {
                    "$regex": escaped,
                    "$options": "i",
                }
            },
            {
                "item_name": {
                    "$regex": escaped,
                    "$options": "i",
                }
            },
            {
                "category": {
                    "$regex": escaped,
                    "$options": "i",
                }
            },
            {
                "part_number": {
                    "$regex": escaped,
                    "$options": "i",
                }
            },
            {
                "storage_location": {
                    "$regex": escaped,
                    "$options": "i",
                }
            },
        ]

    if type:
        query["type"] = type

    if category:
        query["category"] = category

    if str(low).lower() in (
        "true",
        "1",
        "yes",
    ):
        query["$expr"] = {
            "$lte": [
                "$stock",
                "$min_stock",
            ]
        }

    sort_spec = SORTS.get(
        sort,
        SORTS["category_asc"],
    )

    items = (
        await db.inventory_items.find(
            query,
            {"_id": 0},
        )
        .sort(sort_spec)
        .to_list(5000)
    )

    return items


@router.get("/inventory/{iid}")
async def get_item(
    iid: str,
    user: dict = Depends(get_current_user),
):
    item = await db.inventory_items.find_one(
        {"id": iid},
        {"_id": 0},
    )

    if not item:
        raise HTTPException(
            status_code=404,
            detail="Item not found",
        )

    txns = (
        await db.inventory_transactions.find(
            {"item_id": iid},
            {"_id": 0},
        )
        .sort("created_at", -1)
        .to_list(1000)
    )

    return {
        "item": item,
        "transactions": txns,
    }


@router.post("/inventory")
async def create_item(
    body: ItemBody,
    user: dict = Depends(MANAGE),
):
    payload = _clean_item_payload(body)

    if await db.inventory_items.find_one(
        {"item_code": payload["item_code"]}
    ):
        raise HTTPException(
            status_code=400,
            detail="Item code already exists",
        )

    doc = {
        **payload,
        "id": new_id(),
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }

    await db.inventory_items.insert_one(doc)

    if float(payload.get("stock") or 0):
        await db.inventory_transactions.insert_one(
            {
                "id": new_id(),
                "item_id": doc["id"],
                "item_code": doc["item_code"],
                "item_name": doc["item_name"],
                "type": "initial",
                "direction": "in",
                "qty": payload["stock"],
                "unit": doc["unit"],
                "maintenance_id": None,
                "equipment_id": None,
                "balance_after": payload["stock"],
                "note": "Initial stock",
                "created_by": user["name"],
                "created_at": now_iso(),
            }
        )

    await audit_log(
        "inventory",
        doc["id"],
        "inventory.create",
        user,
        (
            f"Created {doc['item_code']}"
            + (
                f" in category {doc['category']}"
                if doc.get("category")
                else ""
            )
        ),
    )

    doc.pop("_id", None)
    return doc


@router.put("/inventory/{iid}")
async def update_item(
    iid: str,
    body: ItemBody,
    user: dict = Depends(MANAGE),
):
    item = await db.inventory_items.find_one(
        {"id": iid}
    )

    if not item:
        raise HTTPException(
            status_code=404,
            detail="Item not found",
        )

    payload = _clean_item_payload(body)

    if await db.inventory_items.find_one(
        {
            "item_code": payload["item_code"],
            "id": {"$ne": iid},
        }
    ):
        raise HTTPException(
            status_code=400,
            detail="Item code already exists",
        )

    old_raw = item.get("stock", 0)
    old_stock = float(old_raw or 0)
    new_stock = float(payload["stock"])
    change = new_stock - old_stock

    updates = {
        **payload,
        "updated_at": now_iso(),
    }

    before = await db.inventory_items.find_one_and_update(
        {
            "id": iid,
            "stock": old_raw,
        },
        {
            "$set": updates,
        },
        return_document=ReturnDocument.BEFORE,
    )

    if not before:
        raise HTTPException(
            status_code=409,
            detail=(
                "Stock changed concurrently; "
                "reload the item before saving"
            ),
        )

    if change:
        await db.inventory_transactions.insert_one(
            {
                "id": new_id(),
                "item_id": iid,
                "item_code": payload["item_code"],
                "item_name": payload["item_name"],
                "type": "adjustment",
                "direction": (
                    "in"
                    if change > 0
                    else "out"
                ),
                "qty": abs(change),
                "unit": payload["unit"],
                "maintenance_id": None,
                "equipment_id": None,
                "stock_before": old_stock,
                "balance_after": new_stock,
                "note": "Stock updated via edit",
                "created_by": user["name"],
                "created_at": now_iso(),
            }
        )

    await audit_log(
        "inventory",
        iid,
        "inventory.update",
        user,
        (
            f"Updated {payload['item_code']}"
            + (
                f" in category {payload['category']}"
                if payload.get("category")
                else ""
            )
        ),
    )

    return await db.inventory_items.find_one(
        {"id": iid},
        {"_id": 0},
    )


@router.post("/inventory/{iid}/adjust")
async def adjust_stock(
    iid: str,
    body: AdjustBody,
    user: dict = Depends(MANAGE),
):
    delta = float(body.qty)

    query = {"id": iid}

    if delta < 0:
        query["stock"] = {
            "$gte": abs(delta)
        }

    before = await db.inventory_items.find_one_and_update(
        query,
        {
            "$inc": {
                "stock": delta,
            },
            "$set": {
                "updated_at": now_iso(),
            },
        },
        return_document=ReturnDocument.BEFORE,
    )

    if not before:
        if not await db.inventory_items.find_one(
            {"id": iid}
        ):
            raise HTTPException(
                status_code=404,
                detail="Item not found",
            )

        raise HTTPException(
            status_code=400,
            detail="Stock cannot go negative",
        )

    stock_before = float(
        before.get("stock") or 0
    )
    new_stock = stock_before + delta

    await db.inventory_transactions.insert_one(
        {
            "id": new_id(),
            "item_id": iid,
            "item_code": before["item_code"],
            "item_name": before["item_name"],
            "type": "adjustment",
            "direction": (
                "in"
                if delta > 0
                else "out"
            ),
            "qty": abs(delta),
            "unit": before["unit"],
            "maintenance_id": None,
            "equipment_id": None,
            "stock_before": stock_before,
            "balance_after": new_stock,
            "note": body.note or "Manual adjustment",
            "created_by": user["name"],
            "created_at": now_iso(),
        }
    )

    await audit_log(
        "inventory",
        iid,
        "inventory.adjust",
        user,
        f"{before['item_code']} {delta:+g}",
    )

    return await db.inventory_items.find_one(
        {"id": iid},
        {"_id": 0},
    )


@router.delete("/inventory/{iid}")
async def delete_item(
    iid: str,
    user: dict = Depends(MANAGE),
):
    item = await db.inventory_items.find_one(
        {"id": iid}
    )

    if not item:
        raise HTTPException(
            status_code=404,
            detail="Item not found",
        )

    used = await db.inventory_transactions.count_documents(
        {
            "item_id": iid,
            "direction": "out",
        }
    )

    if used:
        raise HTTPException(
            status_code=400,
            detail=(
                "Item has consumption history and cannot "
                "be deleted. Set stock to 0 instead."
            ),
        )

    await db.inventory_items.delete_one(
        {"id": iid}
    )
    await db.inventory_transactions.delete_many(
        {"item_id": iid}
    )

    await audit_log(
        "inventory",
        iid,
        "inventory.delete",
        user,
        f"Deleted {item['item_code']}",
    )

    return {"ok": True}


@router.get("/inventory-transactions")
async def all_transactions(
    item_id: str = "",
    user: dict = Depends(get_current_user),
):
    query = (
        {"item_id": item_id}
        if item_id
        else {}
    )

    return (
        await db.inventory_transactions.find(
            query,
            {"_id": 0},
        )
        .sort("created_at", -1)
        .limit(500)
        .to_list(500)
    )
