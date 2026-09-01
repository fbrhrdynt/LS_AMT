import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

ROLES = ["admin", "supervisor", "technician", "viewer"]


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


async def next_sequence(name: str, year: int | None = None) -> int:
    key = f"{name}:{year}" if year else name
    doc = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=True
    )
    return doc["seq"]


async def gen_maintenance_no() -> str:
    year = now_utc().year
    seq = await next_sequence("maintenance", year)
    return f"MNT-{year}-{seq:05d}"


async def gen_job_no() -> str:
    year = now_utc().year
    seq = await next_sequence("job", year)
    return f"JOB-{year}-{seq:03d}"


async def audit_log(entity_type: str, entity_id: str, action: str, user: dict | None,
                    details: str = "", extra: dict | None = None):
    doc = {
        "id": new_id(),
        "entity_type": entity_type,
        "entity_id": entity_id,
        "action": action,
        "user_id": (user or {}).get("id"),
        "user_name": (user or {}).get("name") or (user or {}).get("email") or "system",
        "details": details,
        "extra": extra or {},
        "timestamp": now_iso(),
    }
    await db.audit_logs.insert_one(doc)
    return doc


def clean(doc: dict | None) -> dict | None:
    """Drop mongo _id if present."""
    if doc is None:
        return None
    doc.pop("_id", None)
    return doc
