import hashlib
import os
from datetime import datetime, timezone, timedelta

import bcrypt
import jwt
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from fastapi import APIRouter, HTTPException, Request, Response, Depends
from pydantic import BaseModel, EmailStr, Field

from core import db, new_id, now_utc, now_iso, audit_log, clean, ROLES, MENU_KEYS

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

    if user.get("role") == "master_admin":
        user["menu_access"] = list(MENU_KEYS)
    elif "menu_access" not in user:
        user["menu_access"] = list(MENU_KEYS)
    else:
        user["menu_access"] = [
            key
            for key in (user.get("menu_access") or [])
            if key in MENU_KEYS
        ]

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
        if user.get("role") == "master_admin":
            return user
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


CREATABLE_ROLES = {
    "master_admin": [
        "master_admin",
        "admin",
        "supervisor",
        "technician",
        "viewer",
    ],
    "admin": [
        "admin",
        "supervisor",
        "technician",
        "viewer",
    ],
    "supervisor": [
        "technician",
        "viewer",
    ],
}


def _is_febro_name(value: str) -> bool:
    return (
        "FEBRO HERDYANTO"
        in str(value or "").upper()
    )


def _effective_role(target: dict) -> str:
    if _is_febro_name(target.get("name")):
        return "master_admin"
    return target.get("role") or "viewer"


def _allowed_create_roles(actor: dict) -> list[str]:
    return list(
        CREATABLE_ROLES.get(
            actor.get("role"),
            [],
        )
    )


def _can_manage_target(
    actor: dict,
    target: dict,
) -> bool:
    actor_role = actor.get("role")
    target_role = _effective_role(target)

    if actor_role == "master_admin":
        return True

    if actor_role == "admin":
        return target_role in (
            "admin",
            "supervisor",
            "technician",
            "viewer",
        )

    if actor_role == "supervisor":
        return target_role in (
            "technician",
            "viewer",
        )

    return False


def _normalize_menu_access(values) -> list[str]:
    selected = set(values or [])
    return [
        key
        for key in MENU_KEYS
        if key in selected
    ]


def _effective_menu_access(user: dict) -> list[str]:
    if user.get("role") == "master_admin":
        return list(MENU_KEYS)

    if "menu_access" not in user:
        return list(MENU_KEYS)

    return _normalize_menu_access(
        user.get("menu_access")
    )


def _validate_delegated_menu_access(
    actor: dict,
    requested,
) -> list[str]:
    normalized = _normalize_menu_access(
        requested
    )
    allowed = set(
        _effective_menu_access(actor)
    )

    forbidden = [
        key
        for key in normalized
        if key not in allowed
    ]

    if forbidden:
        raise HTTPException(
            status_code=403,
            detail=(
                "You can only grant menu access "
                "that you already have"
            ),
        )

    return normalized


@users_router.get("")
async def list_users(
    user: dict = Depends(
        require_roles(
            "admin",
            "supervisor",
        )
    ),
):
    rows = await db.users.find(
        {},
        {
            "_id": 0,
            "password_hash": 0,
        },
    ).to_list(1000)

    role = user.get("role")

    if role == "master_admin":
        visible = rows
    elif role == "admin":
        visible = [
            row
            for row in rows
            if _effective_role(row)
            != "master_admin"
        ]
    else:
        visible = [
            row
            for row in rows
            if _effective_role(row)
            in (
                "technician",
                "viewer",
            )
        ]

    return [
        public_user(row)
        for row in visible
    ]


class RoleBody(BaseModel):
    role: str


class MenuAccessBody(BaseModel):
    menu_access: list[str] = Field(
        default_factory=list
    )


class RoleProfileAssignmentBody(
    BaseModel
):
    role_profile_id: str


async def _load_role_profile(
    profile_id: str,
) -> dict:
    profile = (
        await db.role_profiles.find_one(
            {
                "id": profile_id
            },
            {"_id": 0},
        )
    )

    if not profile:
        raise HTTPException(
            status_code=404,
            detail=(
                "Custom role not found"
            ),
        )

    return profile


def _validate_role_profile_for_actor(
    actor: dict,
    profile: dict,
) -> tuple[str, list[str]]:
    base_role = (
        profile.get(
            "base_role"
        )
        or "viewer"
    )

    if (
        base_role
        not in _allowed_create_roles(
            actor
        )
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "You cannot assign a "
                "custom role with this "
                "permission level"
            ),
        )

    access = (
        _validate_delegated_menu_access(
            actor,
            profile.get(
                "menu_access"
            )
            or [],
        )
    )

    return (
        base_role,
        access,
    )


@users_router.patch(
    "/{user_id}/role-profile"
)
async def set_role_profile(
    user_id: str,
    body: RoleProfileAssignmentBody,
    user: dict = Depends(
        require_roles(
            "admin",
            "supervisor",
        )
    ),
):
    if user_id == user["id"]:
        raise HTTPException(
            status_code=400,
            detail=(
                "Cannot change your own role"
            ),
        )

    target = await db.users.find_one(
        {"id": user_id}
    )

    if not target:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    if not _can_manage_target(
        user,
        target,
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "You cannot manage a user "
                "at this role level"
            ),
        )

    if _is_febro_name(
        target.get("name")
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "The protected Master Admin "
                "account cannot use a custom role"
            ),
        )

    profile = (
        await _load_role_profile(
            body.role_profile_id
        )
    )

    (
        base_role,
        access,
    ) = (
        _validate_role_profile_for_actor(
            user,
            profile,
        )
    )

    updated = (
        await db.users.find_one_and_update(
            {"id": user_id},
            {
                "$set": {
                    "role": base_role,
                    "role_profile_id": (
                        profile["id"]
                    ),
                    "role_profile_name": (
                        profile["name"]
                    ),
                    "menu_access": access,
                }
            },
            return_document=(
                ReturnDocument.AFTER
            ),
        )
    )

    await audit_log(
        "user",
        user_id,
        "user.role_profile",
        user,
        (
            "Custom role set to "
            f"{profile['name']} "
            f"({base_role})"
        ),
    )

    return public_user(
        updated
    )


@users_router.patch("/{user_id}/role")
async def set_role(
    user_id: str,
    body: RoleBody,
    user: dict = Depends(
        require_roles(
            "admin",
            "supervisor",
        )
    ),
):
    if body.role not in ROLES:
        raise HTTPException(
            status_code=400,
            detail="Invalid role",
        )

    if user_id == user["id"]:
        raise HTTPException(
            status_code=400,
            detail="Cannot change your own role",
        )

    target = await db.users.find_one(
        {"id": user_id}
    )
    if not target:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    if not _can_manage_target(
        user,
        target,
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "You cannot manage a user "
                "at this role level"
            ),
        )

    if _is_febro_name(
        target.get("name")
    ) and body.role != "master_admin":
        raise HTTPException(
            status_code=400,
            detail=(
                "FEBRO HERDYANTO is a "
                "protected Master Admin account"
            ),
        )

    allowed = _allowed_create_roles(user)
    if body.role not in allowed:
        raise HTTPException(
            status_code=403,
            detail="You cannot assign this role",
        )

    updates = {"role": body.role}

    if body.role == "master_admin":
        updates["menu_access"] = list(MENU_KEYS)

    await db.users.update_one(
        {"id": user_id},
        {
            "$set": updates,
            "$unset": {
                "role_profile_id": "",
                "role_profile_name": "",
            },
        },
    )

    await audit_log(
        "user",
        user_id,
        "user.role_change",
        user,
        f"Role set to {body.role}",
    )

    return {"ok": True}


@users_router.patch("/{user_id}/access")
async def set_menu_access(
    user_id: str,
    body: MenuAccessBody,
    user: dict = Depends(
        require_roles(
            "admin",
            "supervisor",
        )
    ),
):
    if user_id == user["id"]:
        raise HTTPException(
            status_code=400,
            detail=(
                "Cannot change your own "
                "menu access"
            ),
        )

    target = await db.users.find_one(
        {"id": user_id}
    )
    if not target:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    if not _can_manage_target(
        user,
        target,
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "You cannot manage a user "
                "at this role level"
            ),
        )

    if _effective_role(target) == "master_admin":
        access = list(MENU_KEYS)
    else:
        access = _validate_delegated_menu_access(
            user,
            body.menu_access,
        )

    await db.users.update_one(
        {"id": user_id},
        {
            "$set": {
                "menu_access": access
            }
        },
    )

    await audit_log(
        "user",
        user_id,
        "user.menu_access",
        user,
        (
            "Menu access: "
            + (
                ", ".join(access)
                or "none"
            )
        ),
    )

    return {
        "ok": True,
        "menu_access": access,
    }


class NewUserBody(BaseModel):
    email: EmailStr
    name: str
    password: str = Field(
        min_length=12,
        max_length=128,
    )
    role: str = "viewer"
    role_profile_id: str | None = None
    menu_access: list[str] = Field(
        default_factory=lambda: list(
            MENU_KEYS
        )
    )


@users_router.post("")
async def create_user(
    body: NewUserBody,
    user: dict = Depends(
        require_roles(
            "admin",
            "supervisor",
        )
    ),
):
    email = body.email.lower()

    if await db.users.find_one(
        {"email": email}
    ):
        raise HTTPException(
            status_code=400,
            detail="Email already registered",
        )

    profile = None

    if body.role_profile_id:
        if _is_febro_name(
            body.name
        ):
            raise HTTPException(
                status_code=400,
                detail=(
                    "The protected Master Admin "
                    "account cannot use a custom role"
                ),
            )

        profile = (
            await _load_role_profile(
                body.role_profile_id
            )
        )

        (
            requested_role,
            _profile_default_access,
        ) = (
            _validate_role_profile_for_actor(
                user,
                profile,
            )
        )

        menu_access = (
            _validate_delegated_menu_access(
                user,
                body.menu_access,
            )
        )
    else:
        requested_role = (
            "master_admin"
            if _is_febro_name(
                body.name
            )
            else body.role
        )

        if requested_role not in ROLES:
            raise HTTPException(
                status_code=400,
                detail="Invalid role",
            )

        allowed = _allowed_create_roles(
            user
        )

        if requested_role not in allowed:
            raise HTTPException(
                status_code=403,
                detail=(
                    "You cannot create a user "
                    "with this role"
                ),
            )

        menu_access = (
            list(MENU_KEYS)
            if requested_role
            == "master_admin"
            else _validate_delegated_menu_access(
                user,
                body.menu_access,
            )
        )

    uid = new_id()

    doc = {
        "id": uid,
        "email": email,
        "name": body.name.strip(),
        "password_hash": hash_password(
            body.password
        ),
        "role": requested_role,
        "menu_access": menu_access,
        "auth_provider": "password",
        "picture": None,
        "created_at": now_iso(),
    }

    if profile:
        doc["role_profile_id"] = (
            profile["id"]
        )
        doc["role_profile_name"] = (
            profile["name"]
        )

    try:
        await db.users.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(
            status_code=400,
            detail="Email already registered",
        )

    await audit_log(
        "user",
        uid,
        "user.create",
        user,
        f"Created {email} ({requested_role})",
    )

    return public_user(doc)


@users_router.delete("/{user_id}")
async def delete_user(
    user_id: str,
    user: dict = Depends(
        require_roles(
            "admin",
            "supervisor",
        )
    ),
):
    if user_id == user["id"]:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete yourself",
        )

    target = await db.users.find_one(
        {"id": user_id}
    )
    if not target:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    if _is_febro_name(
        target.get("name")
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "FEBRO HERDYANTO is a "
                "protected Master Admin account"
            ),
        )

    if not _can_manage_target(
        user,
        target,
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "You cannot manage a user "
                "at this role level"
            ),
        )

    result = await db.users.delete_one(
        {"id": user_id}
    )

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    await db.auth_sessions.delete_many(
        {"user_id": user_id}
    )

    await audit_log(
        "user",
        user_id,
        "user.delete",
        user,
        "User deleted",
    )

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
                "menu_access": list(MENU_KEYS),
                "auth_provider": "password",
                "picture": None,
                "created_at": now_iso(),
            }
        )
    elif existing.get("role") not in ("admin", "master_admin"):
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {"role": "admin"}},
        )

    await db.users.update_many(
        {
            "name": {
                "$regex": "FEBRO HERDYANTO",
                "$options": "i",
            }
        },
        {
            "$set": {
                "role": "master_admin",
                "menu_access": list(MENU_KEYS),
            }
        },
    )
