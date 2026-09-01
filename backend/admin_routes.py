import io
import json
import os
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Query, Header, Response

from core import db, now_iso, audit_log
from auth import _user_from_token

router = APIRouter(prefix="/api/admin")

APP_ROOT = Path(__file__).resolve().parents[1]
EXCLUDE_DIRS = {"node_modules", ".git", "build", "dist", "__pycache__", ".venv",
                "venv", ".cache", "coverage", ".pytest_cache", "test_reports",
                ".emergent", ".next", "seed_data"}
EXCLUDE_FILES = {".env"}  # never ship real secrets (also excludes .env.*)
EXCLUDE_SUFFIX = {".pyc", ".log", ".pdf"}

ENV_EXAMPLES = {
    "backend/.env.example": (
        "MONGO_URL=\"mongodb://localhost:27017\"\n"
        "DB_NAME=\"amt_database\"\n"
        "CORS_ORIGINS=\"*\"\n"
        "JWT_SECRET=\"change-me-to-a-long-random-secret\"\n"
        "ADMIN_EMAIL=\"admin@example.com\"\n"
        "ADMIN_PASSWORD=\"change-me\"\n"
        "FRONTEND_URL=\"http://localhost:3000\"\n"
        "STORAGE_ROOT=\"/opt/amt/storage\"\n"
    ),
    "frontend/.env.example": "REACT_APP_BACKEND_URL=http://localhost:8001\n",
}


async def _require_admin(request: Request, auth: str | None, authorization: str | None) -> dict:
    token = (request.cookies.get("access_token")
             or auth or (authorization[7:] if authorization and authorization.startswith("Bearer ") else None))
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = await _user_from_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Administrator access required")
    return user


@router.get("/download/source")
async def download_source(request: Request, auth: str = Query(None), authorization: str = Header(None)):
    user = await _require_admin(request, auth, authorization)
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
        for root_file in ["README.md"]:
            p = APP_ROOT / root_file
            if p.exists():
                zf.write(p, arcname=root_file)
        for name, content in ENV_EXAMPLES.items():
            zf.writestr(name, content)
    buf.seek(0)
    await audit_log("backup", "source", "backup.source", user, "Downloaded source code archive")
    return Response(content=buf.read(), media_type="application/zip",
                    headers={"Content-Disposition": 'attachment; filename="amt-source-code.zip"'})


@router.get("/download/database")
async def download_database(request: Request, auth: str = Query(None), authorization: str = Header(None)):
    user = await _require_admin(request, auth, authorization)
    buf = io.BytesIO()
    names = await db.list_collection_names()
    manifest = {"generated_at": now_iso(), "database": os.environ.get("DB_NAME"), "collections": {}}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in sorted(names):
            docs = await db[name].find({}).to_list(None)
            for d in docs:
                if "_id" in d:
                    d["_id"] = str(d["_id"])
            manifest["collections"][name] = len(docs)
            zf.writestr(f"database/{name}.json", json.dumps(docs, default=str, indent=2, ensure_ascii=False))
        zf.writestr("database/_manifest.json", json.dumps(manifest, indent=2))
    buf.seek(0)
    await audit_log("backup", "database", "backup.database", user,
                    f"Downloaded database dump ({len(names)} collections)")
    return Response(content=buf.read(), media_type="application/zip",
                    headers={"Content-Disposition": 'attachment; filename="amt-database-backup.zip"'})
