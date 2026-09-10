from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
)
from pydantic import (
    BaseModel,
    Field,
)
from pymongo.errors import (
    DuplicateKeyError,
)

from auth import require_roles
from core import (
    MENU_KEYS,
    audit_log,
    clean,
    db,
    new_id,
    now_iso,
)


router = APIRouter(
    prefix="/api/role-profiles"
)

CUSTOM_ROLE_ADMIN = require_roles(
    "admin"
)
USER_MANAGER = require_roles(
    "admin",
    "supervisor",
)

BASE_ROLES = {
    "admin",
    "supervisor",
    "technician",
    "viewer",
}

CREATABLE_BASE_ROLES = {
    "master_admin": {
        "admin",
        "supervisor",
        "technician",
        "viewer",
    },
    "admin": {
        "admin",
        "supervisor",
        "technician",
        "viewer",
    },
}


class RoleProfileBody(BaseModel):
    name: str = Field(
        min_length=2,
        max_length=60,
    )
    base_role: str
    menu_access: list[str] = Field(
        default_factory=list
    )


def _normalize_name(
    value: str,
) -> tuple[str, str]:
    name = " ".join(
        str(value or "")
        .strip()
        .split()
    )

    if len(name) < 2:
        raise HTTPException(
            status_code=400,
            detail=(
                "Role name must contain "
                "at least 2 characters"
            ),
        )

    return (
        name,
        name.casefold(),
    )


def _normalize_menu(
    values,
) -> list[str]:
    selected = set(
        values or []
    )

    return [
        key
        for key in MENU_KEYS
        if key in selected
    ]


def _allowed_menu_access(
    user: dict,
) -> list[str]:
    if (
        user.get("role")
        == "master_admin"
    ):
        return list(MENU_KEYS)

    values = user.get(
        "menu_access"
    )

    if not isinstance(
        values,
        list,
    ):
        return list(MENU_KEYS)

    selected = set(values)

    return [
        key
        for key in MENU_KEYS
        if key in selected
    ]


def _validate_body(
    body: RoleProfileBody,
    user: dict,
) -> dict:
    allowed_roles = (
        CREATABLE_BASE_ROLES.get(
            user.get("role"),
            set(),
        )
    )

    if (
        body.base_role
        not in BASE_ROLES
        or body.base_role
        not in allowed_roles
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "You cannot create a custom role "
                "with this base permission level"
            ),
        )

    name, name_key = (
        _normalize_name(
            body.name
        )
    )

    menu_access = (
        _normalize_menu(
            body.menu_access
        )
    )

    allowed_menu = set(
        _allowed_menu_access(
            user
        )
    )

    forbidden = [
        key
        for key in menu_access
        if key not in allowed_menu
    ]

    if forbidden:
        raise HTTPException(
            status_code=403,
            detail=(
                "You can only grant menu access "
                "that is available to your own account"
            ),
        )

    return {
        "name": name,
        "name_key": name_key,
        "base_role": (
            body.base_role
        ),
        "menu_access": menu_access,
    }


async def _with_count(
    profile: dict,
) -> dict:
    row = clean(
        dict(profile)
    )

    row["assigned_count"] = (
        await db.users.count_documents(
            {
                "role_profile_id": (
                    profile["id"]
                )
            }
        )
    )

    return row


@router.get("")
async def list_role_profiles(
    user: dict = Depends(
        USER_MANAGER
    ),
):
    rows = await db.role_profiles.find(
        {},
        {"_id": 0},
    ).sort(
        "name",
        1,
    ).to_list(500)

    result = []

    for row in rows:
        result.append(
            await _with_count(
                row
            )
        )

    return result


@router.post("")
async def create_role_profile(
    body: RoleProfileBody,
    user: dict = Depends(
        CUSTOM_ROLE_ADMIN
    ),
):
    values = _validate_body(
        body,
        user,
    )

    doc = {
        "id": new_id(),
        **values,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "created_by": user.get(
            "id"
        ),
    }

    try:
        await db.role_profiles.insert_one(
            doc
        )
    except DuplicateKeyError:
        raise HTTPException(
            status_code=400,
            detail=(
                "A custom role with this "
                "name already exists"
            ),
        )

    await audit_log(
        "role_profile",
        doc["id"],
        "role_profile.create",
        user,
        (
            f"Created custom role "
            f"{doc['name']} "
            f"({doc['base_role']})"
        ),
    )

    return await _with_count(
        doc
    )


@router.put("/{profile_id}")
async def update_role_profile(
    profile_id: str,
    body: RoleProfileBody,
    user: dict = Depends(
        CUSTOM_ROLE_ADMIN
    ),
):
    existing = (
        await db.role_profiles.find_one(
            {"id": profile_id}
        )
    )

    if not existing:
        raise HTTPException(
            status_code=404,
            detail=(
                "Custom role not found"
            ),
        )

    values = _validate_body(
        body,
        user,
    )

    values["updated_at"] = (
        now_iso()
    )

    try:
        await db.role_profiles.update_one(
            {"id": profile_id},
            {"$set": values},
        )
    except DuplicateKeyError:
        raise HTTPException(
            status_code=400,
            detail=(
                "A custom role with this "
                "name already exists"
            ),
        )

    # Keep the role identity/base permission synchronized,
    # but preserve each user's individual Menu Access selections.
    await db.users.update_many(
        {
            "role_profile_id": (
                profile_id
            )
        },
        {
            "$set": {
                "role": (
                    values[
                        "base_role"
                    ]
                ),
                "role_profile_name": (
                    values["name"]
                ),
            }
        },
    )

    await audit_log(
        "role_profile",
        profile_id,
        "role_profile.update",
        user,
        (
            f"Updated custom role "
            f"{values['name']} "
            f"({values['base_role']})"
        ),
    )

    updated = {
        **existing,
        **values,
    }

    return await _with_count(
        updated
    )


@router.delete("/{profile_id}")
async def delete_role_profile(
    profile_id: str,
    user: dict = Depends(
        CUSTOM_ROLE_ADMIN
    ),
):
    existing = (
        await db.role_profiles.find_one(
            {"id": profile_id}
        )
    )

    if not existing:
        raise HTTPException(
            status_code=404,
            detail=(
                "Custom role not found"
            ),
        )

    assigned = (
        await db.users.count_documents(
            {
                "role_profile_id": (
                    profile_id
                )
            }
        )
    )

    if assigned:
        raise HTTPException(
            status_code=400,
            detail=(
                "This custom role is still "
                f"assigned to {assigned} "
                "user(s). Reassign those "
                "users before deleting it."
            ),
        )

    await db.role_profiles.delete_one(
        {"id": profile_id}
    )

    await audit_log(
        "role_profile",
        profile_id,
        "role_profile.delete",
        user,
        (
            "Deleted custom role "
            + str(
                existing.get(
                    "name"
                )
                or profile_id
            )
        ),
    )

    return {
        "ok": True
    }
