import hashlib
import os
from datetime import datetime, timezone, timedelta

import bcrypt
import jwt
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from fastapi import APIRouter, HTTPException, Request, Response, Depends
from pydantic import BaseModel, EmailStr, Field

from core import db, new_id, now_utc, now_iso, audit_log, clean, ROLES

JWT_ALGORITHM = "HS256"
ACCESS_TTL_MINUTES = int(os.environ.get("ACCESS_TTL_MINUTES", "30"))
REFRESH_TTL_DAYS = int(os.environ.get("REFRESH_TTL_DAYS", "7"))
auth_router = APIRouter(prefix="/api/auth")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, email: str) -> str:
    now = now_utc()
    payload = {
        "sub": user_id,
        "email": email,
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TTL_MINUTES),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> tuple[str, str, datetime]:
    now = now_utc()
    jti = new_id()
    expires_at = now + timedelta(days=REFRESH_TTL_DAYS)
    payload = {
        "sub": user_id,
        "jti": jti,
        "iat": now,
        "exp": expires_at,
        "type": "refresh",
    }
    token = jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)
    return token, jti, expires_at


def _jti_hash(jti: str) -> str:
    return hashlib.sha256(jti.encode("utf-8")).hexdigest()


def _request_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return forwarded or (request.client.host if request.client else "?")


def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie(
        "access_token",
        access,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=ACCESS_TTL_MINUTES * 60,
        path="/",
    )
    response.set_cookie(
        "refresh_token",
        refresh,
        httponly=True,
        secure=True,
        samesite="lax",
        max_age=REFRESH_TTL_DAYS * 86400,
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


def clear_auth_cookies(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


def public_user(user: dict) -> dict:
    user = clean(dict(user))
    user.pop("password_hash", None)
    return user


async def _user_from_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            return None
        return await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    except (jwt.InvalidTokenError, KeyError):
        return None


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = await _user_from_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return public_user(user)


def require_roles(*roles):
    async def dependency(user: dict = Depends(get_current_user)) -> dict:
        if roles and user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return dependency


async def any_user(user: dict = Depends(get_current_user)) -> dict:
    return user


class RegisterBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    name: str
    role: str = "viewer"


class LoginBody(BaseModel):
    email: EmailStr
    password: str


async def _check_lockout(identifier: str):
    rec = await db.login_attempts.find_one({"identifier": identifier})
    if rec and rec.get("count", 0) >= 5:
        locked_until = rec.get("locked_until")
        if locked_until:
            if isinstance(locked_until, str):
                locked_until = datetime.fromisoformat(locked_until)
            if locked_until.tzinfo is None:
                locked_until = locked_until.replace(tzinfo=timezone.utc)
            if locked_until > now_utc():
                raise HTTPException(status_code=429, detail="Too many attempts. Try again later.")


async def _register_failure(identifier: str):
    rec = await db.login_attempts.find_one_and_update(
        {"identifier": identifier},
        {
            "$inc": {"count": 1},
            "$set": {"updated_at": now_iso()},
            "$setOnInsert": {"created_at": now_iso()},
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    if rec and rec.get("count", 0) >= 5:
        await db.login_attempts.update_one(
            {"identifier": identifier},
            {"$set": {"locked_until": now_utc() + timedelta(minutes=15)}},
        )


async def _issue_session(user: dict, response: Response, request: Request):
    access = create_access_token(user["id"], user["email"])
    refresh, jti, expires_at = create_refresh_token(user["id"])
    await db.auth_sessions.insert_one(
        {
            "id": new_id(),
            "user_id": user["id"],
            "jti_hash": _jti_hash(jti),
            "created_at": now_utc(),
            "expires_at": expires_at,
            "ip": _request_ip(request),
            "user_agent": request.headers.get("user-agent", "")[:500],
        }
    )
    set_auth_cookies(response, access, refresh)


@auth_router.post("/register", include_in_schema=False)
async def register():
    raise HTTPException(
        status_code=403,
        detail="Self-registration is disabled. Contact an administrator.",
    )


@auth_router.post("/login")
async def login(body: LoginBody, response: Response, request: Request):
    email = body.email.lower()
    identifier = f"{_request_ip(request)}:{email}"
    await _check_lockout(identifier)

    user = await db.users.find_one({"email": email})
    if (
        not user
        or not user.get("password_hash")
        or not verify_password(body.password, user["password_hash"])
    ):
        await _register_failure(identifier)
        raise HTTPException(status_code=401, detail="Invalid email or password")

    await db.login_attempts.delete_one({"identifier": identifier})
    await _issue_session(user, response, request)
    await audit_log("user", user["id"], "user.login", user, "Login successful")
    return public_user(user)


@auth_router.post("/logout")
async def logout(response: Response, request: Request):
    token = request.cookies.get("refresh_token")
    if token:
        try:
            payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
            if payload.get("type") == "refresh" and payload.get("jti"):
                await db.auth_sessions.delete_one(
                    {
                        "user_id": payload.get("sub"),
                        "jti_hash": _jti_hash(payload["jti"]),
                    }
                )
        except jwt.InvalidTokenError:
            pass

    clear_auth_cookies(response)
    return {"ok": True}


@auth_router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@auth_router.post("/refresh")
async def refresh_token(response: Response, request: Request):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")

    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh" or not payload.get("jti"):
            raise HTTPException(status_code=401, detail="Invalid refresh token")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    session = await db.auth_sessions.find_one_and_delete(
        {
            "user_id": payload.get("sub"),
            "jti_hash": _jti_hash(payload["jti"]),
            "expires_at": {"$gt": now_utc()},
        }
    )
    if not session:
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Refresh token revoked or already used")

    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user:
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="User not found")

    await _issue_session(user, response, request)
    return public_user(user)


users_router = APIRouter(prefix="/api/users")


@users_router.get("")
async def list_users(user: dict = Depends(require_roles("admin"))):
    return await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)


class RoleBody(BaseModel):
    role: str


@users_router.patch("/{user_id}/role")
async def set_role(
    user_id: str,
    body: RoleBody,
    user: dict = Depends(require_roles("admin")),
):
    if body.role not in ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    res = await db.users.update_one({"id": user_id}, {"$set": {"role": body.role}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    await audit_log("user", user_id, "user.role_change", user, f"Role set to {body.role}")
    return {"ok": True}


class NewUserBody(BaseModel):
    email: EmailStr
    name: str
    password: str = Field(min_length=12, max_length=128)
    role: str = "viewer"


@users_router.post("")
async def create_user(
    body: NewUserBody,
    user: dict = Depends(require_roles("admin")),
):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    role = body.role if body.role in ROLES else "viewer"
    uid = new_id()
    doc = {
        "id": uid,
        "email": email,
        "name": body.name,
        "password_hash": hash_password(body.password),
        "role": role,
        "auth_provider": "password",
        "picture": None,
        "created_at": now_iso(),
    }
    try:
        await db.users.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=400, detail="Email already registered")
    await audit_log("user", uid, "user.create", user, f"Created {email} ({role})")
    return public_user(doc)


@users_router.delete("/{user_id}")
async def delete_user(
    user_id: str,
    user: dict = Depends(require_roles("admin")),
):
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    result = await db.users.delete_one({"id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    await db.auth_sessions.delete_many({"user_id": user_id})
    await audit_log("user", user_id, "user.delete", user, "User deleted")
    return {"ok": True}


async def seed_admin():
    admin_email = os.environ["ADMIN_EMAIL"].lower()
    admin_password = os.environ["ADMIN_PASSWORD"]
    existing = await db.users.find_one({"email": admin_email})

    if existing is None:
        await db.users.insert_one(
            {
                "id": new_id(),
                "email": admin_email,
                "name": "Administrator",
                "password_hash": hash_password(admin_password),
                "role": "admin",
                "auth_provider": "password",
                "picture": None,
                "created_at": now_iso(),
            }
        )
        return

    if existing.get("role") != "admin":
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"role": "admin"}},
        )
