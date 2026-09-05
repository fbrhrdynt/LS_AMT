import io
import os
import re
import zipfile
from pathlib import Path
from urllib.parse import quote

APP_NAME = "asset-maintenance-logs"

MIME_TYPES = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "gif": "image/gif",
    "webp": "image/webp",
    "pdf": "application/pdf",
    "csv": "text/csv",
    "txt": "text/plain",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
ALLOWED_EXT = set(MIME_TYPES.keys())
MAX_SIZE = 15 * 1024 * 1024
IMPORT_MAX_SIZE = 20 * 1024 * 1024
IMPORT_MAX_UNCOMPRESSED = 150 * 1024 * 1024
IMPORT_MAX_ENTRIES = 5000

DOCUMENT_TYPES = {
    "Before Photo",
    "After Photo",
    "Function Test",
    "Lifting Inspection",
    "Inspection Report",
    "Failure Evidence",
    "Calibration Certificate",
    "Test Certificate",
    "Certificate",
    "Other Document",
}

STORAGE_ROOT = Path(os.environ.get("STORAGE_ROOT", "/opt/amt/storage")).resolve()


def init_storage():
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        STORAGE_ROOT.chmod(0o750)
    except PermissionError:
        pass
    return str(STORAGE_ROOT)


def _safe_path(path: str) -> Path:
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
    try:
        target.chmod(0o640)
    except PermissionError:
        pass
    return {
        "path": str(path).replace("\\", "/").lstrip("/"),
        "size": len(data),
        "content_type": content_type,
    }


def delete_object(path: str) -> bool:
    target = _safe_path(path)
    if target.is_file():
        target.unlink()
        return True
    return False


def get_object(path: str):
    target = _safe_path(path)
    if not target.is_file():
        raise FileNotFoundError(f"Stored file not found: {path}")

    ext = target.suffix.lower().lstrip(".")
    content_type = MIME_TYPES.get(ext, "application/octet-stream")
    return target.read_bytes(), content_type


async def read_upload_limited(upload, max_size: int = MAX_SIZE) -> bytes:
    chunks = []
    total = 0
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_size:
            raise ValueError(f"File exceeds {max_size // (1024 * 1024)}MB limit")
        chunks.append(chunk)
    return b"".join(chunks)


def safe_original_filename(filename: str) -> str:
    name = Path(str(filename or "document").replace("\\", "/")).name
    name = re.sub(r"[\x00-\x1f\x7f]+", "_", name).strip()
    if not name:
        name = "document"
    return name[:200]


def content_disposition(filename: str, disposition: str = "inline") -> str:
    safe = safe_original_filename(filename)
    ascii_name = re.sub(r"[^A-Za-z0-9._ -]+", "_", safe).replace('"', "_")
    encoded = quote(safe, safe="")
    return f'{disposition}; filename="{ascii_name}"; filename*=UTF-8\'\'{encoded}'


def _validate_zip_document(data: bytes, ext: str):
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = set(zf.namelist())
    except zipfile.BadZipFile:
        raise ValueError(f"File content does not match .{ext}")

    if ext == "xlsx" and not any(name.startswith("xl/") for name in names):
        raise ValueError("File content does not match .xlsx")
    if ext == "docx" and not any(name.startswith("word/") for name in names):
        raise ValueError("File content does not match .docx")


def validate_file_bytes(ext: str, data: bytes):
    ext = ext.lower()
    if not data:
        raise ValueError("File is empty")

    if ext in {"jpg", "jpeg"} and not data.startswith(b"\xff\xd8\xff"):
        raise ValueError("File content does not match JPEG")
    if ext == "png" and not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("File content does not match PNG")
    if ext == "gif" and not (data.startswith(b"GIF87a") or data.startswith(b"GIF89a")):
        raise ValueError("File content does not match GIF")
    if ext == "webp" and not (len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"):
        raise ValueError("File content does not match WebP")
    if ext == "pdf" and not data.lstrip().startswith(b"%PDF-"):
        raise ValueError("File content does not match PDF")
    if ext == "doc" and not data.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        raise ValueError("File content does not match legacy Word document")
    if ext in {"xlsx", "docx"}:
        _validate_zip_document(data, ext)
    if ext in {"csv", "txt"} and b"\x00" in data[:1024 * 1024]:
        raise ValueError("Text file contains binary content")


def validate_workbook_archive(data: bytes):
    if len(data) > IMPORT_MAX_SIZE:
        raise ValueError("Workbook exceeds 20MB limit")

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            infos = zf.infolist()
            if len(infos) > IMPORT_MAX_ENTRIES:
                raise ValueError("Workbook contains too many archive entries")
            total_uncompressed = sum(info.file_size for info in infos)
            if total_uncompressed > IMPORT_MAX_UNCOMPRESSED:
                raise ValueError("Workbook expands beyond the allowed size")
            if not any(info.filename.startswith("xl/") for info in infos):
                raise ValueError("File is not a valid Excel workbook")
    except zipfile.BadZipFile:
        raise ValueError("File is not a valid .xlsx workbook")
