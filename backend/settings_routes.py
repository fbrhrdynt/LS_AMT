from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import require_roles
from core import audit_log, db, now_iso

router = APIRouter(prefix="/api")
ADMIN = require_roles("admin")


class TimezoneBody(BaseModel):
    timezone: str


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
