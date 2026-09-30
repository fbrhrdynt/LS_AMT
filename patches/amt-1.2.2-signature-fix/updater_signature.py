#!/usr/bin/env python3
"""
AMT updater release-signature helper.

Security properties:
- Prefers canonical signature-base64.txt from the same release directory.
- CRM/API signature is fallback only.
- Strict Base64 validation.
- Expected RSA signature byte length is derived from the installed public key.
- Atomic 0600 signature file write.
- OpenSSL verification remains mandatory.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import os
import re
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen


class ReleaseSignatureError(RuntimeError):
    pass


def canonical_signature_url(package_url: str) -> str:
    parts = urlsplit(package_url)
    if parts.scheme not in {"https", "http"} or not parts.netloc:
        raise ReleaseSignatureError(f"Invalid package URL: {package_url!r}")

    package_path = parts.path
    if "/" not in package_path:
        raise ReleaseSignatureError(f"Package URL has no release directory: {package_url!r}")

    directory = package_path.rsplit("/", 1)[0]
    signature_path = directory + "/signature-base64.txt"

    # Deliberately drop package query/fragment.
    return urlunsplit((parts.scheme, parts.netloc, signature_path, "", ""))


def expected_rsa_signature_bytes(public_key: str | Path) -> int:
    proc = subprocess.run(
        [
            "openssl", "pkey",
            "-pubin",
            "-in", str(public_key),
            "-text",
            "-noout",
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise ReleaseSignatureError(
            "Could not inspect release public key: "
            + (proc.stderr.strip() or proc.stdout.strip())
        )

    match = re.search(r"Public-Key:\s*\((\d+)\s*bit\)", proc.stdout)
    if not match:
        raise ReleaseSignatureError("Could not determine RSA public-key size.")

    bits = int(match.group(1))
    if bits <= 0 or bits % 8 != 0:
        raise ReleaseSignatureError(f"Unexpected RSA public-key size: {bits} bits")

    return bits // 8


def normalize_base64(value: str) -> str:
    # Only whitespace is normalized. No arbitrary character repair.
    return "".join(str(value or "").split())


def decode_signature_base64(
    value: str,
    *,
    expected_bytes: int,
    source: str,
) -> tuple[str, bytes]:
    clean = normalize_base64(value)
    if not clean:
        raise ReleaseSignatureError(f"{source}: release signature is empty")

    try:
        decoded = base64.b64decode(clean, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ReleaseSignatureError(
            f"{source}: invalid Base64 release signature: {exc}"
        ) from exc

    if len(decoded) != expected_bytes:
        raise ReleaseSignatureError(
            f"{source}: invalid RSA signature length: "
            f"{len(decoded)} bytes; expected {expected_bytes} bytes "
            f"(Base64 chars={len(clean)})"
        )

    return clean, decoded


def fetch_text(url: str, *, timeout: int = 30) -> str:
    req = Request(
        url,
        headers={
            "User-Agent": "AMT-Updater/1.2.2",
            "Accept": "text/plain,*/*;q=0.1",
            "Cache-Control": "no-cache",
        },
    )
    with urlopen(req, timeout=timeout) as response:
        status = getattr(response, "status", 200)
        if status != 200:
            raise ReleaseSignatureError(
                f"Canonical release signature returned HTTP {status}"
            )
        raw = response.read()

    try:
        return raw.decode("ascii")
    except UnicodeDecodeError as exc:
        raise ReleaseSignatureError(
            "Canonical release signature is not ASCII/Base64 text"
        ) from exc


def atomic_write_signature(path: str | Path, data: bytes) -> Path:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)

    fd, tmp_name = tempfile.mkstemp(
        prefix=".release.sig.",
        dir=str(target.parent),
    )
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, target)
    except Exception:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise

    return target


def resolve_release_signature(
    *,
    package_url: str,
    crm_signature: str | None,
    public_key: str | Path,
    signature_path: str | Path,
    timeout: int = 30,
) -> dict:
    expected = expected_rsa_signature_bytes(public_key)
    canonical_url = canonical_signature_url(package_url)

    errors: list[str] = []

    # 1) Canonical release artifact is authoritative.
    try:
        canonical_text = fetch_text(canonical_url, timeout=timeout)
        clean, decoded = decode_signature_base64(
            canonical_text,
            expected_bytes=expected,
            source="release-server",
        )
        atomic_write_signature(signature_path, decoded)
        return {
            "source": "release-server",
            "url": canonical_url,
            "base64_length": len(clean),
            "decoded_length": len(decoded),
            "sha256": hashlib.sha256(decoded).hexdigest(),
            "expected_length": expected,
        }
    except Exception as exc:
        errors.append(f"release-server: {exc}")

    # 2) CRM/API metadata is fallback only, and must be complete.
    if crm_signature:
        try:
            clean, decoded = decode_signature_base64(
                crm_signature,
                expected_bytes=expected,
                source="crm",
            )
            atomic_write_signature(signature_path, decoded)
            return {
                "source": "crm",
                "url": None,
                "base64_length": len(clean),
                "decoded_length": len(decoded),
                "sha256": hashlib.sha256(decoded).hexdigest(),
                "expected_length": expected,
            }
        except Exception as exc:
            errors.append(f"crm: {exc}")
    else:
        errors.append("crm: signature missing")

    raise ReleaseSignatureError(
        "No valid release signature available. " + " | ".join(errors)
    )


def verify_package_signature(
    *,
    package_path: str | Path,
    public_key: str | Path,
    signature_path: str | Path,
) -> None:
    proc = subprocess.run(
        [
            "openssl", "dgst",
            "-sha256",
            "-verify", str(public_key),
            "-signature", str(signature_path),
            str(package_path),
        ],
        capture_output=True,
        text=True,
    )

    output = "\n".join(
        part for part in (proc.stdout.strip(), proc.stderr.strip()) if part
    )

    if proc.returncode != 0 or "Verified OK" not in proc.stdout:
        raise ReleaseSignatureError(
            "Digital signature verification failed"
            + (f": {output}" if output else "")
        )


# ---------------------------------------------------------------------------
# INTEGRATION EXAMPLE
# ---------------------------------------------------------------------------
#
# Replace the old "decode CRM signature -> release.sig -> openssl verify" block
# with:
#
# signature_info = resolve_release_signature(
#     package_url=release_data["package_url"],
#     crm_signature=release_data.get("signature"),
#     public_key="/etc/amt/keys/amt-release-public.pem",
#     signature_path="/var/lib/amt-updater/release.sig",
# )
#
# logger.info(
#     "Release signature source=%s b64=%s bytes=%s sha256=%s",
#     signature_info["source"],
#     signature_info["base64_length"],
#     signature_info["decoded_length"],
#     signature_info["sha256"],
# )
#
# verify_package_signature(
#     package_path=package_path,
#     public_key="/etc/amt/keys/amt-release-public.pem",
#     signature_path="/var/lib/amt-updater/release.sig",
# )
