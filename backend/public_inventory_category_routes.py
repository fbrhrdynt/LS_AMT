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
from PIL import Image, ImageDraw

from auth import get_jwt_secret, require_menu_permission
from branding import get_pdf_brand_logo_bytes
from core import audit_log, db, new_id, now_iso
from export_routes import _pdf_bytes, _timezone_name, _xlsx_bytes
from public_access import PUBLIC_BASE_URL
from public_inventory_routes import (
    PUBLIC_HEADERS,
    SORTS,
    _center_text,
    _font,
    _qr_png,
    _reorder_gap,
    _rx,
    _stock_status,
)


router = APIRouter(prefix="/api")
INVENTORY_PUBLIC = require_menu_permission("inv", "public")

COLLECTION = "public_inventory_category_links"

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
    "unit_price": 1,
}

_RATE_BUCKETS = defaultdict(deque)


def _signing_key() -> bytes:
    value = (
        os.environ.get("PUBLIC_INVENTORY_SIGNING_KEY")
        or get_jwt_secret()
    )
    return value.encode("utf-8")


def _signature(token_id: str) -> str:
    digest = hmac.new(
        _signing_key(),
        f"amt-public-inventory-category:{token_id}".encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return (
        base64.urlsafe_b64encode(digest)
        .decode("ascii")
        .rstrip("=")
    )


def _public_token(token_id: str) -> str:
    return f"{token_id}.{_signature(token_id)}"


def _public_url(token_id: str) -> str:
    return (
        f"{PUBLIC_BASE_URL}/q/inventory-category/"
        f"{_public_token(token_id)}"
    )


def _new_token_id() -> str:
    return secrets.token_urlsafe(24)


def _category_key(category: str) -> str:
    return " ".join(
        str(category or "")
        .strip()
        .split()
    ).casefold()


def _clean_category(category: str) -> str:
    return " ".join(
        str(category or "")
        .strip()
        .split()
    )


def _split_token(token: str):
    value = str(token or "").strip()

    if (
        len(value) < 40
        or len(value) > 200
        or "." not in value
    ):
        return None, None

    token_id, supplied_signature = (
        value.split(".", 1)
    )

    if not re.fullmatch(
        r"[A-Za-z0-9_-]{20,80}",
        token_id,
    ):
        return None, None

    if not re.fullmatch(
        r"[A-Za-z0-9_-]{30,100}",
        supplied_signature,
    ):
        return None, None

    return (
        token_id,
        supplied_signature,
    )


def _client_key(
    request: Request,
    token_id: str,
) -> str:
    host = (
        request.client.host
        if request.client
        else "unknown"
    )
    return f"{host}:{token_id}"


def _rate_limit(
    request: Request,
    token_id: str,
    *,
    limit: int,
    window_seconds: int,
):
    key = _client_key(
        request,
        token_id,
    )
    now = time.monotonic()
    bucket = _RATE_BUCKETS[key]
    cutoff = now - window_seconds

    while (
        bucket
        and bucket[0] < cutoff
    ):
        bucket.popleft()

    if len(bucket) >= limit:
        raise HTTPException(
            status_code=429,
            detail=(
                "Too many public inventory requests. "
                "Try again shortly."
            ),
        )

    bucket.append(now)


async def ensure_category_link(
    category: str,
    user: dict | None = None,
) -> dict | None:
    category = _clean_category(category)

    if not category:
        return None

    key = _category_key(category)
    now = now_iso()

    existing = (
        await db[COLLECTION].find_one(
            {"category_key": key},
            {"_id": 0},
        )
    )

    if existing:
        if existing.get("category") != category:
            await db[COLLECTION].update_one(
                {"id": existing["id"]},
                {
                    "$set": {
                        "category": category,
                        "updated_at": now,
                    }
                },
            )
            existing["category"] = category
            existing["updated_at"] = now
        return existing

    doc = {
        "id": new_id(),
        "category": category,
        "category_key": key,
        "token_id": _new_token_id(),
        "enabled": True,
        "created_at": now,
        "updated_at": now,
        "created_by": (
            (user or {}).get("id")
        ),
    }

    try:
        await db[COLLECTION].insert_one(
            doc
        )
    except Exception:
        existing = (
            await db[COLLECTION].find_one(
                {"category_key": key},
                {"_id": 0},
            )
        )
        if existing:
            return existing
        raise

    if user:
        await audit_log(
            "inventory_category",
            doc["id"],
            "inventory.public_category.create",
            user,
            (
                "Created public Inventory QR for "
                f"category {category}"
            ),
        )

    doc.pop("_id", None)
    return doc


async def _sync_links(
    user: dict,
) -> list[dict]:
    categories = sorted(
        {
            _clean_category(value)
            for value in await db.inventory_items.distinct(
                "category",
                {
                    "category": {
                        "$nin": [
                            None,
                            "",
                        ]
                    }
                },
            )
            if _clean_category(value)
        },
        key=str.casefold,
    )

    result = []

    for category in categories:
        link = await ensure_category_link(
            category,
            user,
        )

        count = (
            await db.inventory_items.count_documents(
                {
                    "category": category
                }
            )
        )

        result.append(
            _management_payload(
                link,
                count,
            )
        )

    # 1.2.0 replaces the old all-inventory QR management UI.
    # Disable the old global link once category QR management is used.
    await db.settings.update_one(
        {
            "_id": "public_inventory",
            "enabled": True,
        },
        {
            "$set": {
                "enabled": False,
                "updated_at": now_iso(),
            }
        },
    )

    return result


def _management_payload(
    link: dict,
    item_count: int | None = None,
) -> dict:
    return {
        "id": link["id"],
        "category": link["category"],
        "generated": bool(
            link.get("token_id")
        ),
        "enabled": bool(
            link.get("enabled")
        ),
        "public_url": (
            _public_url(
                link["token_id"]
            )
            if link.get("token_id")
            else None
        ),
        "updated_at": link.get(
            "updated_at"
        ),
        "created_at": link.get(
            "created_at"
        ),
        "item_count": item_count,
    }


async def _link_by_id(
    link_id: str,
) -> dict:
    link = await db[COLLECTION].find_one(
        {"id": link_id},
        {"_id": 0},
    )

    if not link:
        raise HTTPException(
            status_code=404,
            detail=(
                "Inventory category QR link "
                "not found"
            ),
        )

    return link


async def _validate_public_token(
    token: str,
) -> dict | None:
    (
        token_id,
        supplied_signature,
    ) = _split_token(token)

    if not token_id:
        return None

    link = await db[COLLECTION].find_one(
        {
            "token_id": token_id,
            "enabled": True,
        },
        {"_id": 0},
    )

    if not link:
        return None

    expected = _signature(
        token_id
    )

    if not hmac.compare_digest(
        supplied_signature,
        expected,
    ):
        return None

    return link


async def _require_public_token(
    token: str,
    request: Request,
    *,
    export: bool = False,
) -> dict:
    link = await _validate_public_token(
        token
    )

    if not link:
        raise HTTPException(
            status_code=404,
            detail=(
                "Public inventory category link "
                "is not available"
            ),
        )

    _rate_limit(
        request,
        link["token_id"],
        limit=20 if export else 240,
        window_seconds=60,
    )

    return link


async def _rows(
    category: str,
    q="",
    type="",
    stock_status="",
    storage_location="",
    sort="item_code_asc",
):
    query = {
        "category": category,
    }

    if q:
        query["$or"] = [
            {"item_code": _rx(q)},
            {"item_name": _rx(q)},
            {"part_number": _rx(q)},
            {
                "storage_location":
                    _rx(q)
            },
        ]

    if type:
        query["type"] = type

    if storage_location:
        query["storage_location"] = (
            _rx(
                storage_location
            )
        )

    status = str(
        stock_status or ""
    ).lower()

    if status == "out":
        query["stock"] = {
            "$lte": 0
        }
    elif status == "healthy":
        query["$expr"] = {
            "$gt": [
                "$stock",
                "$min_stock",
            ]
        }
    elif status == "low":
        query["$expr"] = {
            "$lte": [
                "$stock",
                "$min_stock",
            ]
        }

    sort_spec = SORTS.get(
        sort,
        SORTS.get(
            "item_code_asc",
            [("item_code", 1)],
        ),
    )

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
        row = dict(item)
        row["stock_status"] = (
            _stock_status(row)
        )
        row["reorder_gap"] = (
            _reorder_gap(row)
        )

        stock = float(
            row.get("stock") or 0
        )
        price = float(
            row.get("unit_price")
            or 0
        )
        row["stock_value"] = round(
            stock * price,
            2,
        )

        items.append(row)

    return items


async def _export_rows(
    category: str,
    **filters,
):
    items = await _rows(
        category=category,
        **filters,
    )

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
        "Unit Price",
        "Stock Value",
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
            item.get(
                "stock_status"
            ),
            item.get(
                "reorder_gap"
            ),
            item.get(
                "storage_location"
            ),
            item.get("unit_price"),
            item.get("stock_value"),
        ]
        for item in items
    ]

    return (
        headers,
        rows,
    )


def _safe_filename(
    value: str,
) -> str:
    cleaned = re.sub(
        r"[^A-Za-z0-9._-]+",
        "-",
        str(value or "").strip(),
    ).strip("-")

    return (
        cleaned[:80]
        or "category"
    )


def _qr_label_png(
    url: str,
    category: str,
) -> bytes:
    width = 1000
    height = 1250

    canvas = Image.new(
        "RGB",
        (width, height),
        "white",
    )
    draw = ImageDraw.Draw(canvas)

    draw.rounded_rectangle(
        (
            6,
            6,
            width - 7,
            height - 7,
        ),
        radius=28,
        outline="black",
        width=6,
        fill="white",
    )

    title_font = _font(
        46,
        bold=True,
    )
    category_font = _font(
        34,
        bold=True,
    )
    sub_font = _font(
        28,
        bold=False,
    )
    footer_font = _font(
        24,
        bold=False,
    )

    _center_text(
        draw,
        width,
        48,
        "AMT Inventory",
        title_font,
    )

    display_category = (
        category
        if len(category) <= 42
        else category[:39] + "..."
    )

    _center_text(
        draw,
        width,
        115,
        display_category,
        category_font,
    )

    qr = qrcode.make(
        url
    ).convert("RGB")

    qr = qr.resize(
        (750, 750),
        Image.Resampling.NEAREST,
    )

    canvas.paste(
        qr,
        (
            (width - 750) // 2,
            210,
        ),
    )

    _center_text(
        draw,
        width,
        1000,
        "Scan to view current cabinet inventory",
        sub_font,
    )

    _center_text(
        draw,
        width,
        1085,
        (
            "Powered by AMT - "
            "LogiSource Digital"
        ),
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


@router.post(
    "/inventory-category-public-access/sync"
)
async def sync_inventory_category_links(
    user: dict = Depends(
        INVENTORY_PUBLIC
    ),
):
    return await _sync_links(
        user
    )


@router.post(
    "/inventory-category-public-access/{link_id}/reset"
)
async def reset_inventory_category_link(
    link_id: str,
    user: dict = Depends(
        INVENTORY_PUBLIC
    ),
):
    link = await _link_by_id(
        link_id
    )

    await db[COLLECTION].update_one(
        {"id": link_id},
        {
            "$set": {
                "token_id": (
                    _new_token_id()
                ),
                "enabled": True,
                "updated_at": now_iso(),
                "updated_by": user["id"],
            }
        },
    )

    await audit_log(
        "inventory_category",
        link_id,
        "inventory.public_category.reset",
        user,
        (
            "Reset public Inventory QR for "
            f"category {link['category']}"
        ),
    )

    updated = await _link_by_id(
        link_id
    )

    return _management_payload(
        updated,
        await db.inventory_items.count_documents(
            {
                "category":
                    updated["category"]
            }
        ),
    )


@router.post(
    "/inventory-category-public-access/{link_id}/disable"
)
async def disable_inventory_category_link(
    link_id: str,
    user: dict = Depends(
        INVENTORY_PUBLIC
    ),
):
    link = await _link_by_id(
        link_id
    )

    await db[COLLECTION].update_one(
        {"id": link_id},
        {
            "$set": {
                "enabled": False,
                "updated_at": now_iso(),
                "updated_by": user["id"],
            }
        },
    )

    await audit_log(
        "inventory_category",
        link_id,
        "inventory.public_category.disable",
        user,
        (
            "Disabled public Inventory QR for "
            f"category {link['category']}"
        ),
    )

    updated = await _link_by_id(
        link_id
    )

    return _management_payload(
        updated,
        await db.inventory_items.count_documents(
            {
                "category":
                    updated["category"]
            }
        ),
    )


@router.post(
    "/inventory-category-public-access/{link_id}/enable"
)
async def enable_inventory_category_link(
    link_id: str,
    user: dict = Depends(
        INVENTORY_PUBLIC
    ),
):
    link = await _link_by_id(
        link_id
    )

    await db[COLLECTION].update_one(
        {"id": link_id},
        {
            "$set": {
                "enabled": True,
                "updated_at": now_iso(),
                "updated_by": user["id"],
            }
        },
    )

    await audit_log(
        "inventory_category",
        link_id,
        "inventory.public_category.enable",
        user,
        (
            "Enabled public Inventory QR for "
            f"category {link['category']}"
        ),
    )

    updated = await _link_by_id(
        link_id
    )

    return _management_payload(
        updated,
        await db.inventory_items.count_documents(
            {
                "category":
                    updated["category"]
            }
        ),
    )


@router.get(
    "/inventory-category-public-access/{link_id}/qr.png"
)
async def inventory_category_qr(
    link_id: str,
    download: bool = Query(False),
    user: dict = Depends(
        INVENTORY_PUBLIC
    ),
):
    link = await _link_by_id(
        link_id
    )

    png = _qr_png(
        _public_url(
            link["token_id"]
        )
    )

    disposition = (
        "attachment"
        if download
        else "inline"
    )

    name = _safe_filename(
        link["category"]
    )

    return Response(
        content=png,
        media_type="image/png",
        headers={
            **PUBLIC_HEADERS,
            "Content-Disposition": (
                f'{disposition}; filename="AMT-Inventory-{name}-QR.png"'
            ),
        },
    )


@router.get(
    "/inventory-category-public-access/{link_id}/qr-label.png"
)
async def inventory_category_qr_label(
    link_id: str,
    download: bool = Query(False),
    user: dict = Depends(
        INVENTORY_PUBLIC
    ),
):
    link = await _link_by_id(
        link_id
    )

    png = _qr_label_png(
        _public_url(
            link["token_id"]
        ),
        link["category"],
    )

    disposition = (
        "attachment"
        if download
        else "inline"
    )

    name = _safe_filename(
        link["category"]
    )

    return Response(
        content=png,
        media_type="image/png",
        headers={
            **PUBLIC_HEADERS,
            "Content-Disposition": (
                f'{disposition}; filename="AMT-Inventory-{name}-Cabinet-Label.png"'
            ),
        },
    )


@router.get(
    "/public/inventory-category/{token}"
)
async def public_inventory_category(
    token: str,
    request: Request,
    q: str = Query(
        "",
        max_length=100,
    ),
    type: str = Query(
        "",
        max_length=50,
    ),
    stock_status: str = Query(
        "",
        max_length=30,
    ),
    storage_location: str = Query(
        "",
        max_length=100,
    ),
    sort: str = Query(
        "item_code_asc",
        max_length=30,
    ),
):
    link = (
        await _require_public_token(
            token,
            request,
        )
    )

    items = await _rows(
        category=link["category"],
        q=q,
        type=type,
        stock_status=stock_status,
        storage_location=storage_location,
        sort=sort,
    )

    return Response(
        content=__import__(
            "json"
        ).dumps(
            {
                "read_only": True,
                "category": (
                    link["category"]
                ),
                "total": len(items),
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


@router.get(
    "/public/inventory-category/{token}/export.xlsx"
)
async def public_inventory_category_xlsx(
    token: str,
    request: Request,
    q: str = Query(
        "",
        max_length=100,
    ),
    type: str = Query(
        "",
        max_length=50,
    ),
    stock_status: str = Query(
        "",
        max_length=30,
    ),
    storage_location: str = Query(
        "",
        max_length=100,
    ),
    sort: str = Query(
        "item_code_asc",
        max_length=30,
    ),
):
    link = (
        await _require_public_token(
            token,
            request,
            export=True,
        )
    )

    filters = {
        "q": q,
        "type": type,
        "stock_status":
            stock_status,
        "storage_location":
            storage_location,
        "sort": sort,
    }

    (
        headers,
        rows,
    ) = await _export_rows(
        link["category"],
        **filters,
    )

    data = _xlsx_bytes(
        (
            "Inventory - "
            f"{link['category']}"
        ),
        headers,
        rows,
        await _timezone_name(),
        await get_pdf_brand_logo_bytes(),
    )

    name = _safe_filename(
        link["category"]
    )

    return Response(
        content=data,
        media_type=(
            "application/vnd.openxmlformats-"
            "officedocument.spreadsheetml.sheet"
        ),
        headers={
            **PUBLIC_HEADERS,
            "Content-Disposition": (
                f'attachment; filename="amt-inventory-{name}.xlsx"'
            ),
        },
    )


@router.get(
    "/public/inventory-category/{token}/export.pdf"
)
async def public_inventory_category_pdf(
    token: str,
    request: Request,
    q: str = Query(
        "",
        max_length=100,
    ),
    type: str = Query(
        "",
        max_length=50,
    ),
    stock_status: str = Query(
        "",
        max_length=30,
    ),
    storage_location: str = Query(
        "",
        max_length=100,
    ),
    sort: str = Query(
        "item_code_asc",
        max_length=30,
    ),
):
    link = (
        await _require_public_token(
            token,
            request,
            export=True,
        )
    )

    filters = {
        "q": q,
        "type": type,
        "stock_status":
            stock_status,
        "storage_location":
            storage_location,
        "sort": sort,
    }

    (
        headers,
        rows,
    ) = await _export_rows(
        link["category"],
        **filters,
    )

    data = _pdf_bytes(
        (
            "Inventory - "
            f"{link['category']}"
        ),
        headers,
        rows,
        await _timezone_name(),
        await get_pdf_brand_logo_bytes(),
    )

    name = _safe_filename(
        link["category"]
    )

    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            **PUBLIC_HEADERS,
            "Content-Disposition": (
                f'inline; filename="amt-inventory-{name}.pdf"'
            ),
        },
    )
