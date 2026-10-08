import asyncio
import hashlib
import logging
import os
import re
import secrets
from datetime import timedelta
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from pymongo import ReturnDocument

from auth import hash_password, verify_password
from core import audit_log, db, new_id, now_iso, now_utc
from email_service import send_password_reset_email

logger = logging.getLogger("asset-maintenance.password-reset")
router = APIRouter(prefix="/api/auth")

RESET_TTL_MINUTES = int(os.environ.get("PASSWORD_RESET_TTL_MINUTES", "30"))
RESET_RATE_WINDOW_MINUTES = int(
    os.environ.get("PASSWORD_RESET_RATE_WINDOW_MINUTES", "15")
)
RESET_RATE_MAX = int(os.environ.get("PASSWORD_RESET_RATE_MAX", "3"))

GENERIC_RESPONSE = {
    "ok": True,
    "message": (
        "If the email address is registered, "
        "a password reset link will be sent shortly."
    ),
}


class PasswordResetRequestBody(BaseModel):
    email: EmailStr


class PasswordResetConfirmBody(BaseModel):
    token: str = Field(min_length=32, max_length=1024)
    password: str = Field(min_length=12, max_length=128)


def _request_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if forwarded:
        return forwarded
    if request.client:
        return request.client.host
    return "?"


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _email_hash(email: str) -> str:
    return hashlib.sha256(email.encode("utf-8")).hexdigest()


async def _rate_limited(*, email: str, ip: str) -> bool:
    since = now_utc() - timedelta(minutes=RESET_RATE_WINDOW_MINUTES)
    count = await db.password_reset_attempts.count_documents(
        {
            "created_at": {"$gte": since},
            "$or": [
                {"email_hash": _email_hash(email)},
                {"requested_ip": ip},
            ],
        }
    )
    return count >= RESET_RATE_MAX


async def _send_reset_email_safe(*, email: str, name: str, reset_url: str) -> None:
    try:
        await send_password_reset_email(
            recipient=email,
            display_name=name,
            reset_url=reset_url,
            expires_minutes=RESET_TTL_MINUTES,
        )
        logger.info("Password reset email accepted for delivery: %s", email)
    except Exception:
        logger.exception("Password reset email delivery failed for %s", email)


@router.post("/password-reset/request")
async def request_password_reset(
    body: PasswordResetRequestBody,
    request: Request,
    background_tasks: BackgroundTasks,
):
    email = str(body.email).strip().lower()
    ip = _request_ip(request)

    # Generic public response prevents account enumeration.
    if await _rate_limited(email=email, ip=ip):
        await asyncio.sleep(0.1)
        return GENERIC_RESPONSE

    attempt_now = now_utc()
    await db.password_reset_attempts.insert_one(
        {
            "id": new_id(),
            "email_hash": _email_hash(email),
            "requested_ip": ip,
            "created_at": attempt_now,
            "expires_at": attempt_now + timedelta(hours=1),
        }
    )

    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not user.get("password_hash"):
        await asyncio.sleep(0.1)
        return GENERIC_RESPONSE

    raw_token = secrets.token_urlsafe(48)
    token_hash = _token_hash(raw_token)
    now = now_utc()
    expires_at = now + timedelta(minutes=RESET_TTL_MINUTES)

    # Only the newest reset link remains valid, while old request
    # records stay until TTL expiry for rate-limit accounting/auditability.
    await db.password_reset_tokens.update_many(
        {
            "user_id": user["id"],
            "used_at": {"$exists": False},
            "superseded_at": {"$exists": False},
        },
        {"$set": {"superseded_at": now}},
    )
    await db.password_reset_tokens.insert_one(
        {
            "id": new_id(),
            "user_id": user["id"],
            "email": email,
            "token_hash": token_hash,
            "created_at": now,
            "expires_at": expires_at,
            "requested_ip": ip,
            "user_agent": request.headers.get("user-agent", "")[:500],
        }
    )

    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000").rstrip("/")
    reset_url = (
        f"{frontend_url}/reset-password?token={quote(raw_token, safe='')}"
    )

    background_tasks.add_task(
        _send_reset_email_safe,
        email=email,
        name=user.get("name") or email,
        reset_url=reset_url,
    )

    await audit_log(
        "user",
        user["id"],
        "user.password_reset.request",
        None,
        "Password reset requested by email",
        {"requested_ip": ip},
    )

    return GENERIC_RESPONSE


@router.post("/password-reset/confirm")
async def confirm_password_reset(
    body: PasswordResetConfirmBody,
    request: Request,
):
    now = now_utc()
    token_hash = _token_hash(body.token)

    record = await db.password_reset_tokens.find_one(
        {
            "token_hash": token_hash,
            "expires_at": {"$gt": now},
            "used_at": {"$exists": False},
            "superseded_at": {"$exists": False},
        },
        {"_id": 0},
    )
    if not record:
        raise HTTPException(
            status_code=400,
            detail="This password reset link is invalid or has expired.",
        )

    user = await db.users.find_one({"id": record["user_id"]}, {"_id": 0})
    if not user or not user.get("password_hash"):
        raise HTTPException(
            status_code=400,
            detail="This password reset link is no longer valid.",
        )

    if verify_password(body.password, user["password_hash"]):
        raise HTTPException(
            status_code=400,
            detail="New password must be different from the current password.",
        )

    claimed = await db.password_reset_tokens.find_one_and_update(
        {
            "token_hash": token_hash,
            "expires_at": {"$gt": now},
            "used_at": {"$exists": False},
            "superseded_at": {"$exists": False},
        },
        {
            "$set": {
                "used_at": now,
                "used_ip": _request_ip(request),
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if not claimed:
        raise HTTPException(
            status_code=400,
            detail="This password reset link has already been used.",
        )

    result = await db.users.update_one(
        {"id": user["id"]},
        {
            "$set": {
                "password_hash": hash_password(body.password),
                "password_changed_at": now_iso(),
            }
        },
    )
    if result.matched_count != 1:
        raise HTTPException(status_code=500, detail="Unable to update password.")

    # Credential change revokes every existing session.
    await db.auth_sessions.delete_many({"user_id": user["id"]})
    await db.password_reset_tokens.delete_many({"user_id": user["id"]})

    escaped_email = re.escape(user["email"])
    await db.login_attempts.delete_many(
        {"identifier": {"$regex": f":{escaped_email}$"}}
    )

    await audit_log(
        "user",
        user["id"],
        "user.password_reset.complete",
        user,
        "Password reset completed; existing sessions revoked",
        {"reset_ip": _request_ip(request)},
    )

    return {
        "ok": True,
        "message": (
            "Password updated successfully. "
            "Please sign in with your new password."
        ),
    }
