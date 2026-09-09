#!/usr/bin/env python3
import asyncio
import json
import uuid
from pathlib import Path

from core import MENU_KEYS, db, now_iso


HERE = Path(__file__).resolve().parent
DATA = HERE / "calibration_tracker_seed.json"
SEED_NAMESPACE = uuid.UUID("b2fe8548-a2bc-43a0-8d85-d4f35663cdf8")


def stable_id(kind: str, source_key: str) -> str:
    return str(uuid.uuid5(SEED_NAMESPACE, f"{kind}:{source_key}"))


async def normalize_indexes():
    info = await db.calibration_tools.index_information()

    if "uniq_calibration_tool_code" in info:
        await db.calibration_tools.drop_index("uniq_calibration_tool_code")
        print("Dropped legacy unique calibration Tool ID index.")

    await db.calibration_tools.create_index(
        "tool_id",
        name="idx_calibration_tool_code",
    )
    await db.calibration_tools.create_index(
        "source_key",
        unique=True,
        name="uniq_calibration_source_key",
        partialFilterExpression={"source_key": {"$gt": ""}},
    )
    await db.calibration_assignments.create_index(
        "source_key",
        unique=True,
        name="uniq_calibration_assignment_source_key",
        partialFilterExpression={"source_key": {"$gt": ""}},
    )


async def find_equipment(source_sap_no: str):
    sap = str(source_sap_no or "").strip()
    if not sap:
        return None

    candidates = [sap]
    if sap.isdigit():
        try:
            candidates.append(int(sap))
        except ValueError:
            pass

    return await db.equipment.find_one(
        {"sap_no": {"$in": candidates}},
        {"_id": 0},
    )


async def seed():
    payload = json.loads(DATA.read_text(encoding="utf-8"))
    rows = payload["records"]

    await normalize_indexes()

    promoted = await db.users.update_many(
        {
            "name": {
                "$regex": "FEBRO HERDYANTO",
                "$options": "i",
            }
        },
        {
            "$set": {
                "role": "master_admin",
                "menu_access": MENU_KEYS,
            }
        },
    )

    inserted = 0
    existing = 0
    assigned = 0
    blank_sap = 0
    sap_not_found = 0

    now = now_iso()

    for row in rows:
        source_key = row["source_key"]
        tool_record_id = stable_id("calibration-tool", source_key)

        source_sap = str(row.get("source_sap_no") or "").strip()
        equipment = await find_equipment(source_sap)

        if not source_sap:
            blank_sap += 1
        elif not equipment:
            sap_not_found += 1

        doc = {
            "id": tool_record_id,
            "source_key": source_key,
            "source": "TRACKER SEPTEMBER-CALIBRATION.xlsx",
            "source_sheet": row.get("source_sheet"),
            "source_row": row.get("source_row"),
            "source_description": row.get("source_description", ""),
            "source_sap_no": source_sap,
            "tool_id": row.get("tool_id", ""),
            "tool_name": row.get("tool_name", ""),
            "category": row.get("category", ""),
            "manufacturer": row.get("manufacturer", ""),
            "model": row.get("model", ""),
            "range_spec": row.get("range_spec", ""),
            "calibration_date": row.get("calibration_date", ""),
            "frequency_value": int(row.get("frequency_value") or 52),
            "frequency_unit": row.get("frequency_unit", "week"),
            "expired_date": row.get("expired_date", ""),
            "cert_number": row.get("cert_number", ""),
            "calibrated_by": row.get("calibrated_by", ""),
            "comments": row.get("comments", ""),
            "equipment_id": equipment.get("id") if equipment else None,
            "equipment_sap_no": str(equipment.get("sap_no")) if equipment else None,
            "equipment_name": equipment.get("name") if equipment else None,
            "is_deleted": False,
            "created_by": "Calibration Tracker Seed",
            "created_at": now,
            "updated_at": now,
        }

        result = await db.calibration_tools.update_one(
            {"source_key": source_key},
            {"$setOnInsert": doc},
            upsert=True,
        )

        if result.upserted_id is None:
            existing += 1
            continue

        inserted += 1

        if equipment:
            assignment_id = stable_id("calibration-assignment", source_key)
            await db.calibration_assignments.update_one(
                {"source_key": source_key},
                {
                    "$setOnInsert": {
                        "id": assignment_id,
                        "source_key": source_key,
                        "source": "TRACKER SEPTEMBER-CALIBRATION.xlsx",
                        "calibration_tool_id": tool_record_id,
                        "tool_id": row.get("tool_id", ""),
                        "equipment_id": equipment["id"],
                        "equipment_sap_no": str(equipment.get("sap_no")),
                        "equipment_name": equipment.get("name"),
                        "status": "Active",
                        "assigned_at": now,
                        "assigned_by": "Calibration Tracker Seed",
                    }
                },
                upsert=True,
            )
            assigned += 1

    print()
    print("Calibration tracker seed completed.")
    print(f"Workbook rows prepared : {len(rows)}")
    print(f"Inserted              : {inserted}")
    print(f"Already seeded        : {existing}")
    print(f"Assigned by SAP       : {assigned}")
    print(f"Blank SAP in workbook : {blank_sap}")
    print(f"SAP not found in AMT  : {sap_not_found}")
    print(f"FEBRO HERDYANTO master-admin matches: {promoted.matched_count}")
    print()
    print(
        "Rows with blank/missing SAP remain unassigned. "
        "No Equipment records were created by this seed."
    )


if __name__ == "__main__":
    asyncio.run(seed())
