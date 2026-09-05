import io
import json
import os
import zipfile
from pathlib import Path

from fastapi import APIRouter, Depends, Response

from core import db, now_iso, audit_log
from auth import require_roles

router = APIRouter(prefix="/api/admin")
ADMIN = require_roles("admin")

APP_ROOT = Path(__file__).resolve().parents[1]
EXCLUDE_DIRS = {
    "node_modules", ".git", "build", "dist", "__pycache__", ".venv",
    "venv", ".cache", "coverage", ".pytest_cache", "test_reports",
    ".emergent", ".next", "seed_data", "storage", "uploads", "backups",
}
EXCLUDE_SUFFIX = {".pyc", ".log", ".pdf", ".bson", ".dump", ".archive"}

ENV_EXAMPLES = {
    "backend/.env.example": (
        "APP_ENV=\"production\"\n"
        "MONGO_URL=\"mongodb://127.0.0.1:27017\"\n"
        "DB_NAME=\"amt_database\"\n"
        "JWT_SECRET=\"replace-with-at-least-32-random-characters\"\n"
        "ADMIN_EMAIL=\"admin@example.com\"\n"
        "ADMIN_PASSWORD=\"replace-with-a-strong-password\"\n"
        "FRONTEND_URL=\"https://amt.example.com\"\n"
        "STORAGE_ROOT=\"/opt/amt/storage\"\n"
    ),
    "frontend/.env.example": "REACT_APP_BACKEND_URL=https://amt.example.com\n",
}

NO_STORE_HEADERS = {
    "Cache-Control": "no-store, max-age=0",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
}


@router.get("/download/source")
async def download_source(user: dict = Depends(ADMIN)):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for base in ["backend", "frontend"]:
            root = APP_ROOT / base
            if not root.exists():
                continue
            for dirpath, dirnames, filenames in os.walk(root):
                dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
                for fn in filenames:
                    if fn == ".env" or fn.startswith(".env") or Path(fn).suffix in EXCLUDE_SUFFIX:
                        continue
                    full = Path(dirpath) / fn
                    try:
                        arc = full.relative_to(APP_ROOT)
                        zf.write(full, arcname=str(arc))
                    except Exception:
                        continue

        readme = APP_ROOT / "README.md"
        if readme.exists():
            zf.write(readme, arcname="README.md")

        for name, content in ENV_EXAMPLES.items():
            zf.writestr(name, content)

    buf.seek(0)
    await audit_log(
        "backup", "source", "backup.source", user,
        "Downloaded source code archive",
    )
    headers = {
        **NO_STORE_HEADERS,
        "Content-Disposition": 'attachment; filename="amt-source-code.zip"',
    }
    return Response(content=buf.read(), media_type="application/zip", headers=headers)


@router.get("/download/database")
async def download_database(user: dict = Depends(ADMIN)):
    buf = io.BytesIO()
    names = await db.list_collection_names()
    manifest = {
        "generated_at": now_iso(),
        "database": os.environ.get("DB_NAME"),
        "collections": {},
    }

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in sorted(names):
            docs = await db[name].find({}).to_list(None)
            for doc in docs:
                if "_id" in doc:
                    doc["_id"] = str(doc["_id"])
            manifest["collections"][name] = len(docs)
            zf.writestr(
                f"database/{name}.json",
                json.dumps(docs, default=str, indent=2, ensure_ascii=False),
            )
        zf.writestr("database/_manifest.json", json.dumps(manifest, indent=2))

    buf.seek(0)
    await audit_log(
        "backup", "database", "backup.database", user,
        f"Downloaded database dump ({len(names)} collections)",
    )
    headers = {
        **NO_STORE_HEADERS,
        "Content-Disposition": 'attachment; filename="amt-database-backup.zip"',
    }
    return Response(content=buf.read(), media_type="application/zip", headers=headers)
