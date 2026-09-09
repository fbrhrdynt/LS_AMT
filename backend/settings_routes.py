import uuid
from zoneinfo import ZoneInfo

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Response,
    UploadFile,
)
from pydantic import BaseModel

from auth import require_roles
from core import audit_log, db, now_iso
from license_service import require_feature_enabled
from storage import (
    APP_NAME,
    MIME_TYPES,
    delete_object,
    get_object,
    put_object,
    read_upload_limited,
    safe_original_filename,
    validate_file_bytes,
)

router = APIRouter(prefix="/api")
ADMIN = require_roles("admin")
MASTER_ADMIN = require_roles(
    "master_admin"
)

PDF_LOGO_MAX_SIZE = (
    2 * 1024 * 1024
)
PDF_LOGO_EXTENSIONS = {
    "png",
    "jpg",
    "jpeg",
}

APP_LOGO_MAX_SIZE = (
    2 * 1024 * 1024
)
APP_LOGO_EXTENSIONS = {
    "png",
    "jpg",
    "jpeg",
}


class TimezoneBody(BaseModel):
    timezone: str



@router.post("/settings/app-logo")
async def upload_app_logo(
    file: UploadFile = File(...),
    user: dict = Depends(
        MASTER_ADMIN
    ),
):
    await require_feature_enabled(
        "custom_branding"
    )

    filename = safe_original_filename(
        file.filename
    )
    ext = (
        filename.rsplit(".", 1)[-1].lower()
        if "." in filename
        else ""
    )

    if ext not in APP_LOGO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                "Application logo must be "
                "PNG, JPG, or JPEG"
            ),
        )

    try:
        data = await read_upload_limited(
            file,
            APP_LOGO_MAX_SIZE,
        )
        validate_file_bytes(
            ext,
            data,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    settings = (
        await db.settings.find_one(
            {"_id": "app"}
        )
        or {}
    )
    old_path = settings.get(
        "app_logo_path"
    )

    path = (
        f"{APP_NAME}/branding/app/"
        f"{uuid.uuid4()}.{ext}"
    )
    content_type = MIME_TYPES[ext]
    stored = put_object(
        path,
        data,
        content_type,
    )

    await db.settings.update_one(
        {"_id": "app"},
        {
            "$set": {
                "app_logo_path": (
                    stored["path"]
                ),
                "app_logo_filename": (
                    filename
                ),
                "app_logo_content_type": (
                    content_type
                ),
                "app_logo_updated_at": (
                    now_iso()
                ),
            }
        },
        upsert=True,
    )

    if (
        old_path
        and old_path
        != stored["path"]
    ):
        try:
            delete_object(
                old_path
            )
        except Exception:
            pass

    await audit_log(
        "settings",
        "app",
        "settings.app_logo",
        user,
        "Updated application logo",
    )

    return {
        "ok": True,
        "app_logo_configured": True,
        "filename": filename,
    }


@router.get("/settings/app-logo")
async def get_app_logo():
    await require_feature_enabled(
        "custom_branding"
    )

    settings = (
        await db.settings.find_one(
            {"_id": "app"},
            {
                "_id": 0,
                "app_logo_path": 1,
                "app_logo_content_type": 1,
            },
        )
        or {}
    )

    path = settings.get(
        "app_logo_path"
    )
    if not path:
        raise HTTPException(
            status_code=404,
            detail=(
                "Custom application logo "
                "not configured"
            ),
        )

    try:
        data, detected = get_object(
            path
        )
    except (
        FileNotFoundError,
        ValueError,
        KeyError,
    ):
        raise HTTPException(
            status_code=404,
            detail=(
                "Custom application logo "
                "not found"
            ),
        )

    return Response(
        content=data,
        media_type=(
            settings.get(
                "app_logo_content_type"
            )
            or detected
        ),
        headers={
            "Cache-Control": (
                "no-store, max-age=0"
            ),
            "X-Content-Type-Options": (
                "nosniff"
            ),
        },
    )


@router.delete("/settings/app-logo")
async def reset_app_logo(
    user: dict = Depends(
        MASTER_ADMIN
    ),
):
    await require_feature_enabled(
        "custom_branding"
    )

    settings = (
        await db.settings.find_one(
            {"_id": "app"}
        )
        or {}
    )
    path = settings.get(
        "app_logo_path"
    )
    legacy_pdf_path = settings.get(
        "pdf_logo_path"
    )

    await db.settings.update_one(
        {"_id": "app"},
        {
            "$unset": {
                "app_logo_path": "",
                "app_logo_filename": "",
                "app_logo_content_type": "",
                "app_logo_updated_at": "",
                "pdf_logo_path": "",
                "pdf_logo_filename": "",
                "pdf_logo_content_type": "",
                "pdf_logo_updated_at": "",
            }
        },
    )

    for custom_path in {
        path,
        legacy_pdf_path,
    }:
        if not custom_path:
            continue
        try:
            delete_object(
                custom_path
            )
        except Exception:
            pass

    await audit_log(
        "settings",
        "app",
        "settings.app_logo.reset",
        user,
        "Reset application logo to AMT default",
    )

    return {
        "ok": True,
        "app_logo_configured": False,
        "default_logo": "/amt-mark.png",
    }


@router.post("/settings/pdf-logo")
async def upload_pdf_logo(
    file: UploadFile = File(...),
    user: dict = Depends(
        MASTER_ADMIN
    ),
):
    await require_feature_enabled(
        "custom_branding"
    )

    filename = safe_original_filename(
        file.filename
    )
    ext = (
        filename.rsplit(".", 1)[-1].lower()
        if "." in filename
        else ""
    )

    if ext not in PDF_LOGO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                "Company PDF logo must be "
                "PNG, JPG, or JPEG"
            ),
        )

    try:
        data = await read_upload_limited(
            file,
            PDF_LOGO_MAX_SIZE,
        )
        validate_file_bytes(
            ext,
            data,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        )

    settings = (
        await db.settings.find_one(
            {"_id": "app"}
        )
        or {}
    )
    old_path = settings.get(
        "pdf_logo_path"
    )

    path = (
        f"{APP_NAME}/branding/"
        f"{uuid.uuid4()}.{ext}"
    )
    content_type = MIME_TYPES[ext]
    stored = put_object(
        path,
        data,
        content_type,
    )

    await db.settings.update_one(
        {"_id": "app"},
        {
            "$set": {
                "pdf_logo_path": (
                    stored["path"]
                ),
                "pdf_logo_filename": (
                    filename
                ),
                "pdf_logo_content_type": (
                    content_type
                ),
                "pdf_logo_updated_at": (
                    now_iso()
                ),
            }
        },
        upsert=True,
    )

    if (
        old_path
        and old_path
        != stored["path"]
    ):
        try:
            delete_object(
                old_path
            )
        except Exception:
            pass

    await audit_log(
        "settings",
        "app",
        "settings.pdf_logo",
        user,
        (
            "Updated company PDF logo"
        ),
    )

    return {
        "ok": True,
        "pdf_logo_configured": True,
        "filename": filename,
    }


@router.get("/settings/pdf-logo")
async def get_pdf_logo(
    user: dict = Depends(
        MASTER_ADMIN
    ),
):
    await require_feature_enabled(
        "custom_branding"
    )

    settings = (
        await db.settings.find_one(
            {"_id": "app"},
            {
                "_id": 0,
                "pdf_logo_path": 1,
                "pdf_logo_content_type": 1,
                "pdf_logo_filename": 1,
            },
        )
        or {}
    )

    path = settings.get(
        "pdf_logo_path"
    )
    if not path:
        raise HTTPException(
            status_code=404,
            detail="Company PDF logo not configured",
        )

    try:
        data, detected = get_object(
            path
        )
    except (
        FileNotFoundError,
        ValueError,
        KeyError,
    ):
        raise HTTPException(
            status_code=404,
            detail="Company PDF logo not found",
        )

    return Response(
        content=data,
        media_type=(
            settings.get(
                "pdf_logo_content_type"
            )
            or detected
        ),
        headers={
            "Cache-Control": (
                "no-store, max-age=0"
            ),
            "X-Content-Type-Options": (
                "nosniff"
            ),
        },
    )


@router.delete("/settings/pdf-logo")
async def delete_pdf_logo(
    user: dict = Depends(
        MASTER_ADMIN
    ),
):
    await require_feature_enabled(
        "custom_branding"
    )

    settings = (
        await db.settings.find_one(
            {"_id": "app"}
        )
        or {}
    )

    path = settings.get(
        "pdf_logo_path"
    )

    await db.settings.update_one(
        {"_id": "app"},
        {
            "$unset": {
                "pdf_logo_path": "",
                "pdf_logo_filename": "",
                "pdf_logo_content_type": "",
                "pdf_logo_updated_at": "",
            }
        },
    )

    if path:
        try:
            delete_object(path)
        except Exception:
            pass

    await audit_log(
        "settings",
        "app",
        "settings.pdf_logo.remove",
        user,
        "Removed company PDF logo",
    )

    return {
        "ok": True,
        "pdf_logo_configured": False,
    }


@router.put("/settings/timezone")
async def update_timezone(body: TimezoneBody, user: dict = Depends(ADMIN)):
    timezone_name = body.timezone.strip()
    try:
        ZoneInfo(timezone_name)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid IANA timezone")

    await db.settings.update_one(
        {"_id": "app"},
        {"$set": {"timezone": timezone_name, "timezone_updated_at": now_iso()}},
        upsert=True,
    )
    await audit_log("settings", "app", "settings.timezone", user,
                    f"Timezone set to {timezone_name}")
    settings = await db.settings.find_one({"_id": "app"}, {"_id": 0}) or {}
    settings.setdefault("currency", "USD")
    settings.setdefault("timezone", "Asia/Jakarta")
    return settings
