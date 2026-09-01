from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, new_id, now_iso, audit_log
from auth import get_current_user, require_roles

router = APIRouter(prefix="/api")
MANAGE = require_roles("admin", "supervisor")


class ItemBody(BaseModel):
    item_code: str
    item_name: str
    type: str = "Spare Part"
    part_number: str = ""
    unit: str = "EA"
    stock: float = 0
    min_stock: float = 0
    storage_location: str = ""
    unit_price: float = 0


class AdjustBody(BaseModel):
    qty: float
    note: str = ""


@router.get("/inventory")
async def list_inventory(q: str = "", type: str = "", low: str = "",
                         user: dict = Depends(get_current_user)):
    query = {}
    if q:
        query["$or"] = [{"item_code": {"$regex": q, "$options": "i"}},
                        {"item_name": {"$regex": q, "$options": "i"}},
                        {"part_number": {"$regex": q, "$options": "i"}}]
    if type:
        query["type"] = type
    if str(low).lower() in ("true", "1", "yes"):
        query["$expr"] = {"$lte": ["$stock", "$min_stock"]}
    items = await db.inventory_items.find(query, {"_id": 0}).sort("item_code", 1).to_list(2000)
    return items


@router.get("/inventory/{iid}")
async def get_item(iid: str, user: dict = Depends(get_current_user)):
    item = await db.inventory_items.find_one({"id": iid}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    txns = await db.inventory_transactions.find({"item_id": iid}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return {"item": item, "transactions": txns}


@router.post("/inventory")
async def create_item(body: ItemBody, user: dict = Depends(MANAGE)):
    if await db.inventory_items.find_one({"item_code": body.item_code}):
        raise HTTPException(status_code=400, detail="Item code already exists")
    doc = body.model_dump()
    doc.update({"id": new_id(), "created_at": now_iso(), "updated_at": now_iso()})
    await db.inventory_items.insert_one(doc)
    if body.stock:
        await db.inventory_transactions.insert_one({
            "id": new_id(), "item_id": doc["id"], "item_code": doc["item_code"],
            "item_name": doc["item_name"], "type": "initial", "direction": "in",
            "qty": body.stock, "unit": doc["unit"], "maintenance_id": None, "equipment_id": None,
            "balance_after": body.stock, "note": "Initial stock", "created_by": user["name"],
            "created_at": now_iso()})
    await audit_log("inventory", doc["id"], "inventory.create", user, f"Created {body.item_code}")
    doc.pop("_id", None)
    return doc


@router.put("/inventory/{iid}")
async def update_item(iid: str, body: ItemBody, user: dict = Depends(MANAGE)):
    item = await db.inventory_items.find_one({"id": iid})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    updates = body.model_dump()
    stock_change = body.stock - item["stock"]
    updates["updated_at"] = now_iso()
    await db.inventory_items.update_one({"id": iid}, {"$set": updates})
    if stock_change != 0:
        await db.inventory_transactions.insert_one({
            "id": new_id(), "item_id": iid, "item_code": item["item_code"],
            "item_name": item["item_name"], "type": "adjustment",
            "direction": "in" if stock_change > 0 else "out", "qty": abs(stock_change),
            "unit": body.unit, "maintenance_id": None, "equipment_id": None,
            "balance_after": body.stock, "note": "Stock updated via edit",
            "created_by": user["name"], "created_at": now_iso()})
    await audit_log("inventory", iid, "inventory.update", user, f"Updated {item['item_code']}")
    return await db.inventory_items.find_one({"id": iid}, {"_id": 0})


@router.post("/inventory/{iid}/adjust")
async def adjust_stock(iid: str, body: AdjustBody, user: dict = Depends(MANAGE)):
    item = await db.inventory_items.find_one({"id": iid})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    new_stock = item["stock"] + body.qty
    if new_stock < 0:
        raise HTTPException(status_code=400, detail="Stock cannot go negative")
    await db.inventory_items.update_one({"id": iid}, {"$set": {"stock": new_stock, "updated_at": now_iso()}})
    await db.inventory_transactions.insert_one({
        "id": new_id(), "item_id": iid, "item_code": item["item_code"], "item_name": item["item_name"],
        "type": "adjustment", "direction": "in" if body.qty >= 0 else "out", "qty": abs(body.qty),
        "unit": item["unit"], "maintenance_id": None, "equipment_id": None, "balance_after": new_stock,
        "note": body.note or "Manual adjustment", "created_by": user["name"], "created_at": now_iso()})
    await audit_log("inventory", iid, "inventory.adjust", user, f"{item['item_code']} {body.qty:+g}")
    return await db.inventory_items.find_one({"id": iid}, {"_id": 0})


@router.delete("/inventory/{iid}")
async def delete_item(iid: str, user: dict = Depends(MANAGE)):
    item = await db.inventory_items.find_one({"id": iid})
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    used = await db.inventory_transactions.count_documents({"item_id": iid, "direction": "out"})
    if used:
        raise HTTPException(status_code=400, detail="Item has consumption history and cannot be deleted. Set stock to 0 instead.")
    await db.inventory_items.delete_one({"id": iid})
    await db.inventory_transactions.delete_many({"item_id": iid})
    await audit_log("inventory", iid, "inventory.delete", user, f"Deleted {item['item_code']}")
    return {"ok": True}


@router.get("/inventory-transactions")
async def all_transactions(item_id: str = "", user: dict = Depends(get_current_user)):
    query = {"item_id": item_id} if item_id else {}
    return await db.inventory_transactions.find(query, {"_id": 0}).sort("created_at", -1).limit(500).to_list(500)
