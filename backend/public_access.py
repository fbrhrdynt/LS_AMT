import os
import secrets

from pymongo.errors import DuplicateKeyError

from core import db, now_iso


PUBLIC_BASE_URL = (
    os.environ.get("PUBLIC_EQUIPMENT_BASE_URL")
    or os.environ.get("FRONTEND_URL")
    or "http://localhost:3000"
).rstrip("/")


def new_public_token() -> str:
    """Return a URL-safe, high-entropy public equipment token."""
    return secrets.token_urlsafe(32)


def public_equipment_url(token: str) -> str:
    return f"{PUBLIC_BASE_URL}/q/e/{token}"


async def ensure_equipment_public_token(equipment_id: str) -> str:
    """
    Return the equipment public token, creating one when missing.

    The token is stored in MongoDB, while the QR image itself is generated
    dynamically. Resetting the token therefore revokes every previously
    printed/downloaded QR for that equipment.
    """
    eq = await db.equipment.find_one(
        {"id": equipment_id},
        {"public_token": 1},
    )
    if not eq:
        raise LookupError("Equipment not found")

    token = (eq.get("public_token") or "").strip()
    if token:
        return token

    # Unique index on public_token is created at application startup.
    # A collision is extremely unlikely, but retry safely if it ever occurs.
    for _ in range(10):
        token = new_public_token()
        try:
            result = await db.equipment.update_one(
                {
                    "id": equipment_id,
                    "$or": [
                        {"public_token": {"$exists": False}},
                        {"public_token": None},
                        {"public_token": ""},
                    ],
                },
                {
                    "$set": {
                        "public_token": token,
                        "public_token_updated_at": now_iso(),
                    }
                },
            )
            if result.modified_count:
                return token

            # Another request may have created the token first.
            eq = await db.equipment.find_one(
                {"id": equipment_id},
                {"public_token": 1},
            )
            if eq and eq.get("public_token"):
                return eq["public_token"]
        except DuplicateKeyError:
            continue

    raise RuntimeError("Unable to create unique public equipment token")


async def reset_equipment_public_token(equipment_id: str) -> str:
    """Replace the token so all previously issued QR/public links stop working."""
    if not await db.equipment.find_one({"id": equipment_id}, {"id": 1}):
        raise LookupError("Equipment not found")

    for _ in range(10):
        token = new_public_token()
        try:
            result = await db.equipment.update_one(
                {"id": equipment_id},
                {
                    "$set": {
                        "public_token": token,
                        "public_token_updated_at": now_iso(),
                    }
                },
            )
            if result.matched_count:
                return token
        except DuplicateKeyError:
            continue

    raise RuntimeError("Unable to reset public equipment token")


async def backfill_equipment_public_tokens() -> int:
    """
    Create tokens for all existing equipment that do not have one.

    Called on backend startup. This makes every existing asset QR-ready without
    requiring the user to press Generate one by one.
    """
    query = {
        "$or": [
            {"public_token": {"$exists": False}},
            {"public_token": None},
            {"public_token": ""},
        ]
    }

    count = 0
    cursor = db.equipment.find(query, {"id": 1})
    async for eq in cursor:
        if not eq.get("id"):
            continue
        await ensure_equipment_public_token(eq["id"])
        count += 1

    return count
