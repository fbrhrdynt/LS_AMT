import calendar
import uuid
from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Response,
    UploadFile,
)
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from auth import get_current_user, require_roles
from core import audit_log, db, new_id, now_iso
from storage import (
    APP_NAME,
    MIME_TYPES,
    delete_object,
    get_object,
    put_object,
    read_upload_limited,
    safe_original_filename,
    content_disposition,
    validate_file_bytes,
)


router = APIRouter(prefix="/api")
EDIT = require_roles("admin", "supervisor", "technician")
MANAGE = require_roles("admin", "supervisor")

CALIBRATION_CERT_EXT = {
    "pdf",
    "jpg",
    "jpeg",
    "png",
    "webp",
}
CALIBRATION_MAX_SIZE = 15 * 1024 * 1024


class CalibrationToolBody(BaseModel):
    tool_id: str
    tool_name: str
    category: str
    manufacturer: str = ""
    model: str = ""
    range_spec: str = ""
    calibration_date: str = ""
    frequency_value: int = Field(default=52, ge=1, le=520)
    frequency_unit: Literal["week", "month"] = "week"
    cert_number: str = ""
    calibrated_by: str = ""
    comments: str = ""


class CalibrationAssignBody(BaseModel):
    sap_no: str = ""


def _clean(value) -> str:
    return str(value or "").strip()


def _parse_date(value: str):
    value = _clean(value)
    if not value:
        return None
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Calibration Date must use YYYY-MM-DD",
        )


def _add_months(value: date, months: int) -> date:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(
        value.day,
        calendar.monthrange(year, month)[1],
    )
    return date(year, month, day)


def compute_expired_date(
    calibration_date: str,
    frequency_value: int,
    frequency_unit: str,
) -> str:
    start = _parse_date(calibration_date)
    if not start:
        return ""

    if frequency_unit == "month":
        end = _add_months(start, int(frequency_value))
    else:
        end = start + timedelta(weeks=int(frequency_value))

    return end.isoformat()


def expiry_summary(expired_date: str) -> dict:
    value = _clean(expired_date)
    if not value:
        return {
            "status": "No Expiry",
            "days_remaining": None,
            "expiry_text": "No expiry date",
        }

    try:
        end = datetime.strptime(value[:10], "%Y-%m-%d").date()
    except ValueError:
        return {
            "status": "No Expiry",
            "days_remaining": None,
            "expiry_text": "Invalid expiry date",
        }

    days = (end - date.today()).days

    if days < 0:
        return {
            "status": "Expired",
            "days_remaining": days,
            "expiry_text": (
                f"Expired {abs(days)} day"
                f"{'s' if abs(days) != 1 else ''} ago"
            ),
        }

    if days == 0:
        return {
            "status": "Due Soon",
            "days_remaining": 0,
            "expiry_text": "Expires today",
        }

    status = "Due Soon" if days <= 30 else "Valid"

    return {
        "status": status,
        "days_remaining": days,
        "expiry_text": (
            f"Expires in {days} day"
            f"{'s' if days != 1 else ''}"
        ),
    }


def _normalized_tool(body: CalibrationToolBody) -> dict:
    tool_id = _clean(body.tool_id)
    tool_name = _clean(body.tool_name)
    category = _clean(body.category)

    if not tool_id:
        raise HTTPException(
            status_code=400,
            detail="Tool ID / Serial No. is required",
        )
    if not tool_name:
        raise HTTPException(
            status_code=400,
            detail="Tool Name / Description is required",
        )
    if not category:
        raise HTTPException(
            status_code=400,
            detail="Calibration Category is required",
        )

    calibration_date = _clean(body.calibration_date)
    expired_date = compute_expired_date(
        calibration_date,
        body.frequency_value,
        body.frequency_unit,
    )

    return {
        "tool_id": tool_id,
        "tool_name": tool_name,
        "category": category,
        "manufacturer": _clean(body.manufacturer),
        "model": _clean(body.model),
        "range_spec": _clean(body.range_spec),
        "calibration_date": calibration_date,
        "frequency_value": int(body.frequency_value),
        "frequency_unit": body.frequency_unit,
        "expired_date": expired_date,
        "cert_number": _clean(body.cert_number),
        "calibrated_by": _clean(body.calibrated_by),
        "comments": _clean(body.comments),
    }


async def _latest_certificate_map(tool_ids: list[str]):
    if not tool_ids:
        return {}

    rows = (
        await db.calibration_certificates.find(
            {
                "calibration_tool_id": {"$in": tool_ids},
                "is_deleted": {"$ne": True},
            },
            {"_id": 0},
        )
        .sort("created_at", -1)
        .to_list(10000)
    )

    result = {}
    for row in rows:
        tool_id = row.get("calibration_tool_id")
        if tool_id and tool_id not in result:
            result[tool_id] = row
    return result


def _public_tool(tool: dict, latest=None):
    result = {
        key: value
        for key, value in tool.items()
        if key != "_id"
    }
    result.update(
        expiry_summary(result.get("expired_date"))
    )
    result["latest_certificate"] = latest
    return result


@router.get("/calibration-categories")
async def calibration_categories(
    user: dict = Depends(get_current_user),
):
    values = await db.calibration_tools.distinct(
        "category",
        {
            "is_deleted": {"$ne": True},
            "category": {"$nin": [None, ""]},
        },
    )

    return sorted(
        {
            _clean(value)
            for value in values
            if _clean(value)
        },
        key=str.casefold,
    )


@router.get("/calibration-tools")
async def list_calibration_tools(
    category: str = "",
    status: str = "",
    equipment_id: str = "",
    user: dict = Depends(get_current_user),
):
    query = {"is_deleted": {"$ne": True}}

    if category:
        query["category"] = category
    if equipment_id:
        query["equipment_id"] = equipment_id

    tools = (
        await db.calibration_tools.find(query, {"_id": 0})
        .sort([("category", 1), ("tool_id", 1)])
        .to_list(5000)
    )

    latest_map = await _latest_certificate_map(
        [
            tool["id"]
            for tool in tools
            if tool.get("id")
        ]
    )

    rows = [
        _public_tool(
            tool,
            latest_map.get(tool.get("id")),
        )
        for tool in tools
    ]

    if status:
        rows = [
            row
            for row in rows
            if row.get("status") == status
        ]

    return rows


@router.get("/calibration-tools/{tool_record_id}")
async def get_calibration_tool(
    tool_record_id: str,
    user: dict = Depends(get_current_user),
):
    tool = await db.calibration_tools.find_one(
        {
            "id": tool_record_id,
            "is_deleted": {"$ne": True},
        },
        {"_id": 0},
    )

    if not tool:
        raise HTTPException(
            status_code=404,
            detail="Calibration tool not found",
        )

    certificates = (
        await db.calibration_certificates.find(
            {
                "calibration_tool_id": tool_record_id,
                "is_deleted": {"$ne": True},
            },
            {"_id": 0},
        )
        .sort("created_at", -1)
        .to_list(1000)
    )

    result = _public_tool(
        tool,
        certificates[0] if certificates else None,
    )
    result["certificates"] = certificates
    return result


@router.post("/calibration-tools")
async def create_calibration_tool(
    body: CalibrationToolBody,
    user: dict = Depends(EDIT),
):
    values = _normalized_tool(body)
    now = now_iso()

    doc = {
        "id": new_id(),
        **values,
        "equipment_id": None,
        "equipment_sap_no": None,
        "equipment_name": None,
        "is_deleted": False,
        "created_by": user["name"],
        "created_at": now,
        "updated_at": now,
    }

    try:
        await db.calibration_tools.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(
            status_code=400,
            detail="Tool ID / Serial No. already exists",
        )

    await audit_log(
        "calibration_tool",
        doc["id"],
        "calibration.create",
        user,
        f"Created {doc['tool_id']} ({doc['category']})",
    )

    doc.pop("_id", None)
    return _public_tool(doc)


@router.put("/calibration-tools/{tool_record_id}")
async def update_calibration_tool(
    tool_record_id: str,
    body: CalibrationToolBody,
    user: dict = Depends(EDIT),
):
    current = await db.calibration_tools.find_one(
        {
            "id": tool_record_id,
            "is_deleted": {"$ne": True},
        }
    )

    if not current:
        raise HTTPException(
            status_code=404,
            detail="Calibration tool not found",
        )

    values = _normalized_tool(body)

    duplicate = await db.calibration_tools.find_one(
        {
            "tool_id": values["tool_id"],
            "id": {"$ne": tool_record_id},
            "is_deleted": {"$ne": True},
        }
    )
    if duplicate:
        raise HTTPException(
            status_code=400,
            detail="Tool ID / Serial No. already exists",
        )

    values["updated_at"] = now_iso()

    await db.calibration_tools.update_one(
        {"id": tool_record_id},
        {"$set": values},
    )

    await audit_log(
        "calibration_tool",
        tool_record_id,
        "calibration.update",
        user,
        f"Updated {values['tool_id']}",
    )

    return await get_calibration_tool(
        tool_record_id,
        user,
    )


@router.post("/calibration-tools/{tool_record_id}/assign")
async def assign_calibration_tool(
    tool_record_id: str,
    body: CalibrationAssignBody,
    user: dict = Depends(MANAGE),
):
    tool = await db.calibration_tools.find_one(
        {
            "id": tool_record_id,
            "is_deleted": {"$ne": True},
        }
    )

    if not tool:
        raise HTTPException(
            status_code=404,
            detail="Calibration tool not found",
        )

    sap_no = _clean(body.sap_no)
    now = now_iso()

    active = await db.calibration_assignments.find_one(
        {
            "calibration_tool_id": tool_record_id,
            "status": "Active",
        }
    )

    if not sap_no:
        if active:
            await db.calibration_assignments.update_one(
                {"id": active["id"]},
                {
                    "$set": {
                        "status": "Ended",
                        "ended_at": now,
                        "ended_by": user["name"],
                    }
                },
            )

        await db.calibration_tools.update_one(
            {"id": tool_record_id},
            {
                "$set": {
                    "equipment_id": None,
                    "equipment_sap_no": None,
                    "equipment_name": None,
                    "updated_at": now,
                }
            },
        )

        await audit_log(
            "calibration_tool",
            tool_record_id,
            "calibration.unassign",
            user,
            f"Unassigned {tool.get('tool_id')}",
        )

        return await get_calibration_tool(
            tool_record_id,
            user,
        )

    equipment = await db.equipment.find_one(
        {"sap_no": sap_no},
        {"_id": 0},
    )
    if not equipment:
        raise HTTPException(
            status_code=404,
            detail="Equipment SAP not found",
        )

    if tool.get("equipment_id") == equipment.get("id"):
        return await get_calibration_tool(
            tool_record_id,
            user,
        )

    if active:
        await db.calibration_assignments.update_one(
            {"id": active["id"]},
            {
                "$set": {
                    "status": "Ended",
                    "ended_at": now,
                    "ended_by": user["name"],
                }
            },
        )

    assignment = {
        "id": new_id(),
        "calibration_tool_id": tool_record_id,
        "tool_id": tool.get("tool_id"),
        "equipment_id": equipment["id"],
        "equipment_sap_no": equipment.get("sap_no"),
        "equipment_name": equipment.get("name"),
        "status": "Active",
        "assigned_at": now,
        "assigned_by": user["name"],
    }
    await db.calibration_assignments.insert_one(assignment)

    await db.calibration_tools.update_one(
        {"id": tool_record_id},
        {
            "$set": {
                "equipment_id": equipment["id"],
                "equipment_sap_no": equipment.get("sap_no"),
                "equipment_name": equipment.get("name"),
                "updated_at": now,
            }
        },
    )

    await db.files.update_many(
        {
            "calibration_tool_id": tool_record_id,
            "source": "calibration",
            "is_deleted": False,
            "$or": [
                {"equipment_id": None},
                {"equipment_id": {"$exists": False}},
            ],
        },
        {
            "$set": {
                "equipment_id": equipment["id"],
                "equipment_sap_no": equipment.get("sap_no"),
                "equipment_name": equipment.get("name"),
            }
        },
    )

    await db.calibration_certificates.update_many(
        {
            "calibration_tool_id": tool_record_id,
            "is_deleted": {"$ne": True},
            "$or": [
                {"equipment_id": None},
                {"equipment_id": {"$exists": False}},
            ],
        },
        {
            "$set": {
                "equipment_id": equipment["id"],
                "equipment_sap_no": equipment.get("sap_no"),
                "equipment_name": equipment.get("name"),
            }
        },
    )

    await audit_log(
        "calibration_tool",
        tool_record_id,
        "calibration.assign",
        user,
        (
            f"{tool.get('tool_id')} -> "
            f"SAP {equipment.get('sap_no')}"
        ),
    )

    return await get_calibration_tool(
        tool_record_id,
        user,
    )


@router.post("/calibration-tools/{tool_record_id}/certificate")
async def upload_calibration_certificate(
    tool_record_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(EDIT),
):
    tool = await db.calibration_tools.find_one(
        {
            "id": tool_record_id,
            "is_deleted": {"$ne": True},
        }
    )
    if not tool:
        raise HTTPException(
            status_code=404,
            detail="Calibration tool not found",
        )

    filename = safe_original_filename(file.filename)
    ext = (
        filename.rsplit(".", 1)[-1].lower()
        if "." in filename
        else ""
    )

    if ext not in CALIBRATION_CERT_EXT:
        raise HTTPException(
            status_code=400,
            detail=(
                "Calibration certificate must be "
                "PDF, JPG, JPEG, PNG, or WEBP"
            ),
        )

    try:
        data = await read_upload_limited(
            file,
            CALIBRATION_MAX_SIZE,
        )
        validate_file_bytes(ext, data)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    content_type = MIME_TYPES[ext]
    certificate_id = new_id()
    file_id = new_id()
    storage_path = (
        f"{APP_NAME}/calibration/"
        f"{tool_record_id}/"
        f"{uuid.uuid4()}.{ext}"
    )

    stored = put_object(
        storage_path,
        data,
        content_type,
    )

    now = now_iso()

    file_record = {
        "id": file_id,
        "storage_path": stored["path"],
        "original_filename": filename,
        "content_type": content_type,
        "size": stored.get("size", len(data)),
        "doc_type": "Calibration Certificate",
        "source": "calibration",
        "calibration_tool_id": tool_record_id,
        "calibration_certificate_id": certificate_id,
        "tool_id": tool.get("tool_id"),
        "tool_name": tool.get("tool_name"),
        "category": tool.get("category"),
        "cert_number": tool.get("cert_number"),
        "calibration_date": tool.get("calibration_date"),
        "expired_date": tool.get("expired_date"),
        "calibrated_by": tool.get("calibrated_by"),
        "equipment_id": tool.get("equipment_id"),
        "equipment_sap_no": tool.get("equipment_sap_no"),
        "equipment_name": tool.get("equipment_name"),
        "maintenance_id": None,
        "is_deleted": False,
        "uploaded_by": user["name"],
        "created_at": now,
    }

    certificate = {
        "id": certificate_id,
        "calibration_tool_id": tool_record_id,
        "file_id": file_id,
        "tool_id": tool.get("tool_id"),
        "tool_name": tool.get("tool_name"),
        "category": tool.get("category"),
        "calibration_date": tool.get("calibration_date"),
        "frequency_value": tool.get("frequency_value"),
        "frequency_unit": tool.get("frequency_unit"),
        "expired_date": tool.get("expired_date"),
        "cert_number": tool.get("cert_number"),
        "calibrated_by": tool.get("calibrated_by"),
        "equipment_id": tool.get("equipment_id"),
        "equipment_sap_no": tool.get("equipment_sap_no"),
        "equipment_name": tool.get("equipment_name"),
        "original_filename": filename,
        "content_type": content_type,
        "size": stored.get("size", len(data)),
        "is_deleted": False,
        "uploaded_by": user["name"],
        "created_at": now,
    }

    try:
        await db.files.insert_one(file_record)
        await db.calibration_certificates.insert_one(certificate)
        await db.calibration_tools.update_one(
            {"id": tool_record_id},
            {
                "$set": {
                    "latest_certificate_id": certificate_id,
                    "updated_at": now,
                }
            },
        )
    except Exception:
        await db.files.delete_one({"id": file_id})
        await db.calibration_certificates.delete_one(
            {"id": certificate_id}
        )
        try:
            delete_object(stored["path"])
        except Exception:
            pass
        raise

    await audit_log(
        "calibration_certificate",
        certificate_id,
        "calibration.certificate.upload",
        user,
        (
            f"{tool.get('tool_id')} "
            f"{tool.get('cert_number') or filename}"
        ),
    )

    file_record.pop("_id", None)
    return file_record


@router.get("/calibration-tools/{tool_record_id}/certificates")
async def list_calibration_certificates(
    tool_record_id: str,
    user: dict = Depends(get_current_user),
):
    return (
        await db.calibration_certificates.find(
            {
                "calibration_tool_id": tool_record_id,
                "is_deleted": {"$ne": True},
            },
            {"_id": 0},
        )
        .sort("created_at", -1)
        .to_list(1000)
    )


@router.delete("/calibration-tools/{tool_record_id}")
async def archive_calibration_tool(
    tool_record_id: str,
    user: dict = Depends(MANAGE),
):
    tool = await db.calibration_tools.find_one(
        {
            "id": tool_record_id,
            "is_deleted": {"$ne": True},
        }
    )

    if not tool:
        raise HTTPException(
            status_code=404,
            detail="Calibration tool not found",
        )

    now = now_iso()

    await db.calibration_assignments.update_many(
        {
            "calibration_tool_id": tool_record_id,
            "status": "Active",
        },
        {
            "$set": {
                "status": "Ended",
                "ended_at": now,
                "ended_by": user["name"],
            }
        },
    )

    await db.calibration_tools.update_one(
        {"id": tool_record_id},
        {
            "$set": {
                "is_deleted": True,
                "deleted_at": now,
                "deleted_by": user["name"],
                "equipment_id": None,
                "equipment_sap_no": None,
                "equipment_name": None,
                "updated_at": now,
            }
        },
    )

    await audit_log(
        "calibration_tool",
        tool_record_id,
        "calibration.archive",
        user,
        f"Archived {tool.get('tool_id')}",
    )

    return {"ok": True}


@router.get("/calibration-certificates/{certificate_id}/download")
async def download_calibration_certificate(
    certificate_id: str,
    user: dict = Depends(get_current_user),
):
    certificate = await db.calibration_certificates.find_one(
        {
            "id": certificate_id,
            "is_deleted": {"$ne": True},
        }
    )
    if not certificate:
        raise HTTPException(
            status_code=404,
            detail="Certificate not found",
        )

    file_record = await db.files.find_one(
        {
            "id": certificate.get("file_id"),
            "is_deleted": False,
        }
    )
    if not file_record:
        raise HTTPException(
            status_code=404,
            detail="Certificate file not found",
        )

    try:
        data, detected_type = get_object(
            file_record["storage_path"]
        )
    except (FileNotFoundError, ValueError, KeyError):
        raise HTTPException(
            status_code=404,
            detail="Stored certificate file not found",
        )

    return Response(
        content=data,
        media_type=(
            file_record.get("content_type")
            or detected_type
        ),
        headers={
            "Content-Disposition": content_disposition(
                file_record.get("original_filename")
                or "calibration-certificate",
                "inline",
            ),
            "Cache-Control": "no-store, max-age=0",
            "Pragma": "no-cache",
            "X-Content-Type-Options": "nosniff",
        },
    )
