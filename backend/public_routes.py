import io
import re

import qrcode
from fastapi import APIRouter, Depends, HTTPException, Query, Response

from auth import get_current_user, require_roles
from core import audit_log, db
from pdf_report import build_maintenance_pdf
from public_access import (
    ensure_equipment_public_token,
    public_equipment_url,
    reset_equipment_public_token,
)


router = APIRouter(prefix="/api")
MANAGE = require_roles("admin", "supervisor")


PUBLIC_EQUIPMENT_FIELDS = {
    "_id": 0,
    "name": 1,
    "sap_no": 1,
    "mfg_no": 1,
    "category": 1,
    "manufacturer": 1,
    "date_of_purchase": 1,
    "physical_condition": 1,
    "placement": 1,
    "placement_detail": 1,
    "operational_status": 1,
}

PUBLIC_MAINTENANCE_FIELDS = {
    "_id": 0,
    "id": 1,
    "mnt_no": 1,
    "maintenance_date": 1,
    "date_closed": 1,
    "type_of_maintenance": 1,
    "maintenance_category": 1,
    "problem_damage": 1,
    "final_condition": 1,
    "status": 1,
}


def _safe_filename(value: str) -> str:
    text = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value or "equipment")).strip("-")
    return text or "equipment"


def _qr_png(url: str) -> bytes:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )
    qr.add_data(url)
    qr.make(fit=True)
    image = qr.make_image(fill_color="black", back_color="white")

    buf = io.BytesIO()
    image.save(buf, format="PNG")
    buf.seek(0)
    return buf.read()


async def _equipment_by_public_token(token: str):
    if not token or len(token) < 20 or len(token) > 200:
        return None
    return await db.equipment.find_one(
        {"public_token": token},
        {"_id": 0},
    )


# ---------------------------------------------------------------------------
# Authenticated QR / public-link management
# ---------------------------------------------------------------------------

@router.get("/equipment/{eid}/public-link")
async def equipment_public_link(
    eid: str,
    user: dict = Depends(get_current_user),
):
    eq = await db.equipment.find_one(
        {"id": eid},
        {"_id": 0, "id": 1, "sap_no": 1, "name": 1},
    )
    if not eq:
        raise HTTPException(status_code=404, detail="Equipment not found")

    try:
        token = await ensure_equipment_public_token(eid)
    except LookupError:
        raise HTTPException(status_code=404, detail="Equipment not found")
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {
        "equipment_id": eid,
        "sap_no": eq.get("sap_no"),
        "name": eq.get("name"),
        "public_url": public_equipment_url(token),
    }


@router.get("/equipment/{eid}/qr.png")
async def equipment_qr_png(
    eid: str,
    download: bool = Query(False),
    user: dict = Depends(get_current_user),
):
    eq = await db.equipment.find_one(
        {"id": eid},
        {"_id": 0, "sap_no": 1},
    )
    if not eq:
        raise HTTPException(status_code=404, detail="Equipment not found")

    try:
        token = await ensure_equipment_public_token(eid)
    except LookupError:
        raise HTTPException(status_code=404, detail="Equipment not found")
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    png = _qr_png(public_equipment_url(token))
    filename = f"AMT-{_safe_filename(eq.get('sap_no'))}-QR.png"
    disposition = "attachment" if download else "inline"

    return Response(
        content=png,
        media_type="image/png",
        headers={
            "Content-Disposition": f'{disposition}; filename="{filename}"',
            "Cache-Control": "no-store, max-age=0",
        },
    )


@router.post("/equipment/{eid}/public-link/reset")
async def reset_public_link(
    eid: str,
    user: dict = Depends(MANAGE),
):
    eq = await db.equipment.find_one(
        {"id": eid},
        {"_id": 0, "sap_no": 1},
    )
    if not eq:
        raise HTTPException(status_code=404, detail="Equipment not found")

    try:
        token = await reset_equipment_public_token(eid)
    except LookupError:
        raise HTTPException(status_code=404, detail="Equipment not found")
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    await audit_log(
        "equipment",
        eid,
        "equipment.public_link.reset",
        user,
        f"Reset public QR link for {eq.get('sap_no') or eid}",
    )

    return {
        "ok": True,
        "public_url": public_equipment_url(token),
    }


# ---------------------------------------------------------------------------
# Public, view-only Equipment Passport
# ---------------------------------------------------------------------------

@router.get("/public/equipment/{token}")
async def public_equipment(token: str):
    eq = await _equipment_by_public_token(token)
    if not eq:
        # Use the same 404 response for invalid/revoked/unknown tokens.
        raise HTTPException(status_code=404, detail="Equipment not found")

    public_eq = {
        key: eq.get(key)
        for key in PUBLIC_EQUIPMENT_FIELDS
        if key != "_id"
    }

    maintenance = await db.maintenance.find(
        {
            "equipment_id": eq["id"],
            "status": "Closed",
        },
        PUBLIC_MAINTENANCE_FIELDS,
    ).sort("maintenance_date", -1).to_list(1000)

    return Response(
        content=__import__("json").dumps(
            {
                "equipment": public_eq,
                "maintenance": maintenance,
                "maintenance_count": len(maintenance),
            },
            default=str,
        ),
        media_type="application/json",
        headers={
            "Cache-Control": "no-store, max-age=0",
            "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
    )


@router.get("/public/equipment/{token}/maintenance/{mid}/report.pdf")
async def public_maintenance_pdf(token: str, mid: str):
    eq = await _equipment_by_public_token(token)
    if not eq:
        raise HTTPException(status_code=404, detail="Equipment not found")

    maintenance = await db.maintenance.find_one(
        {
            "id": mid,
            "equipment_id": eq["id"],
            "status": "Closed",
        },
        {"_id": 0},
    )
    if not maintenance:
        raise HTTPException(status_code=404, detail="Maintenance report not found")

    settings = await db.settings.find_one({"_id": "app"}) or {}
    currency = settings.get("currency", "USD")
    pdf = build_maintenance_pdf(maintenance, eq, currency)

    filename = _safe_filename(maintenance.get("mnt_no") or "maintenance")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}.pdf"',
            "Cache-Control": "no-store, max-age=0",
            "X-Robots-Tag": "noindex, nofollow, noarchive",
        },
    )
