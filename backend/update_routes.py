from fastapi import APIRouter, Depends

from auth import (
    get_current_user,
    require_roles,
)
from update_service import (
    check_for_update,
    current_version,
)

router = APIRouter(prefix="/api")
MASTER_ADMIN = require_roles("master_admin")


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
    user: dict = Depends(MASTER_ADMIN),
):
    return await check_for_update()
