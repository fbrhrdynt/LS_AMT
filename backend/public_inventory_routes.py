import base64
import hashlib
import hmac
import io
import os
import re
import secrets
import time
from collections import defaultdict, deque
from pathlib import Path

import qrcode
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from PIL import Image, ImageDraw, ImageFont

from auth import get_jwt_secret, require_roles
from branding import get_pdf_brand_logo_bytes
from core import audit_log, db, now_iso
from export_routes import _pdf_bytes, _timezone_name, _xlsx_bytes
from public_access import PUBLIC_BASE_URL


router = APIRouter(prefix="/api")
ADMIN = require_roles("admin")
SETTINGS_ID = "public_inventory"

PUBLIC_HEADERS = {
    "Cache-Control": "no-store, max-age=0",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Referrer-Policy": "no-referrer",
}

PUBLIC_FIELDS = {
    "_id": 0,
    "item_code": 1,
    "item_name": 1,
    "category": 1,
    "type": 1,
    "part_number": 1,
    "unit": 1,
    "stock": 1,
    "min_stock": 1,
    "storage_location": 1,
}

SORTS = {
    "category_asc": [("category", 1), ("item_code", 1)],
    "item_code_asc": [("item_code", 1)],
    "item_name_asc": [("item_name", 1), ("item_code", 1)],
    "stock_asc": [("stock", 1), ("item_code", 1)],
}

_RATE_BUCKETS = defaultdict(deque)


def _client_key(request: Request, token_id: str) -> str:
    host = request.client.host if request.client else "unknown"
    return f"{host}:{token_id}"


def _rate_limit(
    request: Request,
    token_id: str,
    *,
    limit: int,
    window_seconds: int,
):
    key = _client_key(request, token_id)
    now = time.monotonic()
    bucket = _RATE_BUCKETS[key]
    cutoff = now - window_seconds

    while bucket and bucket[0] < cutoff:
        bucket.popleft()

    if len(bucket) >= limit:
        raise HTTPException(
            status_code=429,
            detail="Too many public inventory requests. Try again shortly.",
        )

    bucket.append(now)


def _signing_key() -> bytes:
    value = (
        os.environ.get("PUBLIC_INVENTORY_SIGNING_KEY")
        or get_jwt_secret()
    )
    return value.encode("utf-8")


def _signature(token_id: str) -> str:
    digest = hmac.new(
        _signing_key(),
        f"amt-public-inventory:{token_id}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def _public_token(token_id: str) -> str:
    return f"{token_id}.{_signature(token_id)}"


def _public_url(token_id: str) -> str:
    return f"{PUBLIC_BASE_URL}/q/inventory/{_public_token(token_id)}"


def _new_token_id() -> str:
    return secrets.token_urlsafe(24)


def _split_token(token: str):
    value = str(token or "").strip()

    if len(value) < 40 or len(value) > 200 or "." not in value:
        return None, None

    token_id, supplied_signature = value.split(".", 1)

    if not re.fullmatch(r"[A-Za-z0-9_-]{20,80}", token_id):
        return None, None

    if not re.fullmatch(r"[A-Za-z0-9_-]{30,100}", supplied_signature):
        return None, None

    return token_id, supplied_signature


async def _validate_public_token(token: str):
    token_id, supplied_signature = _split_token(token)

    if not token_id:
        return None

    settings = await db.settings.find_one(
        {
            "_id": SETTINGS_ID,
            "enabled": True,
            "token_id": token_id,
        },
        {
            "_id": 0,
            "token_id": 1,
            "enabled": 1,
            "updated_at": 1,
        },
    )

    if not settings:
        return None

    expected = _signature(token_id)

    if not hmac.compare_digest(supplied_signature, expected):
        return None

    return settings


async def _require_public_token(
    token: str,
    request: Request,
    *,
    export: bool = False,
):
    settings = await _validate_public_token(token)

    if not settings:
        raise HTTPException(
            status_code=404,
            detail="Public inventory link is not available",
        )

    _rate_limit(
        request,
        settings["token_id"],
        limit=20 if export else 240,
        window_seconds=60,
    )

    return settings


def _rx(value: str):
    return {
        "$regex": re.escape(value),
        "$options": "i",
    }


def _stock_status(item: dict) -> str:
    stock = float(item.get("stock") or 0)
    minimum = float(item.get("min_stock") or 0)

    if stock <= 0:
        return "Out of Stock"
    if stock <= minimum:
        return "Low Stock"
    return "Healthy"


def _reorder_gap(item: dict) -> float:
    stock = float(item.get("stock") or 0)
    minimum = float(item.get("min_stock") or 0)
    return max(minimum - stock, 0)


def _query(
    q="",
    category="",
    type="",
    stock_status="",
    storage_location="",
):
    query = {}

    if q:
        query["$or"] = [
            {"item_code": _rx(q)},
            {"item_name": _rx(q)},
            {"category": _rx(q)},
            {"part_number": _rx(q)},
            {"storage_location": _rx(q)},
        ]

    if category:
        query["category"] = category

    if type:
        query["type"] = type

    if storage_location:
        query["storage_location"] = _rx(storage_location)

    status = str(stock_status or "").lower()

    if status == "out":
        query["stock"] = {"$lte": 0}
    elif status == "healthy":
        query["$expr"] = {"$gt": ["$stock", "$min_stock"]}
    elif status == "low":
        query["$expr"] = {"$lte": ["$stock", "$min_stock"]}

    return query


async def _rows(
    q="",
    category="",
    type="",
    stock_status="",
    storage_location="",
    sort="category_asc",
):
    query = _query(
        q=q,
        category=category,
        type=type,
        stock_status=stock_status,
        storage_location=storage_location,
    )

    sort_spec = SORTS.get(sort, SORTS["category_asc"])

    records = (
        await db.inventory_items.find(
            query,
            PUBLIC_FIELDS,
        )
        .sort(sort_spec)
        .to_list(10000)
    )

    items = []

    for item in records:
        item = dict(item)
        item["stock_status"] = _stock_status(item)
        item["reorder_gap"] = _reorder_gap(item)
        items.append(item)

    return items


async def _public_export_rows(**filters):
    items = await _rows(**filters)

    headers = [
        "Item Code",
        "Item Name",
        "Category",
        "Type",
        "Part Number",
        "Unit",
        "Stock",
        "Minimum Stock",
        "Stock Status",
        "Reorder Gap",
        "Storage Location",
    ]

    rows = [
        [
            item.get("item_code"),
            item.get("item_name"),
            item.get("category"),
            item.get("type"),
            item.get("part_number"),
            item.get("unit"),
            item.get("stock"),
            item.get("min_stock"),
            item.get("stock_status"),
            item.get("reorder_gap"),
            item.get("storage_location"),
        ]
        for item in items
    ]

    return headers, rows


def _qr_png(url: str) -> bytes:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=12,
        border=4,
    )
    qr.add_data(url)
    qr.make(fit=True)

    image = qr.make_image(
        fill_color="black",
        back_color="white",
    )

    if hasattr(image, "get_image"):
        image = image.get_image()

    image = image.convert("RGB")

    buf = io.BytesIO()
    image.save(
        buf,
        format="PNG",
        dpi=(300, 300),
    )
    buf.seek(0)
    return buf.read()


def _font(size: int, bold: bool = False):
    filename = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"

    for base in (
        "/usr/share/fonts/truetype/dejavu",
        "/usr/share/fonts/dejavu",
    ):
        path = Path(base) / filename
        if path.exists():
            return ImageFont.truetype(str(path), size=size)

    return ImageFont.load_default()


def _center_text(
    draw,
    canvas_width,
    y,
    text,
    font,
    fill="black",
):
    box = draw.textbbox(
        (0, 0),
        text,
        font=font,
    )
    width = box[2] - box[0]

    draw.text(
        (
            max(0, (canvas_width - width) // 2),
            y,
        ),
        text,
        font=font,
        fill=fill,
    )


def _qr_label_png(url: str) -> bytes:
    width = 1000
    height = 1250

    canvas = Image.new(
        "RGB",
        (width, height),
        "white",
    )
    draw = ImageDraw.Draw(canvas)

    draw.rounded_rectangle(
        (6, 6, width - 7, height - 7),
        radius=28,
        outline="black",
        width=6,
        fill="white",
    )

    title_font = _font(48, bold=True)
    sub_font = _font(30, bold=False)
    footer_font = _font(24, bold=False)

    _center_text(
        draw,
        width,
        55,
        "AMT Inventory",
        title_font,
    )

    qr = qrcode.make(url).convert("RGB")
    qr = qr.resize(
        (760, 760),
        Image.Resampling.NEAREST,
    )

    canvas.paste(
        qr,
        ((width - 760) // 2, 200),
    )

    _center_text(
        draw,
        width,
        1005,
        "Scan to view current cabinet inventory",
        sub_font,
    )

    _center_text(
        draw,
        width,
        1090,
        "Powered by AMT - LogiSource Digital",
        footer_font,
        fill="#64748B",
    )

    out = io.BytesIO()
    canvas.save(
        out,
        format="PNG",
        dpi=(300, 300),
        optimize=True,
    )
    out.seek(0)
    return out.read()


async def _management_payload():
    settings = await db.settings.find_one(
        {"_id": SETTINGS_ID},
        {"_id": 0},
    ) or {}

    token_id = str(settings.get("token_id") or "").strip()

    return {
        "generated": bool(token_id),
        "enabled": bool(settings.get("enabled")),
        "public_url": _public_url(token_id) if token_id else None,
        "updated_at": settings.get("updated_at"),
        "created_at": settings.get("created_at"),
    }


@router.get("/inventory-public-access")
async def inventory_public_link(
    user: dict = Depends(ADMIN),
):
    return await _management_payload()


@router.post("/inventory-public-access/generate")
async def generate_inventory_public_link(
    user: dict = Depends(ADMIN),
):
    current = await db.settings.find_one(
        {"_id": SETTINGS_ID}
    )

    token_id = str(
        (current or {}).get("token_id") or ""
    ).strip()

    now = now_iso()

    if not token_id:
        token_id = _new_token_id()

    await db.settings.update_one(
        {"_id": SETTINGS_ID},
        {
            "$set": {
                "token_id": token_id,
                "enabled": True,
                "updated_at": now,
                "updated_by": user["name"],
            },
            "$setOnInsert": {
                "created_at": now,
                "created_by": user["name"],
            },
        },
        upsert=True,
    )

    await audit_log(
        "settings",
        SETTINGS_ID,
        "inventory.public_link.generate",
        user,
        "Generated/enabled Inventory public QR link",
    )

    return await _management_payload()


@router.post("/inventory-public-access/reset")
async def reset_inventory_public_link(
    user: dict = Depends(ADMIN),
):
    token_id = _new_token_id()
    now = now_iso()

    await db.settings.update_one(
        {"_id": SETTINGS_ID},
        {
            "$set": {
                "token_id": token_id,
                "enabled": True,
                "updated_at": now,
                "updated_by": user["name"],
            },
            "$setOnInsert": {
                "created_at": now,
                "created_by": user["name"],
            },
        },
        upsert=True,
    )

    await audit_log(
        "settings",
        SETTINGS_ID,
        "inventory.public_link.reset",
        user,
        "Reset Inventory public QR link; previous link revoked",
    )

    return await _management_payload()


@router.post("/inventory-public-access/disable")
async def disable_inventory_public_link(
    user: dict = Depends(ADMIN),
):
    if not await db.settings.find_one(
        {"_id": SETTINGS_ID}
    ):
        raise HTTPException(
            status_code=404,
            detail="Inventory public link has not been generated",
        )

    await db.settings.update_one(
        {"_id": SETTINGS_ID},
        {
            "$set": {
                "enabled": False,
                "updated_at": now_iso(),
                "updated_by": user["name"],
            }
        },
    )

    await audit_log(
        "settings",
        SETTINGS_ID,
        "inventory.public_link.disable",
        user,
        "Disabled Inventory public QR link",
    )

    return await _management_payload()


@router.post("/inventory-public-access/enable")
async def enable_inventory_public_link(
    user: dict = Depends(ADMIN),
):
    settings = await db.settings.find_one(
        {"_id": SETTINGS_ID}
    )

    if not settings or not settings.get("token_id"):
        raise HTTPException(
            status_code=404,
            detail="Inventory public link has not been generated",
        )

    await db.settings.update_one(
        {"_id": SETTINGS_ID},
        {
            "$set": {
                "enabled": True,
                "updated_at": now_iso(),
                "updated_by": user["name"],
            }
        },
    )

    await audit_log(
        "settings",
        SETTINGS_ID,
        "inventory.public_link.enable",
        user,
        "Enabled Inventory public QR link",
    )

    return await _management_payload()


@router.get("/inventory-public-access/qr.png")
async def inventory_public_qr(
    download: bool = Query(False),
    user: dict = Depends(ADMIN),
):
    settings = await db.settings.find_one(
        {"_id": SETTINGS_ID},
        {"_id": 0},
    )

    if not settings or not settings.get("token_id"):
        raise HTTPException(
            status_code=404,
            detail="Inventory public link has not been generated",
        )

    png = _qr_png(
        _public_url(settings["token_id"])
    )

    disposition = "attachment" if download else "inline"

    return Response(
        content=png,
        media_type="image/png",
        headers={
            **PUBLIC_HEADERS,
            "Content-Disposition": (
                f'{disposition}; filename="AMT-Inventory-Public-QR.png"'
            ),
        },
    )


@router.get("/inventory-public-access/qr-label.png")
async def inventory_public_qr_label(
    download: bool = Query(False),
    user: dict = Depends(ADMIN),
):
    settings = await db.settings.find_one(
        {"_id": SETTINGS_ID},
        {"_id": 0},
    )

    if not settings or not settings.get("token_id"):
        raise HTTPException(
            status_code=404,
            detail="Inventory public link has not been generated",
        )

    png = _qr_label_png(
        _public_url(settings["token_id"])
    )

    disposition = "attachment" if download else "inline"

    return Response(
        content=png,
        media_type="image/png",
        headers={
            **PUBLIC_HEADERS,
            "Content-Disposition": (
                f'{disposition}; filename="AMT-Inventory-Cabinet-QR-Label.png"'
            ),
        },
    )


@router.get("/public/inventory/{token}")
async def public_inventory(
    token: str,
    request: Request,
    q: str = Query("", max_length=100),
    category: str = Query("", max_length=100),
    type: str = Query("", max_length=50),
    stock_status: str = Query("", max_length=30),
    storage_location: str = Query("", max_length=100),
    sort: str = Query("category_asc", max_length=30),
):
    await _require_public_token(
        token,
        request,
    )

    items = await _rows(
        q=q,
        category=category,
        type=type,
        stock_status=stock_status,
        storage_location=storage_location,
        sort=sort,
    )

    categories = sorted(
        {
            str(value).strip()
            for value in await db.inventory_items.distinct(
                "category",
                {
                    "category": {
                        "$nin": [None, ""],
                    }
                },
            )
            if str(value or "").strip()
        },
        key=str.casefold,
    )

    return Response(
        content=__import__("json").dumps(
            {
                "read_only": True,
                "total": len(items),
                "categories": categories,
                "types": [
                    "Spare Part",
                    "Consumable",
                ],
                "items": items,
            }
        ),
        media_type="application/json",
        headers=PUBLIC_HEADERS,
    )


@router.get("/public/inventory/{token}/export.xlsx")
async def public_inventory_xlsx(
    token: str,
    request: Request,
    q: str = Query("", max_length=100),
    category: str = Query("", max_length=100),
    type: str = Query("", max_length=50),
    stock_status: str = Query("", max_length=30),
    storage_location: str = Query("", max_length=100),
    sort: str = Query("category_asc", max_length=30),
):
    await _require_public_token(
        token,
        request,
        export=True,
    )

    headers, rows = await _public_export_rows(
        q=q,
        category=category,
        type=type,
        stock_status=stock_status,
        storage_location=storage_location,
        sort=sort,
    )

    data = _xlsx_bytes(
        "Public Inventory",
        headers,
        rows,
        await _timezone_name(),
        await get_pdf_brand_logo_bytes(),
    )

    return Response(
        content=data,
        media_type=(
            "application/vnd.openxmlformats-officedocument."
            "spreadsheetml.sheet"
        ),
        headers={
            **PUBLIC_HEADERS,
            "Content-Disposition": (
                'attachment; filename="amt-public-inventory.xlsx"'
            ),
        },
    )


@router.get("/public/inventory/{token}/export.pdf")
async def public_inventory_pdf(
    token: str,
    request: Request,
    q: str = Query("", max_length=100),
    category: str = Query("", max_length=100),
    type: str = Query("", max_length=50),
    stock_status: str = Query("", max_length=30),
    storage_location: str = Query("", max_length=100),
    sort: str = Query("category_asc", max_length=30),
):
    await _require_public_token(
        token,
        request,
        export=True,
    )

    headers, rows = await _public_export_rows(
        q=q,
        category=category,
        type=type,
        stock_status=stock_status,
        storage_location=storage_location,
        sort=sort,
    )

    data = _pdf_bytes(
        "Public Inventory",
        headers,
        rows,
        await _timezone_name(),
        await get_pdf_brand_logo_bytes(),
    )

    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            **PUBLIC_HEADERS,
            "Content-Disposition": (
                'inline; filename="amt-public-inventory.pdf"'
            ),
        },
    )
