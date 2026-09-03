import io
import re
from pathlib import Path

import qrcode
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from PIL import Image, ImageDraw, ImageFont

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


# ---------------------------------------------------------------------------
# QR / sticker helpers
# ---------------------------------------------------------------------------

def _safe_filename(value: str) -> str:
    text = re.sub(
        r"[^A-Za-z0-9._-]+",
        "-",
        str(value or "equipment"),
    ).strip("-")
    return text or "equipment"


def _qr_image(url: str) -> Image.Image:
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
    return image.convert("RGB")


def _qr_png(url: str) -> bytes:
    image = _qr_image(url)
    buf = io.BytesIO()
    image.save(buf, format="PNG", dpi=(300, 300))
    buf.seek(0)
    return buf.read()


def _font_candidates(bold: bool = False):
    filename = (
        "DejaVuSans-Bold.ttf"
        if bold
        else "DejaVuSans.ttf"
    )
    return [
        Path("/usr/share/fonts/truetype/dejavu") / filename,
        Path("/usr/share/fonts/dejavu") / filename,
        Path("/usr/local/share/fonts") / filename,
    ]


def _font(size: int, bold: bool = False):
    for path in _font_candidates(bold):
        if path.exists():
            return ImageFont.truetype(str(path), size=size)

    # Pillow ships DejaVu on many installs and can resolve it by name.
    try:
        return ImageFont.truetype(
            "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf",
            size=size,
        )
    except Exception:
        return ImageFont.load_default()


def _text_width(draw: ImageDraw.ImageDraw, text: str, font) -> int:
    box = draw.textbbox((0, 0), text, font=font)
    return max(0, box[2] - box[0])


def _wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font,
    max_width: int,
):
    """
    Wrap by words, but also split an unusually long single token so no text
    can escape the sticker boundary.
    """
    words = str(text or "").strip().split()
    if not words:
        return ["-"]

    lines = []
    current = ""

    for word in words:
        candidate = f"{current} {word}".strip()
        if _text_width(draw, candidate, font) <= max_width:
            current = candidate
            continue

        if current:
            lines.append(current)
            current = ""

        if _text_width(draw, word, font) <= max_width:
            current = word
            continue

        chunk = ""
        for char in word:
            candidate = chunk + char
            if chunk and _text_width(draw, candidate, font) > max_width:
                lines.append(chunk)
                chunk = char
            else:
                chunk = candidate
        current = chunk

    if current:
        lines.append(current)

    return lines


def _fit_wrapped_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    max_width: int,
    max_lines: int = 3,
    start_size: int = 56,
    min_size: int = 30,
):
    """
    Find the largest bold font that keeps the equipment name inside max_lines.
    """
    for size in range(start_size, min_size - 1, -2):
        font = _font(size, bold=True)
        lines = _wrap_text(draw, text, font, max_width)
        if len(lines) <= max_lines:
            return font, lines

    font = _font(min_size, bold=True)
    lines = _wrap_text(draw, text, font, max_width)

    if len(lines) > max_lines:
        lines = lines[:max_lines]
        last = lines[-1]
        while last and _text_width(draw, last + "…", font) > max_width:
            last = last[:-1]
        lines[-1] = (last.rstrip() + "…") if last else "…"

    return font, lines


def _centered_text(
    draw: ImageDraw.ImageDraw,
    canvas_width: int,
    y: int,
    text: str,
    font,
    fill="black",
):
    box = draw.textbbox((0, 0), text, font=font)
    width = box[2] - box[0]
    draw.text(
        ((canvas_width - width) // 2, y),
        text,
        fill=fill,
        font=font,
    )
    return box[3] - box[1]


def _qr_sticker_png(
    url: str,
    equipment_name: str,
    sap_no: str,
) -> bytes:
    """
    Create a print-ready portrait sticker.

    1000 x 1350 px at 300 DPI ~= 84.7 x 114.3 mm.
    This is large enough for printing and can be scaled down by the printer
    without losing QR readability.
    """
    width = 1000
    height = 1350
    margin = 55
    border_width = 7

    canvas = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(canvas)

    # Outer sticker border.
    draw.rounded_rectangle(
        (
            border_width // 2,
            border_width // 2,
            width - border_width // 2 - 1,
            height - border_width // 2 - 1,
        ),
        radius=28,
        outline="black",
        width=border_width,
        fill="white",
    )

    title_font = _font(48, bold=True)
    small_font = _font(28, bold=False)
    sap_label_font = _font(34, bold=True)
    sap_value_font = _font(58, bold=True)

    y = 65

    # Header requested by user.
    header_h = _centered_text(
        draw,
        width,
        y,
        "QR Code Maintenance History",
        title_font,
    )
    y += header_h + 35

    # QR with generous white quiet area.
    qr = _qr_image(url)
    qr_size = 720
    qr = qr.resize(
        (qr_size, qr_size),
        Image.Resampling.NEAREST,
    )
    qr_x = (width - qr_size) // 2
    canvas.paste(qr, (qr_x, y))
    y += qr_size + 34

    # Divider.
    draw.line(
        (margin + 20, y, width - margin - 20, y),
        fill="#D1D5DB",
        width=3,
    )
    y += 30

    # Equipment name, centered and safely wrapped.
    equipment_name = (
        str(equipment_name or "").strip()
        or "Equipment"
    )
    name_font, name_lines = _fit_wrapped_text(
        draw,
        equipment_name,
        max_width=width - (margin * 2),
        max_lines=3,
        start_size=56,
        min_size=32,
    )

    name_line_height = max(
        42,
        draw.textbbox(
            (0, 0),
            "Ag",
            font=name_font,
        )[3],
    )

    for line in name_lines:
        _centered_text(
            draw,
            width,
            y,
            line,
            name_font,
        )
        y += name_line_height + 7

    y += 18

    # SAP label + number.
    _centered_text(
        draw,
        width,
        y,
        "SAP No.",
        sap_label_font,
        fill="#4B5563",
    )
    y += 48

    sap_text = str(sap_no or "-").strip() or "-"
    _centered_text(
        draw,
        width,
        y,
        sap_text,
        sap_value_font,
    )

    # Tiny footer for context. It is intentionally unobtrusive.
    footer = "Scan to view equipment maintenance history"
    footer_y = height - 62
    _centered_text(
        draw,
        width,
        footer_y,
        footer,
        small_font,
        fill="#6B7280",
    )

    buf = io.BytesIO()
    canvas.save(
        buf,
        format="PNG",
        dpi=(300, 300),
        optimize=True,
    )
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
        {
            "_id": 0,
            "id": 1,
            "sap_no": 1,
            "name": 1,
            "category": 1,
        },
    )
    if not eq:
        raise HTTPException(
            status_code=404,
            detail="Equipment not found",
        )

    try:
        token = await ensure_equipment_public_token(eid)
    except LookupError:
        raise HTTPException(
            status_code=404,
            detail="Equipment not found",
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        )

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
    """
    Raw QR PNG. Kept for API/preview compatibility.
    """
    eq = await db.equipment.find_one(
        {"id": eid},
        {"_id": 0, "sap_no": 1},
    )
    if not eq:
        raise HTTPException(
            status_code=404,
            detail="Equipment not found",
        )

    try:
        token = await ensure_equipment_public_token(eid)
    except LookupError:
        raise HTTPException(
            status_code=404,
            detail="Equipment not found",
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        )

    png = _qr_png(public_equipment_url(token))
    filename = (
        f"AMT-{_safe_filename(eq.get('sap_no'))}-QR.png"
    )
    disposition = "attachment" if download else "inline"

    return Response(
        content=png,
        media_type="image/png",
        headers={
            "Content-Disposition": (
                f'{disposition}; filename="{filename}"'
            ),
            "Cache-Control": "no-store, max-age=0",
        },
    )


@router.get("/equipment/{eid}/qr-label.png")
async def equipment_qr_label_png(
    eid: str,
    download: bool = Query(False),
    user: dict = Depends(get_current_user),
):
    """
    Print-ready QR sticker template:

        QR Code Maintenance History
        [ QR ]
        [ Equipment Name ]
        SAP No.
        [ SAP NUMBER ]
    """
    eq = await db.equipment.find_one(
        {"id": eid},
        {
            "_id": 0,
            "sap_no": 1,
            "name": 1,
            "category": 1,
        },
    )
    if not eq:
        raise HTTPException(
            status_code=404,
            detail="Equipment not found",
        )

    try:
        token = await ensure_equipment_public_token(eid)
    except LookupError:
        raise HTTPException(
            status_code=404,
            detail="Equipment not found",
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        )

    label = _qr_sticker_png(
        public_equipment_url(token),
        eq.get("name") or eq.get("category") or eq.get("sap_no"),
        eq.get("sap_no"),
    )

    filename = (
        f"AMT-{_safe_filename(eq.get('sap_no'))}-QR-STICKER.png"
    )
    disposition = "attachment" if download else "inline"

    return Response(
        content=label,
        media_type="image/png",
        headers={
            "Content-Disposition": (
                f'{disposition}; filename="{filename}"'
            ),
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
        raise HTTPException(
            status_code=404,
            detail="Equipment not found",
        )

    try:
        token = await reset_equipment_public_token(eid)
    except LookupError:
        raise HTTPException(
            status_code=404,
            detail="Equipment not found",
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        )

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
        raise HTTPException(
            status_code=404,
            detail="Equipment not found",
        )

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
            "X-Robots-Tag": (
                "noindex, nofollow, noarchive"
            ),
        },
    )


@router.get(
    "/public/equipment/{token}/maintenance/{mid}/report.pdf"
)
async def public_maintenance_pdf(
    token: str,
    mid: str,
):
    eq = await _equipment_by_public_token(token)
    if not eq:
        raise HTTPException(
            status_code=404,
            detail="Equipment not found",
        )

    maintenance = await db.maintenance.find_one(
        {
            "id": mid,
            "equipment_id": eq["id"],
            "status": "Closed",
        },
        {"_id": 0},
    )
    if not maintenance:
        raise HTTPException(
            status_code=404,
            detail="Maintenance report not found",
        )

    settings = (
        await db.settings.find_one({"_id": "app"})
        or {}
    )
    currency = settings.get("currency", "USD")
    pdf = build_maintenance_pdf(
        maintenance,
        eq,
        currency,
    )

    filename = _safe_filename(
        maintenance.get("mnt_no") or "maintenance"
    )
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'inline; filename="{filename}.pdf"'
            ),
            "Cache-Control": "no-store, max-age=0",
            "X-Robots-Tag": (
                "noindex, nofollow, noarchive"
            ),
        },
    )
