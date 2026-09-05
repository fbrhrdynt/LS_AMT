import io
from pathlib import Path
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    Image as RLImage,
)

ACCENT = colors.HexColor("#2563EB")
DARK = colors.HexColor("#0F172A")
MUTED = colors.HexColor("#64748B")
LIGHT = colors.HexColor("#F1F5F9")
WARNING = colors.HexColor("#B45309")

ASSET_DIR = Path(__file__).resolve().parent / "assets"
AMT_MARK_TAGLINE = ASSET_DIR / "amt-mark-tagline.png"


def _styles():
    ss = getSampleStyleSheet()
    ss.add(ParagraphStyle(
        "Brand", parent=ss["Title"], fontSize=18,
        textColor=DARK, spaceAfter=2
    ))
    ss.add(ParagraphStyle(
        "Sub", parent=ss["Normal"], fontSize=8,
        textColor=MUTED, spaceAfter=10
    ))
    ss.add(ParagraphStyle(
        "H", parent=ss["Heading2"], fontSize=11,
        textColor=ACCENT, spaceBefore=10, spaceAfter=4
    ))
    ss.add(ParagraphStyle(
        "Body", parent=ss["Normal"], fontSize=9,
        textColor=DARK, leading=13
    ))
    ss.add(ParagraphStyle(
        "Small", parent=ss["Normal"], fontSize=7.5,
        textColor=DARK, leading=10
    ))
    ss.add(ParagraphStyle(
        "Warning", parent=ss["Normal"], fontSize=8,
        textColor=WARNING, leading=11, spaceBefore=4
    ))
    return ss


def _safe(value):
    return escape(str(value if value not in (None, "") else "-"))


def _paragraph(value, style):
    return Paragraph(_safe(value), style)


def _kv_table(pairs, ss):
    data = [
        [
            Paragraph(f"<b>{escape(str(k))}</b>", ss["Body"]),
            _paragraph(v, ss["Body"]),
        ]
        for k, v in pairs
    ]
    t = Table(data, colWidths=[55 * mm, 110 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (0, -1), LIGHT),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def _source_label(part):
    source = part.get("supply_source") or "Ex-Stock"
    if source == "Ex-Stock" and part.get("stock_override_applied"):
        return "Ex-Stock / OVERRIDE"
    return source


def _shows_cost(part):
    return (part.get("supply_source") or "Ex-Stock") in ("Purchase", "Warehouse")


def _location_label(equipment):
    current = str(equipment.get("current_location") or "").strip()
    if current:
        return current

    placement = str(equipment.get("placement") or "-").strip()
    detail = str(equipment.get("placement_detail") or "").strip()

    if not detail or detail.lower() == placement.lower():
        return placement

    return f"{placement} - {detail}"


def _equipment_status_label(value):
    if value in ("Operational", "Green Tag / Ready"):
        return "Green Tag / Ready"
    if value in ("Under Maintenance", "Yellow Tag / Under Maintenance", "Red Tag / Under Maintenance"):
        return "Yellow Tag / Under Maintenance"
    if value in ("Out of Service", "Red Tag / Out of Service"):
        return "Red Tag / Out of Service"
    return value


def _local_now(timezone_name):
    try:
        tz = ZoneInfo(timezone_name or "Asia/Jakarta")
    except Exception:
        tz = ZoneInfo("UTC")
    return datetime.now(timezone.utc).astimezone(tz)


def build_maintenance_pdf(
    mnt: dict,
    equipment: dict,
    currency: str = "USD",
    timezone_name: str = "Asia/Jakarta",
) -> bytes:
    def money(v):
        return f"{currency} {float(v or 0):,.2f}"

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        topMargin=18 * mm,
        bottomMargin=16 * mm,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
    )
    ss = _styles()
    el = []

    if AMT_MARK_TAGLINE.exists():
        # Compact brand mark: keep the report header visible without
        # consuming excessive vertical space on A4.
        logo_width = 44 * mm
        logo_height = logo_width * (835 / 1883)
        logo = RLImage(
            str(AMT_MARK_TAGLINE),
            width=logo_width,
            height=logo_height,
        )
        logo.hAlign = "CENTER"
        el.append(logo)
        el.append(Spacer(1, 1.5 * mm))
    else:
        # Safe fallback if the asset was not deployed.
        el.append(Paragraph(
            "AMT - Asset Maintenance Tracker",
            ss["Brand"]
        ))
        el.append(Paragraph(
            "Track Every Asset. Know Every Maintenance History.",
            ss["Sub"],
        ))
    el.append(Paragraph(
        f"Maintenance Report — {_safe(mnt.get('mnt_no', ''))}",
        ss["H"],
    ))

    el.append(Paragraph("Equipment", ss["H"]))
    el.append(_kv_table([
        ("Equipment Name", equipment.get("name")),
        ("Asset / SAP No.", equipment.get("sap_no")),
        ("Serial / Mfg No.", equipment.get("mfg_no")),
        ("Category", equipment.get("category")),
        ("Manufacturer", equipment.get("manufacturer")),
        (
            "Current Location",
            _location_label(equipment),
        ),
        ("Operational Status", _equipment_status_label(equipment.get("operational_status"))),
    ], ss))

    el.append(Paragraph("Maintenance Details", ss["H"]))
    duration = mnt.get("duration_days")
    duration_text = f"{duration} day(s)" if duration not in (None, "") else "-"
    el.append(_kv_table([
        ("Maintenance No.", mnt.get("mnt_no")),
        ("Status", mnt.get("status")),
        ("Maintenance Date", mnt.get("maintenance_date")),
        ("Date Closed", mnt.get("date_closed")),
        ("Type", mnt.get("type_of_maintenance")),
        ("Category", mnt.get("maintenance_category")),
        ("Duration", duration_text),
        ("Maintenance Purpose", mnt.get("maintenance_purpose")),
        ("Client", mnt.get("client_name")),
        ("Field Name", mnt.get("field_name")),
    ], ss))

    el.append(Paragraph("Findings & Actions", ss["H"]))
    el.append(_kv_table([
        ("Observed Symptoms", mnt.get("problem_damage")),
        ("Failure Found", mnt.get("failure_found")),
        ("Root Cause", mnt.get("root_cause")),
        ("Action Taken", mnt.get("action_taken")),
        ("Final Condition", mnt.get("final_condition")),
        ("Lead Technician", mnt.get("lead_technician")),
        (
            "Support Technicians",
            ", ".join(mnt.get("support_technicians") or []),
        ),
        ("Checked By", mnt.get("checked_by")),
        ("Remark", mnt.get("remark")),
    ], ss))

    parts = mnt.get("parts_consumed") or []
    if parts:
        el.append(Paragraph(
            "Spare Parts & Materials Used",
            ss["H"]
        ))

        data = [[
            "Item Code",
            "Item Name",
            "Source",
            "Qty",
            "Unit",
            "Recorded Value",
        ]]

        priced_parts = [p for p in parts if _shows_cost(p)]
        recorded_total = round(
            sum(float(p.get("cost") or 0) for p in priced_parts),
            2,
        )

        for p in parts:
            data.append([
                _paragraph(p.get("item_code", ""), ss["Small"]),
                _paragraph(p.get("item_name", ""), ss["Small"]),
                _paragraph(_source_label(p), ss["Small"]),
                _paragraph(p.get("qty", ""), ss["Small"]),
                _paragraph(p.get("unit", ""), ss["Small"]),
                (
                    _paragraph(money(p.get("cost")), ss["Small"])
                    if _shows_cost(p)
                    else _paragraph("", ss["Small"])
                ),
            ])

        if priced_parts:
            # Put the label in the first cell, then span columns 0..4.
            # Purchase and Warehouse values share the recorded-value column.
            data.append([
                Paragraph("<b>RECORDED VALUE TOTAL</b>", ss["Small"]),
                "",
                "",
                "",
                "",
                _paragraph(money(recorded_total), ss["Small"]),
            ])

        t = Table(
            data,
            colWidths=[
                24 * mm,
                56 * mm,
                30 * mm,
                13 * mm,
                13 * mm,
                29 * mm,
            ],
            repeatRows=1,
        )

        table_style = [
            ("BACKGROUND", (0, 0), (-1, 0), DARK),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 7.5),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
            ("ALIGN", (3, 1), (3, -1), "RIGHT"),
            ("ALIGN", (5, 1), (5, -1), "RIGHT"),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]

        if priced_parts:
            table_style.extend([
                ("SPAN", (0, -1), (4, -1)),
                ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#EFF6FF")),
                ("ALIGN", (0, -1), (4, -1), "RIGHT"),
                ("VALIGN", (0, -1), (-1, -1), "MIDDLE"),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                ("TOPPADDING", (0, -1), (-1, -1), 5),
                ("BOTTOMPADDING", (0, -1), (-1, -1), 5),
            ])

        t.setStyle(TableStyle(table_style))
        el.append(t)

        if any(not _shows_cost(p) for p in parts):
            el.append(Paragraph(
                "<b>Ex-Stock:</b> inventory-issued item pricing is intentionally "
                "not displayed in this maintenance report.",
                ss["Sub"],
            ))

        overrides = [
            p for p in parts
            if p.get("stock_override_applied")
        ]
        for p in overrides:
            before = p.get("stock_before")
            after = p.get("stock_after")
            el.append(Paragraph(
                (
                    "<b>STOCK OVERRIDE:</b> "
                    f"{_safe(p.get('item_code'))} — "
                    f"{_safe(p.get('item_name'))}; "
                    f"used {_safe(p.get('qty'))} {_safe(p.get('unit'))}, "
                    f"recorded stock before {_safe(before)}, "
                    f"balance after {_safe(after)}."
                ),
                ss["Warning"],
            ))

        if any((p.get("supply_source") or "Ex-Stock") == "Purchase"
               for p in parts):
            el.append(Paragraph(
                "<b>Purchase:</b> direct purchase/use; inventory stock was "
                "not reduced and the recorded value is displayed.",
                ss["Sub"],
            ))

        if any((p.get("supply_source") or "Ex-Stock") == "Warehouse"
               for p in parts):
            el.append(Paragraph(
                "<b>Warehouse:</b> direct warehouse use; inventory stock "
                "was not reduced and the recorded value is displayed.",
                ss["Sub"],
            ))

    el.append(Spacer(1, 14))
    generated = _local_now(timezone_name)
    el.append(Paragraph(
        (
            f"Generated on {generated.strftime('%Y-%m-%d %H:%M %Z')} - "
            "AMT (Asset Maintenance Tracker) by LogiSource Digital"
        ),
        ss["Sub"],
    ))

    doc.build(el)
    buf.seek(0)
    return buf.read()
