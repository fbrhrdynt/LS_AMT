from fastapi import APIRouter, Depends, HTTPException
from pathlib import Path
import json
import os
import subprocess

from auth import (
    get_current_user,
    require_roles,
)
from update_service import (
    check_for_update,
    current_version,
)

router = APIRouter(prefix="/api")
UPDATE_ADMIN = require_roles("admin")

APP_ENV = os.environ.get(
    "APP_ENV",
    "production",
).strip().lower()

UPDATER_STATE_ROOT = Path(
    os.environ.get(
        "AMT_UPDATER_STATE_ROOT",
        "/var/lib/amt-updater",
    )
)
UPDATER_REQUEST = (
    UPDATER_STATE_ROOT
    / "request.json"
)
UPDATER_STATUS = (
    UPDATER_STATE_ROOT
    / "status.json"
)


@router.get("/version")
async def version_info(
    user: dict = Depends(get_current_user),
):
    return {
        "product": "AMT",
        "name": "Asset Maintenance Tracker",
        "version": current_version(),
    }


@router.get("/admin/update/check")
async def admin_update_check(
    user: dict = Depends(UPDATE_ADMIN),
):
    return await check_for_update()


@router.get("/admin/update/status")
async def admin_update_status(
    user: dict = Depends(UPDATE_ADMIN),
):
    if not UPDATER_STATUS.exists():
        return {
            "phase": "idle",
            "message": (
                "No update has been run"
            ),
        }

    try:
        return json.loads(
            UPDATER_STATUS.read_text(
                encoding="utf-8"
            )
        )
    except Exception:
        return {
            "phase": "unknown",
            "message": (
                "Updater status file is unreadable"
            ),
        }


@router.post("/admin/update/install")
async def admin_update_install(
    user: dict = Depends(UPDATE_ADMIN),
):
    if APP_ENV != "production":
        raise HTTPException(
            status_code=403,
            detail=(
                "Automatic installation is disabled "
                "outside production"
            ),
        )

    release = await check_for_update()

    if not release.get(
        "update_available"
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "No update is currently available"
            ),
        )

    if not release.get(
        "automatic_update_allowed",
        False,
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "This release requires manual upgrade"
            ),
        )

    if release.get(
        "has_database_migration"
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Automatic update is disabled "
                "for database-migration releases"
            ),
        )

    required = (
        "latest_version",
        "package_url",
        "sha256",
        "signature",
    )

    missing = [
        key
        for key in required
        if not release.get(key)
    ]

    if missing:
        raise HTTPException(
            status_code=400,
            detail=(
                "Release metadata incomplete: "
                + ", ".join(missing)
            ),
        )

    UPDATER_STATE_ROOT.mkdir(
        parents=True,
        exist_ok=True,
    )

    request = {
        "target_version": (
            release["latest_version"]
        ),
        "package_url": (
            release["package_url"]
        ),
        "sha256": (
            release["sha256"]
        ),
        "signature": (
            release["signature"]
        ),
        "has_database_migration": (
            bool(
                release.get(
                    "has_database_migration"
                )
            )
        ),
    }

    tmp = (
        UPDATER_REQUEST
        .with_suffix(".tmp")
    )
    tmp.write_text(
        json.dumps(
            request,
            indent=2,
        ),
        encoding="utf-8",
    )
    tmp.replace(
        UPDATER_REQUEST
    )

    # Replace any terminal status from the previous run before
    # frontend polling starts. Without this, the UI can briefly read
    # an old "failed" state while the new updater is still starting.
    status_tmp = (
        UPDATER_STATUS
        .with_suffix(".tmp")
    )
    status_tmp.write_text(
        json.dumps(
            {
                "phase": "starting",
                "message": (
                    f"Starting update "
                    f"{release['latest_version']}"
                ),
                "target_version": (
                    release[
                        "latest_version"
                    ]
                ),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    status_tmp.replace(
        UPDATER_STATUS
    )

    try:
        result = subprocess.run(
            [
                "sudo",
                "-n",
                "/usr/local/sbin/amt-update-trigger",
            ],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=10,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                "Could not start updater: "
                f"{exc}"
            ),
        )

    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=(
                "Updater trigger failed: "
                + result.stdout[-1000:]
            ),
        )

    return {
        "ok": True,
        "message": (
            f"Update {release['latest_version']} started"
        ),
    }
