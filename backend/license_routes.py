from fastapi import APIRouter, Depends

from auth import get_current_user
from license_service import public_capabilities


router = APIRouter(prefix="/api")


@router.get("/license/capabilities")
async def license_capabilities(
    user: dict = Depends(
        get_current_user
    ),
):
    return await public_capabilities()
