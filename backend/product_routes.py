from fastapi import APIRouter, Depends, Response

from auth import require_roles
from product_info import (
    build_public_product_pdf,
    load_version_history,
)
from update_service import current_version


router = APIRouter(prefix="/api")
ADMIN = require_roles("admin")


@router.get("/product/version-history")
async def product_version_history(
    user: dict = Depends(ADMIN),
):
    data = load_version_history()
    versions = data.get("versions") or []

    return {
        **data,
        "installed_version": current_version(),
        "documented_latest": (
            versions[0].get("version")
            if versions
            else None
        ),
    }


@router.get("/product/public-guide.pdf")
async def product_public_guide_pdf(
    user: dict = Depends(ADMIN),
):
    data = build_public_product_pdf(
        current_version()
    )

    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                'attachment; filename="'
                'AMT-Public-Product-Overview.pdf"'
            ),
            "Cache-Control": "no-store, max-age=0",
            "Pragma": "no-cache",
            "X-Content-Type-Options": "nosniff",
        },
    )
