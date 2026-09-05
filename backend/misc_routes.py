import csv
import io
import re

from fastapi import APIRouter, Depends, UploadFile, File, Response, Query, HTTPException
from pydantic import BaseModel, Field
import openpyxl

from core import db, audit_log
from auth import get_current_user, require_roles
from importer import parse_workbook, _insert_equipment, _insert_maintenance
from storage import IMPORT_MAX_SIZE, read_upload_limited, validate_workbook_archive

router = APIRouter(prefix="/api")
MANAGE = require_roles("admin", "supervisor")

NO_STORE_HEADERS = {
    "Cache-Control": "no-store, max-age=0",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
}


class SettingsBody(BaseModel):
    currency: str = Field(min_length=3, max_length=3)


@router.get("/settings")
async def get_settings(user: dict = Depends(get_current_user)):
    settings = await db.settings.find_one({"_id": "app"}, {"_id": 0}) or {}
    settings.setdefault("currency", "USD")
    settings.setdefault("timezone", "Asia/Jakarta")
    return settings


@router.put("/settings")
async def update_settings(
    body: SettingsBody,
    user: dict = Depends(require_roles("admin")),
):
    currency = body.currency.strip().upper()
    if not re.fullmatch(r"[A-Z]{3}", currency):
        raise HTTPException(status_code=400, detail="Invalid 3-letter currency code")

    await db.settings.update_one(
        {"_id": "app"},
        {"$set": {"currency": currency}},
        upsert=True,
    )
    await audit_log(
        "settings", "app", "settings.update", user,
        f"Currency set to {currency}",
    )
    return {"currency": currency}


@router.get("/audit")
async def list_audit(
    entity_type: str = "",
    entity_id: str = "",
    limit: int = 200,
    user: dict = Depends(MANAGE),
):
    query = {}
    if entity_type:
        query["entity_type"] = entity_type
    if entity_id:
        query["entity_id"] = entity_id
    safe_limit = min(max(1, limit), 1000)
    return await db.audit_logs.find(
        query, {"_id": 0}
    ).sort("timestamp", -1).limit(safe_limit).to_list(safe_limit)


@router.get("/reports/maintenance")
async def report_maintenance(
    equipment_id: str = "",
    sap_no: str = "",
    serial_no: str = "",
    date_from: str = "",
    date_to: str = "",
    type: str = "",
    technician: str = "",
    failure: str = "",
    client_id: str = "",
    job_id: str = "",
    status: str = "",
    user: dict = Depends(get_current_user),
):
    query = {}
    if equipment_id:
        query["equipment_id"] = equipment_id
    if sap_no:
        query["sap_no"] = {"$regex": re.escape(sap_no), "$options": "i"}
    if type:
        query["type_of_maintenance"] = {"$regex": re.escape(type), "$options": "i"}
    if technician:
        escaped = re.escape(technician)
        query["$or"] = [
            {"lead_technician": {"$regex": escaped, "$options": "i"}},
            {"support_technicians": {"$regex": escaped, "$options": "i"}},
        ]
    if failure:
        query["failure_found"] = {"$regex": re.escape(failure), "$options": "i"}
    if client_id:
        query["client_id"] = client_id
    if job_id:
        query["job_id"] = job_id
    if status:
        query["status"] = status
    if date_from or date_to:
        date_query = {}
        if date_from:
            date_query["$gte"] = date_from
        if date_to:
            date_query["$lte"] = date_to
        query["maintenance_date"] = date_query

    rows = await db.maintenance.find(
        query, {"_id": 0}
    ).sort("maintenance_date", -1).to_list(5000)

    if serial_no:
        eqs = await db.equipment.find(
            {"mfg_no": {"$regex": re.escape(serial_no), "$options": "i"}},
            {"_id": 0, "id": 1},
        ).to_list(2000)
        ids = {item["id"] for item in eqs}
        rows = [row for row in rows if row.get("equipment_id") in ids]

    return {"total": len(rows), "items": rows}


REPORT_COLS = [
    ("mnt_no", "Maintenance No"),
    ("maintenance_date", "Date"),
    ("sap_no", "Asset/SAP No"),
    ("equipment_name", "Equipment"),
    ("type_of_maintenance", "Type"),
    ("maintenance_category", "Category"),
    ("maintenance_purpose", "Maintenance Purpose"),
    ("problem_damage", "Problem/Damage"),
    ("failure_found", "Failure Found"),
    ("root_cause", "Root Cause"),
    ("action_taken", "Action Taken"),
    ("lead_technician", "Lead Technician"),
    ("checked_by", "Checked By"),
    ("duration_days", "Duration (days)"),
    ("client_name", "Client"),
    ("job_number", "Job ID"),
    ("final_condition", "Final Condition"),
    ("status", "Status"),
]


def _spreadsheet_safe(value):
    if value is None:
        return ""
    text = str(value)
    if text.startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + text
    return text


async def _report_for_export(
    user,
    equipment_id="",
    sap_no="",
    serial_no="",
    status="",
    date_from="",
    date_to="",
    type="",
    technician="",
    failure="",
    client_id="",
    job_id="",
):
    return await report_maintenance(
        equipment_id=equipment_id,
        sap_no=sap_no,
        serial_no=serial_no,
        status=status,
        date_from=date_from,
        date_to=date_to,
        type=type,
        technician=technician,
        failure=failure,
        client_id=client_id,
        job_id=job_id,
        user=user,
    )


@router.get("/reports/maintenance/export.csv")
async def export_csv(
    equipment_id: str = "",
    sap_no: str = "",
    serial_no: str = "",
    status: str = "",
    date_from: str = "",
    date_to: str = "",
    type: str = "",
    technician: str = "",
    failure: str = "",
    client_id: str = "",
    job_id: str = "",
    user: dict = Depends(get_current_user),
):
    result = await _report_for_export(
        user,
        equipment_id,
        sap_no,
        serial_no,
        status,
        date_from,
        date_to,
        type,
        technician,
        failure,
        client_id,
        job_id,
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([header for _, header in REPORT_COLS])
    for row in result["items"]:
        writer.writerow([_spreadsheet_safe(row.get(key, "")) for key, _ in REPORT_COLS])

    headers = {
        **NO_STORE_HEADERS,
        "Content-Disposition": 'attachment; filename="maintenance_report.csv"',
    }
    return Response(content=buf.getvalue(), media_type="text/csv", headers=headers)


@router.get("/reports/maintenance/export.xlsx")
async def export_xlsx(
    equipment_id: str = "",
    sap_no: str = "",
    serial_no: str = "",
    status: str = "",
    date_from: str = "",
    date_to: str = "",
    type: str = "",
    technician: str = "",
    failure: str = "",
    client_id: str = "",
    job_id: str = "",
    user: dict = Depends(get_current_user),
):
    result = await _report_for_export(
        user,
        equipment_id,
        sap_no,
        serial_no,
        status,
        date_from,
        date_to,
        type,
        technician,
        failure,
        client_id,
        job_id,
    )

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Maintenance"
    ws.append([header for _, header in REPORT_COLS])
    for row in result["items"]:
        ws.append([_spreadsheet_safe(row.get(key, "")) for key, _ in REPORT_COLS])

    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    headers = {
        **NO_STORE_HEADERS,
        "Content-Disposition": 'attachment; filename="maintenance_report.xlsx"',
    }
    return Response(
        content=out.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


async def _read_workbook(file: UploadFile) -> bytes:
    filename = (file.filename or "").lower()
    if not filename.endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Only .xlsx workbooks are accepted")

    try:
        data = await read_upload_limited(file, IMPORT_MAX_SIZE)
        validate_workbook_archive(data)
        return data
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/import/analyze")
async def import_analyze(
    file: UploadFile = File(...),
    user: dict = Depends(MANAGE),
):
    data = await _read_workbook(file)
    try:
        equipment_rows, maintenance_rows = parse_workbook(io.BytesIO(data))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse file: {exc}")

    existing_saps = set(await db.equipment.distinct("sap_no"))
    new_eq = [row for row in equipment_rows if row["sap_no"] not in existing_saps]
    dup_eq = [row for row in equipment_rows if row["sap_no"] in existing_saps]

    dup_mnt, new_mnt = [], []
    for row in maintenance_rows:
        exists = await db.maintenance.find_one(
            {
                "sap_no": row["sap_no"],
                "maintenance_date": row.get("maintenance_date"),
                "problem_damage": row.get("problem_damage"),
            }
        )
        (dup_mnt if exists else new_mnt).append(row)

    return {
        "equipment": {
            "total": len(equipment_rows),
            "new": len(new_eq),
            "duplicates": len(dup_eq),
            "sample": equipment_rows[:8],
        },
        "maintenance": {
            "total": len(maintenance_rows),
            "new": len(new_mnt),
            "duplicates": len(dup_mnt),
            "sample": maintenance_rows[:8],
        },
    }


@router.post("/import/execute")
async def import_execute(
    file: UploadFile = File(...),
    skip_duplicates: bool = Query(True),
    user: dict = Depends(MANAGE),
):
    data = await _read_workbook(file)
    try:
        equipment_rows, maintenance_rows = parse_workbook(io.BytesIO(data))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse file: {exc}")

    equipment_map = {}
    existing = await db.equipment.find({}, {"_id": 0}).to_list(100000)
    for equipment in existing:
        if equipment.get("sap_no"):
            equipment_map[equipment["sap_no"]] = equipment

    added_eq = 0
    for row in equipment_rows:
        sap = row["sap_no"]
        if sap and sap in equipment_map:
            continue
        doc = await _insert_equipment(row, source="import")
        if sap:
            equipment_map[sap] = doc
        added_eq += 1

    added_mnt = 0
    skipped = 0
    maintenance_rows.sort(key=lambda row: row.get("maintenance_date") or "")
    for row in maintenance_rows:
        if skip_duplicates:
            exists = await db.maintenance.find_one(
                {
                    "sap_no": row["sap_no"],
                    "maintenance_date": row.get("maintenance_date"),
                    "problem_damage": row.get("problem_damage"),
                }
            )
            if exists:
                skipped += 1
                continue
        await _insert_maintenance(row, equipment_map)
        added_mnt += 1

    await audit_log(
        "import", "excel", "import.execute", user,
        f"Imported {added_eq} equipment, {added_mnt} maintenance ({skipped} skipped)",
    )
    return {
        "equipment_added": added_eq,
        "maintenance_added": added_mnt,
        "maintenance_skipped": skipped,
    }
