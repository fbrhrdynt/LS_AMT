import io
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle)

ACCENT = colors.HexColor("#2563EB")
DARK = colors.HexColor("#0F172A")
MUTED = colors.HexColor("#64748B")
LIGHT = colors.HexColor("#F1F5F9")


def _styles():
    ss = getSampleStyleSheet()
    ss.add(ParagraphStyle("Brand", parent=ss["Title"], fontSize=18, textColor=DARK, spaceAfter=2))
    ss.add(ParagraphStyle("Sub", parent=ss["Normal"], fontSize=8, textColor=MUTED, spaceAfter=10))
    ss.add(ParagraphStyle("H", parent=ss["Heading2"], fontSize=11, textColor=ACCENT, spaceBefore=10, spaceAfter=4))
    ss.add(ParagraphStyle("Body", parent=ss["Normal"], fontSize=9, textColor=DARK, leading=13))
    return ss


def _kv_table(pairs, ss):
    data = [[Paragraph(f"<b>{k}</b>", ss["Body"]), Paragraph(str(v or "-"), ss["Body"])] for k, v in pairs]
    t = Table(data, colWidths=[55 * mm, 110 * mm])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (0, -1), LIGHT),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return t


def build_maintenance_pdf(mnt: dict, equipment: dict, currency: str = "USD") -> bytes:
    def money(v):
        return f"{currency} {float(v or 0):,.2f}"
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=18 * mm, bottomMargin=16 * mm,
                            leftMargin=18 * mm, rightMargin=18 * mm)
    ss = _styles()
    el = []
    el.append(Paragraph("AMT — Asset Maintenance Tracker", ss["Brand"]))
    el.append(Paragraph("Track Every Asset. Know Every Maintenance History.  |  A LogiSource Digital product", ss["Sub"]))
    el.append(Paragraph(f"Maintenance Report — {mnt.get('mnt_no','')}", ss["H"]))

    el.append(Paragraph("Equipment", ss["H"]))
    el.append(_kv_table([
        ("Equipment Name", equipment.get("name")),
        ("Asset / SAP No.", equipment.get("sap_no")),
        ("Serial / Mfg No.", equipment.get("mfg_no")),
        ("Category", equipment.get("category")),
        ("Manufacturer", equipment.get("manufacturer")),
        ("Current Location", f"{equipment.get('placement')} — {equipment.get('placement_detail') or ''}"),
        ("Operational Status", equipment.get("operational_status")),
    ], ss))

    el.append(Paragraph("Maintenance Details", ss["H"]))
    el.append(_kv_table([
        ("Maintenance No.", mnt.get("mnt_no")),
        ("Status", mnt.get("status")),
        ("Maintenance Date", mnt.get("maintenance_date")),
        ("Date Closed", mnt.get("date_closed")),
        ("Type", mnt.get("type_of_maintenance")),
        ("Category", mnt.get("maintenance_category")),
        ("Duration (days)", mnt.get("duration_days")),
        ("Client", mnt.get("client_name")),
        ("Job", mnt.get("job_number")),
    ], ss))

    el.append(Paragraph("Findings & Actions", ss["H"]))
    el.append(_kv_table([
        ("Problem / Damage", mnt.get("problem_damage")),
        ("Failure Found", mnt.get("failure_found")),
        ("Root Cause", mnt.get("root_cause")),
        ("Action Taken", mnt.get("action_taken")),
        ("Final Condition", mnt.get("final_condition")),
        ("Lead Technician", mnt.get("lead_technician")),
        ("Support Technicians", ", ".join(mnt.get("support_technicians") or [])),
        ("Checked By", mnt.get("checked_by")),
        ("Remark", mnt.get("remark")),
    ], ss))

    parts = mnt.get("parts_consumed") or []
    if parts:
        el.append(Paragraph("Spare Parts & Consumables Used", ss["H"]))
        data = [["Item Code", "Item Name", "Type", "Qty", "Unit", "Line Cost"]]
        for p in parts:
            data.append([p.get("item_code", ""), p.get("item_name", ""), p.get("type", ""),
                         str(p.get("qty", "")), p.get("unit", ""),
                         money(p.get('cost'))])
        data.append(["", "", "", "", "TOTAL", money(mnt.get('total_cost'))])
        t = Table(data, colWidths=[26 * mm, 58 * mm, 26 * mm, 15 * mm, 15 * mm, 25 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), DARK),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, LIGHT]),
            ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#EFF6FF")),
            ("FONTNAME", (4, -1), (-1, -1), "Helvetica-Bold"),
            ("ALIGN", (5, 0), (5, -1), "RIGHT"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5), ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        el.append(t)

    el.append(Spacer(1, 14))
    el.append(Paragraph(
        f"Generated on {datetime.now().strftime('%Y-%m-%d %H:%M')} — AMT (Asset Maintenance Tracker) by LogiSource Digital",
        ss["Sub"]))
    doc.build(el)
    buf.seek(0)
    return buf.read()
