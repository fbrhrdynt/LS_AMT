import os
from datetime import datetime, timezone, timedelta

import bcrypt
import jwt
from pymongo.errors import DuplicateKeyError
from fastapi import APIRouter, HTTPException, Request, Response, Depends
from pydantic import BaseModel, EmailStr

from core import db, new_id, now_utc, now_iso, audit_log, clean, ROLES

JWT_ALGORITHM = "HS256"
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
    payload = {"sub": user_id, "email": email,
               "exp": now_utc() + timedelta(hours=12), "type": "access"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": now_utc() + timedelta(days=7), "type": "refresh"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=True,
                        samesite="lax", max_age=43200, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=True,
                        samesite="lax", max_age=604800, path="/")


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


# Convenience dependencies
async def any_user(user: dict = Depends(get_current_user)) -> dict:
    return user


class RegisterBody(BaseModel):
    email: EmailStr
    password: str
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
    await db.login_attempts.update_one(
        {"identifier": identifier},
        {"$inc": {"count": 1},
         "$set": {"locked_until": (now_utc() + timedelta(minutes=15)).isoformat()}},
        upsert=True,
    )


@auth_router.post("/register")
async def register(body: RegisterBody, response: Response, request: Request):
    # Only admins can create privileged accounts; open self-register -> viewer
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    role = body.role if body.role in ROLES else "viewer"
    # if not created by an admin, force viewer
    try:
        creator = await get_current_user(request)
        if creator.get("role") != "admin":
            role = "viewer"
    except HTTPException:
        role = "viewer"
    uid = new_id()
    doc = {
        "id": uid, "email": email, "name": body.name,
        "password_hash": hash_password(body.password), "role": role,
        "auth_provider": "password", "picture": None, "created_at": now_iso(),
    }
    await db.users.insert_one(doc)
    access = create_access_token(uid, email)
    refresh = create_refresh_token(uid)
    set_auth_cookies(response, access, refresh)
    await audit_log("user", uid, "user.register", doc, f"Registered {email} ({role})")
    return public_user(doc)


@auth_router.post("/login")
async def login(body: LoginBody, response: Response, request: Request):
    email = body.email.lower()
    ip = (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
          or (request.client.host if request.client else "?"))
    identifier = f"{ip}:{email}"
    await _check_lockout(identifier)
    user = await db.users.find_one({"email": email})
    if not user or not user.get("password_hash") or not verify_password(body.password, user["password_hash"]):
        await _register_failure(identifier)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    await db.login_attempts.delete_one({"identifier": identifier})
    access = create_access_token(user["id"], email)
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)
    return public_user(user)


@auth_router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
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
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    access = create_access_token(user["id"], user["email"])
    response.set_cookie("access_token", access, httponly=True, secure=True,
                        samesite="lax", max_age=43200, path="/")
    return public_user(user)



# ---- user management (admin) ----
users_router = APIRouter(prefix="/api/users")


@users_router.get("")
async def list_users(user: dict = Depends(require_roles("admin", "supervisor"))):
    docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    return docs


class RoleBody(BaseModel):
    role: str


@users_router.patch("/{user_id}/role")
async def set_role(user_id: str, body: RoleBody, user: dict = Depends(require_roles("admin"))):
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
    password: str
    role: str = "viewer"


@users_router.post("")
async def create_user(body: NewUserBody, user: dict = Depends(require_roles("admin"))):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    role = body.role if body.role in ROLES else "viewer"
    uid = new_id()
    doc = {"id": uid, "email": email, "name": body.name,
           "password_hash": hash_password(body.password), "role": role,
           "auth_provider": "password", "picture": None, "created_at": now_iso()}
    try:
        await db.users.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=400, detail="Email already registered")
    await audit_log("user", uid, "user.create", user, f"Created {email} ({role})")
    return public_user(doc)


@users_router.delete("/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(require_roles("admin"))):
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    await db.users.delete_one({"id": user_id})
    await audit_log("user", user_id, "user.delete", user, "User deleted")
    return {"ok": True}


async def seed_admin():
    admin_email = os.environ["ADMIN_EMAIL"].lower()
    admin_password = os.environ["ADMIN_PASSWORD"]
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({
            "id": new_id(), "email": admin_email, "name": "Administrator",
            "password_hash": hash_password(admin_password), "role": "admin",
            "auth_provider": "password", "picture": None, "created_at": now_iso(),
        })
    else:
        updates = {"role": "admin"}
        if not existing.get("password_hash") or not verify_password(admin_password, existing["password_hash"]):
            updates["password_hash"] = hash_password(admin_password)
        await db.users.update_one({"email": admin_email}, {"$set": updates})
