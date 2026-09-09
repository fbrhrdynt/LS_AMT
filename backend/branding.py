from core import db
from license_service import (
    get_license_state,
    has_feature,
)
from storage import get_object


async def get_pdf_brand_logo_bytes():
    state = await get_license_state()

    if not has_feature(
        state,
        "custom_branding",
    ):
        return None

    settings = (
        await db.settings.find_one(
            {"_id": "app"},
            {
                "_id": 0,
                "pdf_logo_path": 1,
            },
        )
        or {}
    )

    path = (
        settings.get(
            "pdf_logo_path"
        )
        or ""
    )

    if not path:
        return None

    try:
        data, _content_type = (
            get_object(path)
        )
        return data
    except (
        FileNotFoundError,
        ValueError,
        KeyError,
    ):
        return None
