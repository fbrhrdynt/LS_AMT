import io
import json
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image as RLImage,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

BASE_DIR = Path(__file__).resolve().parent
VERSION_HISTORY_FILE = BASE_DIR / "version_history.json"
AMT_MARK_TAGLINE = BASE_DIR / "assets" / "amt-mark-tagline.png"

BLUE = colors.HexColor("#175EDB")
NAVY = colors.HexColor("#0F172A")
SLATE = colors.HexColor("#475569")
LIGHT = colors.HexColor("#F8FAFC")
BORDER = colors.HexColor("#CBD5E1")
WHITE = colors.white


def load_version_history() -> dict:
    return json.loads(
        VERSION_HISTORY_FILE.read_text(
            encoding="utf-8"
        )
    )


def _styles():
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        "AmtCoverTitle",
        parent=styles["Title"],
        fontSize=27,
        leading=32,
        textColor=NAVY,
        alignment=TA_CENTER,
        spaceAfter=10,
    ))
    styles.add(ParagraphStyle(
        "AmtCoverSub",
        parent=styles["Normal"],
        fontSize=11,
        leading=17,
        textColor=SLATE,
        alignment=TA_CENTER,
    ))
    styles.add(ParagraphStyle(
        "AmtH1",
        parent=styles["Heading1"],
        fontSize=18,
        leading=22,
        textColor=NAVY,
        spaceAfter=9,
    ))
    styles.add(ParagraphStyle(
        "AmtH2",
        parent=styles["Heading2"],
        fontSize=12,
        leading=15,
        textColor=BLUE,
        spaceBefore=7,
        spaceAfter=4,
    ))
    styles.add(ParagraphStyle(
        "AmtBody",
        parent=styles["BodyText"],
        fontSize=9.2,
        leading=13.5,
        textColor=NAVY,
        spaceAfter=5,
    ))
    styles.add(ParagraphStyle(
        "AmtSmall",
        parent=styles["BodyText"],
        fontSize=7.8,
        leading=10.5,
        textColor=SLATE,
    ))
    styles.add(ParagraphStyle(
        "AmtCallout",
        parent=styles["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=9.5,
        leading=13.5,
        textColor=NAVY,
        backColor=colors.HexColor("#EFF6FF"),
        borderColor=colors.HexColor("#BFDBFE"),
        borderWidth=0.7,
        borderPadding=8,
        spaceBefore=6,
        spaceAfter=9,
    ))
    return styles


def _safe(value):
    return escape(
        str(
            value
            if value not in (None, "")
            else "-"
        )
    )


def build_public_product_pdf(
    installed_version: str = "",
) -> bytes:
    data = load_version_history()
    versions = data.get("versions") or []
    product = data.get("product") or {}

    documented_latest = (
        versions[0].get("version")
        if versions
        else "-"
    )
    current = (
        installed_version
        or documented_latest
    )

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=(
            "AMT - Asset Maintenance Tracker "
            "- Public Product Overview"
        ),
        author="LogiSource Digital",
        subject=(
            "Public AMT product overview "
            "and version history"
        ),
    )
    ss = _styles()
    story = []

    def paragraph(text, style="AmtBody"):
        story.append(
            Paragraph(
                text,
                ss[style],
            )
        )

    def heading(text):
        story.append(
            Paragraph(
                text,
                ss["AmtH1"],
            )
        )

    def subheading(text):
        story.append(
            Paragraph(
                text,
                ss["AmtH2"],
            )
        )

    def bullet(text):
        story.append(
            Paragraph(
                "&#8226; " + _safe(text),
                ss["AmtBody"],
            )
        )

    story.append(Spacer(1, 23 * mm))

    if AMT_MARK_TAGLINE.exists():
        logo = RLImage(
            str(AMT_MARK_TAGLINE)
        )
        max_w = 70 * mm
        max_h = 28 * mm
        scale = min(
            max_w / logo.imageWidth,
            max_h / logo.imageHeight,
        )
        logo.drawWidth = (
            logo.imageWidth * scale
        )
        logo.drawHeight = (
            logo.imageHeight * scale
        )
        logo.hAlign = "CENTER"
        story.append(logo)

    story.append(Spacer(1, 14 * mm))
    paragraph(
        "Asset Maintenance Tracker",
        "AmtCoverTitle",
    )
    paragraph(
        (
            "Public Product Overview, "
            "Feature Guide and Version History"
        ),
        "AmtCoverSub",
    )
    story.append(Spacer(1, 7 * mm))
    paragraph(
        (
            "A self-hosted maintenance and "
            "asset-history platform for "
            "industrial operations."
        ),
        "AmtCallout",
    )
    story.append(Spacer(1, 23 * mm))
    paragraph(
        (
            f"<b>Installed version:</b> "
            f"{_safe(current)}<br/>"
            f"<b>Documented latest:</b> "
            f"{_safe(documented_latest)}<br/>"
            f"<b>Product:</b> "
            f"{_safe(product.get('name'))}<br/>"
            "<b>Developed by:</b> "
            "LogiSource Digital"
        ),
        "AmtCoverSub",
    )

    story.append(PageBreak())

    heading("1. What is AMT?")
    paragraph(
        (
            "<b>AMT (Asset Maintenance Tracker)</b> "
            "is a self-hosted web application for "
            "managing equipment records, maintenance "
            "history, parts and materials, jobs, "
            "clients, calibration information, "
            "documents, reports, and traceable asset "
            "history from one operational system."
        )
    )
    paragraph(
        (
            "AMT is designed for teams that need to "
            "know what happened to an asset, where it "
            "is, what maintenance was performed, which "
            "parts were used, which technician handled "
            "the work, and what supporting evidence is "
            "available."
        )
    )

    subheading("Primary business value")
    for item in (
        "Centralize equipment and maintenance information.",
        "Maintain traceable asset history over time.",
        "Improve maintenance planning and operational visibility.",
        "Support field access through secure QR equipment passports.",
        "Keep operational data self-hosted in managed infrastructure.",
    ):
        bullet(item)

    story.append(PageBreak())

    heading("2. Core Functions and Features")

    capabilities = [
        (
            "Equipment Registry",
            (
                "Asset/SAP, serial/manufacturing number, "
                "equipment name, category, manufacturer, "
                "condition, status, placement and history."
            ),
        ),
        (
            "Maintenance Management",
            (
                "Preventive, Corrective, Breakdown and "
                "Inspection records, findings, root cause, "
                "actions, technicians, parts and PDF reports."
            ),
        ),
        (
            "Inventory & Materials",
            (
                "Spare parts, materials, stock, minimum stock, "
                "transactions and maintenance-linked usage."
            ),
        ),
        (
            "Jobs & Clients",
            (
                "Client records, jobs, mobilization, "
                "demobilization, assignments and locations."
            ),
        ),
        (
            "Calibration",
            (
                "Calibration tools, dates, expiry tracking, "
                "certificates and equipment assignment."
            ),
        ),
        (
            "Documents",
            (
                "Maintenance-linked photos, inspection reports, "
                "certificates, evidence and supporting records."
            ),
        ),
        (
            "QR Equipment Passport",
            (
                "Secure token-based public equipment view, "
                "closed maintenance history, PDFs and approved "
                "documents."
            ),
        ),
        (
            "Reports & Exports",
            (
                "Operational reports, filters, PDF exports, "
                "Excel exports and maintenance reports."
            ),
        ),
        (
            "Audit & Roles",
            (
                "Traceable administrative actions and "
                "role-based access."
            ),
        ),
        (
            "Pro Application Branding",
            (
                "Eligible installations can use a company logo "
                "and restore the built-in AMT logo at any time."
            ),
        ),
    ]

    rows = [["Capability", "What it provides"]]
    for name, description in capabilities:
        rows.append([
            Paragraph(
                f"<b>{_safe(name)}</b>",
                ss["AmtSmall"],
            ),
            Paragraph(
                _safe(description),
                ss["AmtSmall"],
            ),
        ])

    table = Table(
        rows,
        colWidths=[
            48 * mm,
            116 * mm,
        ],
        repeatRows=1,
    )
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(table)

    story.append(PageBreak())

    heading("3. Public Equipment Passport")
    paragraph(
        (
            "AMT can issue a secure QR-based public "
            "equipment passport. The public link uses "
            "a high-entropy random token instead of "
            "predictable equipment identifiers. "
            "The public view is read-only."
        )
    )
    for item in (
        "Equipment identification and operational status.",
        "Current location information appropriate for public display.",
        "Closed maintenance history.",
        "Maintenance PDF reports.",
        "Approved documents from closed maintenance records.",
    ):
        bullet(item)

    subheading("Branding")
    paragraph(
        (
            "For eligible Pro branding, an organization "
            "can use its own company logo in customer-facing "
            "AMT views and generated maintenance PDFs. "
            "The original AMT logo remains built into the "
            "application and can be restored using "
            "<b>Reset to AMT Logo</b>."
        )
    )
    paragraph(
        (
            "Generated AMT PDFs retain the product credit: "
            "<b>Powered by AMT (Asset Maintenance Tracker) "
            "- LogiSource Digital</b>."
        )
    )

    subheading("Public-data boundary")
    paragraph(
        (
            "Private user accounts, credentials, license keys, "
            "database connection details, signing keys, private "
            "operational data and other sensitive configuration "
            "are intentionally excluded from this document."
        )
    )

    story.append(PageBreak())

    heading(
        "4. Version History - "
        f"1.0.0 to {_safe(documented_latest)}"
    )

    version_rows = [[
        "Version",
        "Status",
        "Release",
        "Summary",
    ]]

    for release in versions:
        version_rows.append([
            Paragraph(
                "<b>"
                + _safe(
                    release.get("version")
                )
                + "</b>",
                ss["AmtSmall"],
            ),
            Paragraph(
                _safe(
                    release.get("status")
                ),
                ss["AmtSmall"],
            ),
            Paragraph(
                "<b>"
                + _safe(
                    release.get("title")
                )
                + "</b>",
                ss["AmtSmall"],
            ),
            Paragraph(
                _safe(
                    release.get("summary")
                ),
                ss["AmtSmall"],
            ),
        ])

    table = Table(
        version_rows,
        colWidths=[
            18 * mm,
            22 * mm,
            45 * mm,
            79 * mm,
        ],
        repeatRows=1,
    )
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(table)

    story.append(PageBreak())

    heading("5. Version Details")

    for release in versions:
        status = _safe(
            release.get("status")
        ).upper()
        subheading(
            (
                f"{_safe(release.get('version'))} "
                f"- {_safe(release.get('title'))} "
                f"({status})"
            )
        )
        paragraph(
            _safe(
                release.get("summary")
            )
        )
        for item in (
            release.get("changes")
            or []
        ):
            bullet(item)

    story.append(PageBreak())

    heading(
        "6. Deployment Model "
        "and Product Positioning"
    )
    paragraph(
        (
            "AMT is designed as a self-hosted "
            "application. A typical deployment uses "
            "HTTPS through Nginx, a React frontend, "
            "a FastAPI backend, MongoDB for structured "
            "operational data, and private server-side "
            "file storage for uploaded documents."
        )
    )

    subheading("Why organizations use AMT")
    for item in (
        "One equipment history instead of fragmented maintenance records.",
        "Clear accountability for maintenance actions and technicians.",
        "Faster access to closed maintenance history using QR equipment passports.",
        "Better control of parts and materials linked to maintenance work.",
        "Public-facing equipment history without exposing private user accounts.",
        "Role-based administration and secure signed application updates.",
        "Optional company branding with retained AMT product identity.",
    ):
        bullet(item)

    paragraph(
        (
            "<b>AMT - Asset Maintenance Tracker</b><br/>"
            "Developed by LogiSource Digital<br/><br/>"
            "Public product document - no customer credentials, "
            "private keys, license keys, database connection "
            "information, or private operational records are included."
        ),
        "AmtCallout",
    )

    def footer(canvas, document):
        canvas.saveState()
        width, _height = A4

        canvas.setStrokeColor(BORDER)
        canvas.setLineWidth(0.5)
        canvas.line(
            18 * mm,
            12 * mm,
            width - 18 * mm,
            12 * mm,
        )

        canvas.setFont(
            "Helvetica",
            7,
        )
        canvas.setFillColor(SLATE)
        canvas.drawString(
            18 * mm,
            7.5 * mm,
            (
                "Powered by AMT "
                "(Asset Maintenance Tracker) "
                "- LogiSource Digital"
            ),
        )
        canvas.drawRightString(
            width - 18 * mm,
            7.5 * mm,
            f"Page {document.page}",
        )
        canvas.restoreState()

    doc.build(
        story,
        onFirstPage=footer,
        onLaterPages=footer,
    )
    buf.seek(0)
    return buf.read()
