# One-time AMT production index normalization.
#
# Run only after security_preflight.py PASS.
#
# This script is intentionally idempotent:
# - it can resume after a partially completed previous run;
# - it drops same-key indexes that only differ by name/options;
# - it recreates every index using the canonical names expected by server.py.

import asyncio

from core import db


def partial_string(field):
    return {field: {"$gt": ""}}


def normalize_keys(keys):
    if isinstance(keys, str):
        return [(keys, 1)]
    return list(keys)


def relevant_options(index):
    return {
        "unique": bool(index.get("unique", False)),
        "sparse": bool(index.get("sparse", False)),
        "expireAfterSeconds": index.get("expireAfterSeconds"),
        "partialFilterExpression": index.get("partialFilterExpression"),
    }


def desired_options(
    *,
    unique=False,
    sparse=False,
    expire_after=None,
    partial=None,
):
    return {
        "unique": bool(unique),
        "sparse": bool(sparse),
        "expireAfterSeconds": expire_after,
        "partialFilterExpression": partial,
    }


async def ensure_index(
    collection,
    keys,
    name,
    *,
    unique=False,
    sparse=False,
    expire_after=None,
    partial=None,
):
    expected_keys = normalize_keys(keys)
    expected_options = desired_options(
        unique=unique,
        sparse=sparse,
        expire_after=expire_after,
        partial=partial,
    )

    indexes = await collection.list_indexes().to_list(None)

    for index in indexes:
        index_name = index.get("name")
        if index_name == "_id_":
            continue

        actual_keys = list((index.get("key") or {}).items())
        same_key = actual_keys == expected_keys
        same_name = index_name == name

        if not same_key and not same_name:
            continue

        options_match = relevant_options(index) == expected_options

        if same_key and same_name and options_match:
            print(f"Ready: {collection.name}.{name}")
            return

        # MongoDB does not allow two indexes with the same key pattern and
        # different names/options. Remove only the conflicting definition.
        await collection.drop_index(index_name)
        print(
            f"Dropped conflicting index "
            f"{collection.name}.{index_name}"
        )

    kwargs = {"name": name}

    if unique:
        kwargs["unique"] = True
    if sparse:
        kwargs["sparse"] = True
    if expire_after is not None:
        kwargs["expireAfterSeconds"] = expire_after
    if partial is not None:
        kwargs["partialFilterExpression"] = partial

    await collection.create_index(
        expected_keys,
        **kwargs,
    )
    print(f"Ready: {collection.name}.{name}")


async def main():
    specs = [
        # Users / auth
        (
            db.users,
            "email",
            "uniq_users_email",
            {"unique": True},
        ),
        (
            db.users,
            "id",
            "uniq_users_id",
            {
                "unique": True,
                "partial": partial_string("id"),
            },
        ),
        (
            db.auth_sessions,
            "jti_hash",
            "uniq_auth_session_jti",
            {"unique": True},
        ),
        (
            db.auth_sessions,
            "expires_at",
            "ttl_auth_sessions",
            {"expire_after": 0},
        ),
        (
            db.login_attempts,
            "identifier",
            "idx_login_identifier",
            {},
        ),
        (
            db.login_attempts,
            "locked_until",
            "ttl_login_attempts",
            {"expire_after": 3600},
        ),

        # Equipment
        (
            db.equipment,
            "id",
            "uniq_equipment_id",
            {
                "unique": True,
                "partial": partial_string("id"),
            },
        ),
        (
            db.equipment,
            "sap_no",
            "uniq_equipment_sap",
            {
                "unique": True,
                "partial": partial_string("sap_no"),
            },
        ),
        (
            db.equipment,
            "mfg_no",
            "idx_equipment_mfg",
            {},
        ),
        (
            db.equipment,
            "name",
            "idx_equipment_name",
            {},
        ),
        (
            db.equipment,
            "public_token",
            "uniq_equipment_public_token",
            {
                "unique": True,
                "partial": {
                    "public_token": {"$gt": ""},
                },
            },
        ),

        # Maintenance / failures
        (
            db.maintenance,
            "id",
            "uniq_maintenance_id",
            {
                "unique": True,
                "partial": partial_string("id"),
            },
        ),
        (
            db.maintenance,
            "mnt_no",
            "uniq_maintenance_no",
            {
                "unique": True,
                "partial": partial_string("mnt_no"),
            },
        ),
        (
            db.maintenance,
            "equipment_id",
            "idx_maintenance_equipment",
            {},
        ),
        (
            db.maintenance,
            "lifecycle_lock.operation_id",
            "idx_maintenance_lifecycle",
            {},
        ),
        (
            db.failures,
            "id",
            "uniq_failure_id",
            {
                "unique": True,
                "partial": partial_string("id"),
            },
        ),
        (
            db.failures,
            "maintenance_id",
            "uniq_failure_maintenance",
            {
                "unique": True,
                "partial": partial_string(
                    "maintenance_id"
                ),
            },
        ),
        (
            db.failures,
            "equipment_id",
            "idx_failure_equipment",
            {},
        ),

        # Clients / jobs / assignment
        (
            db.clients,
            "id",
            "uniq_client_id",
            {
                "unique": True,
                "partial": partial_string("id"),
            },
        ),
        (
            db.jobs,
            "id",
            "uniq_job_id",
            {
                "unique": True,
                "partial": partial_string("id"),
            },
        ),
        (
            db.jobs,
            "job_number",
            "uniq_job_number",
            {
                "unique": True,
                "partial": partial_string("job_number"),
            },
        ),
        (
            db.assignments,
            "id",
            "uniq_assignment_id",
            {
                "unique": True,
                "partial": partial_string("id"),
            },
        ),
        (
            db.assignments,
            "equipment_id",
            "idx_assignment_equipment",
            {},
        ),
        (
            db.assignments,
            [
                ("equipment_id", 1),
                ("status", 1),
            ],
            "uniq_active_assignment_equipment",
            {
                "unique": True,
                "partial": {"status": "Active"},
            },
        ),

        # Inventory
        (
            db.inventory_items,
            "id",
            "uniq_inventory_id",
            {
                "unique": True,
                "partial": partial_string("id"),
            },
        ),
        (
            db.inventory_items,
            "item_code",
            "uniq_inventory_item_code",
            {
                "unique": True,
                "partial": partial_string("item_code"),
            },
        ),
        (
            db.inventory_transactions,
            "id",
            "uniq_inventory_tx_id",
            {
                "unique": True,
                "partial": partial_string("id"),
            },
        ),
        (
            db.inventory_transactions,
            "operation_key",
            "uniq_inventory_operation_key",
            {
                "unique": True,
                "sparse": True,
            },
        ),

        # Files / location / audit
        (
            db.files,
            "id",
            "uniq_file_id",
            {
                "unique": True,
                "partial": partial_string("id"),
            },
        ),
        (
            db.files,
            "maintenance_id",
            "idx_file_maintenance",
            {},
        ),
        (
            db.files,
            "equipment_id",
            "idx_file_equipment",
            {},
        ),
        (
            db.location_history,
            "equipment_id",
            "idx_location_equipment",
            {},
        ),
        (
            db.audit_logs,
            "timestamp",
            "idx_audit_timestamp",
            {},
        ),
    ]

    for collection, keys, name, options in specs:
        await ensure_index(
            collection,
            keys,
            name,
            **options,
        )

    print()
    print("AMT index normalization completed successfully.")


if __name__ == "__main__":
    asyncio.run(main())
