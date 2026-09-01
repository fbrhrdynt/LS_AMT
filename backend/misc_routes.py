import csv
import io

from fastapi import APIRouter, Depends, UploadFile, File, Response, Query, Header, HTTPException, Request
from pydantic import BaseModel
import openpyxl

from core import db, audit_log
from auth import get_current_user, require_roles, _user_from_token
from importer import parse_workbook, _insert_equipment, _insert_maintenance

router = APIRouter(prefix="/api")
MANAGE = require_roles("admin", "supervisor")


# -------- app settings (currency) --------
class SettingsBody(BaseModel):
    currency: str


@router.get("/settings")
async def get_settings(user: dict = Depends(get_current_user)):
    s = await db.settings.find_one({"_id": "app"}, {"_id": 0})
    return s or {"currency": "USD"}


@router.put("/settings")
async def update_settings(body: SettingsBody, user: dict = Depends(require_roles("admin"))):
    await db.settings.update_one({"_id": "app"}, {"$set": {"currency": body.currency}}, upsert=True)
    await audit_log("settings", "app", "settings.update", user, f"Currency set to {body.currency}")
    return {"currency": body.currency}


# -------- audit trail --------
@router.get("/audit")
async def list_audit(entity_type: str = "", entity_id: str = "", limit: int = 200,
                     user: dict = Depends(get_current_user)):
    query = {}
    if entity_type:
        query["entity_type"] = entity_type
    if entity_id:
        query["entity_id"] = entity_id
    return await db.audit_logs.find(query, {"_id": 0}).sort("timestamp", -1).limit(min(limit, 1000)).to_list(1000)


# -------- reports --------
@router.get("/reports/maintenance")
async def report_maintenance(equipment_id: str = "", sap_no: str = "", serial_no: str = "",
                             date_from: str = "", date_to: str = "", type: str = "",
                             technician: str = "", failure: str = "", client_id: str = "",
                             job_id: str = "", status: str = "", user: dict = Depends(get_current_user)):
    query = {}
    if equipment_id:
        query["equipment_id"] = equipment_id
    if sap_no:
        query["sap_no"] = {"$regex": sap_no, "$options": "i"}
    if type:
        query["type_of_maintenance"] = {"$regex": type, "$options": "i"}
    if technician:
        query["$or"] = [{"lead_technician": {"$regex": technician, "$options": "i"}},
                        {"support_technicians": {"$regex": technician, "$options": "i"}}]
    if failure:
        query["failure_found"] = {"$regex": failure, "$options": "i"}
    if client_id:
        query["client_id"] = client_id
    if job_id:
        query["job_id"] = job_id
    if status:
        query["status"] = status
    if date_from or date_to:
        dq = {}
        if date_from:
            dq["$gte"] = date_from
        if date_to:
            dq["$lte"] = date_to
        query["maintenance_date"] = dq
    rows = await db.maintenance.find(query, {"_id": 0}).sort("maintenance_date", -1).to_list(5000)
    if serial_no:
        eqs = await db.equipment.find({"mfg_no": {"$regex": serial_no, "$options": "i"}}, {"_id": 0}).to_list(1000)
        ids = {e["id"] for e in eqs}
        rows = [r for r in rows if r["equipment_id"] in ids]
    return {"total": len(rows), "items": rows}


REPORT_COLS = [
    ("mnt_no", "Maintenance No"), ("maintenance_date", "Date"), ("sap_no", "Asset/SAP No"),
    ("equipment_name", "Equipment"), ("type_of_maintenance", "Type"),
    ("maintenance_category", "Category"), ("problem_damage", "Problem/Damage"),
    ("failure_found", "Failure Found"), ("root_cause", "Root Cause"),
    ("action_taken", "Action Taken"), ("lead_technician", "Lead Technician"),
    ("checked_by", "Checked By"), ("duration_days", "Duration (days)"),
    ("client_name", "Client"), ("job_number", "Job"), ("final_condition", "Final Condition"),
    ("status", "Status"),
]


async def _report_rows(params):
    res = await report_maintenance(**params, user={"id": "x"})
    return res["items"]


def _tok(request, auth, authorization):
    return (request.cookies.get("access_token")
            or auth or (authorization[7:] if authorization and authorization.startswith("Bearer ") else None))


@router.get("/reports/maintenance/export.csv")
async def export_csv(request: Request, auth: str = Query(None), authorization: str = Header(None),
                     equipment_id: str = "", sap_no: str = "", status: str = "",
                     date_from: str = "", date_to: str = "", type: str = "",
                     technician: str = "", client_id: str = "", job_id: str = ""):
    token = _tok(request, auth, authorization)
    if not token or not await _user_from_token(token):
        raise HTTPException(status_code=401, detail="Not authenticated")
    res = await report_maintenance(equipment_id=equipment_id, sap_no=sap_no, status=status,
                                   date_from=date_from, date_to=date_to, type=type,
                                   technician=technician, client_id=client_id, job_id=job_id,
                                   user={"id": "x"})
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([h for _, h in REPORT_COLS])
    for r in res["items"]:
        w.writerow([r.get(k, "") for k, _ in REPORT_COLS])
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="maintenance_report.csv"'})


@router.get("/reports/maintenance/export.xlsx")
async def export_xlsx(request: Request, auth: str = Query(None), authorization: str = Header(None),
                      equipment_id: str = "", sap_no: str = "", status: str = "",
                      date_from: str = "", date_to: str = "", type: str = "",
                      technician: str = "", client_id: str = "", job_id: str = ""):
    token = _tok(request, auth, authorization)
    if not token or not await _user_from_token(token):
        raise HTTPException(status_code=401, detail="Not authenticated")
    res = await report_maintenance(equipment_id=equipment_id, sap_no=sap_no, status=status,
                                   date_from=date_from, date_to=date_to, type=type,
                                   technician=technician, client_id=client_id, job_id=job_id,
                                   user={"id": "x"})
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Maintenance"
    ws.append([h for _, h in REPORT_COLS])
    for r in res["items"]:
        ws.append([str(r.get(k, "")) for k, _ in REPORT_COLS])
    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    return Response(content=out.read(),
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="maintenance_report.xlsx"'})


# -------- excel import wizard --------
@router.post("/import/analyze")
async def import_analyze(file: UploadFile = File(...), user: dict = Depends(MANAGE)):
    data = await file.read()
    try:
        equipment_rows, maintenance_rows = parse_workbook(io.BytesIO(data))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse file: {e}")
    existing_saps = set(await db.equipment.distinct("sap_no"))
    new_eq = [e for e in equipment_rows if e["sap_no"] not in existing_saps]
    dup_eq = [e for e in equipment_rows if e["sap_no"] in existing_saps]
    # duplicate maintenance: same sap + date + problem already present
    dup_mnt, new_mnt = [], []
    for m in maintenance_rows:
        exists = await db.maintenance.find_one({"sap_no": m["sap_no"],
                                                "maintenance_date": m.get("maintenance_date"),
                                                "problem_damage": m.get("problem_damage")})
        (dup_mnt if exists else new_mnt).append(m)
    return {
        "equipment": {"total": len(equipment_rows), "new": len(new_eq), "duplicates": len(dup_eq),
                      "sample": equipment_rows[:8]},
        "maintenance": {"total": len(maintenance_rows), "new": len(new_mnt), "duplicates": len(dup_mnt),
                        "sample": maintenance_rows[:8]},
    }


@router.post("/import/execute")
async def import_execute(file: UploadFile = File(...), skip_duplicates: bool = Query(True),
                         user: dict = Depends(MANAGE)):
    data = await file.read()
    try:
        equipment_rows, maintenance_rows = parse_workbook(io.BytesIO(data))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse file: {e}")
    equipment_map = {}
    existing = await db.equipment.find({}, {"_id": 0}).to_list(100000)
    for e in existing:
        if e.get("sap_no"):
            equipment_map[e["sap_no"]] = e
    added_eq = 0
    for row in equipment_rows:
        sap = row["sap_no"]
        if sap and sap in equipment_map:
            continue
        doc = await _insert_equipment(row, source="import")
        if sap:
            equipment_map[sap] = doc
        added_eq += 1
    added_mnt, skipped = 0, 0
    maintenance_rows.sort(key=lambda r: r.get("maintenance_date") or "")
    for m in maintenance_rows:
        if skip_duplicates:
            exists = await db.maintenance.find_one({"sap_no": m["sap_no"],
                                                    "maintenance_date": m.get("maintenance_date"),
                                                    "problem_damage": m.get("problem_damage")})
            if exists:
                skipped += 1
                continue
        await _insert_maintenance(m, equipment_map)
        added_mnt += 1
    await audit_log("import", "excel", "import.execute", user,
                    f"Imported {added_eq} equipment, {added_mnt} maintenance ({skipped} skipped)")
    return {"equipment_added": added_eq, "maintenance_added": added_mnt, "maintenance_skipped": skipped}
