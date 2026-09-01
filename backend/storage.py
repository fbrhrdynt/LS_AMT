import os
from pathlib import Path

APP_NAME = "asset-maintenance-logs"

MIME_TYPES = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "gif": "image/gif", "webp": "image/webp", "pdf": "application/pdf",
    "csv": "text/csv", "txt": "text/plain",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
ALLOWED_EXT = set(MIME_TYPES.keys())
MAX_SIZE = 15 * 1024 * 1024  # 15 MB

STORAGE_ROOT = Path(os.environ.get("STORAGE_ROOT", "/opt/amt/storage")).resolve()


def init_storage():
    """Create the private VPS storage directory if it does not exist."""
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    return str(STORAGE_ROOT)


def _safe_path(path: str) -> Path:
    """Resolve a database storage_path safely inside STORAGE_ROOT."""
    normalized = str(path or "").replace("\\", "/").lstrip("/")
    if not normalized:
        raise ValueError("Storage path is empty")

    target = (STORAGE_ROOT / normalized).resolve()
    if target != STORAGE_ROOT and STORAGE_ROOT not in target.parents:
        raise ValueError("Invalid storage path")
    return target


def put_object(path: str, data: bytes, content_type: str) -> dict:
    target = _safe_path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return {
        "path": str(path).replace("\\", "/").lstrip("/"),
        "size": len(data),
        "content_type": content_type,
    }


def get_object(path: str):
    target = _safe_path(path)
    if not target.is_file():
        raise FileNotFoundError(f"Stored file not found: {path}")

    ext = target.suffix.lower().lstrip(".")
    content_type = MIME_TYPES.get(ext, "application/octet-stream")
    return target.read_bytes(), content_type
