#!/usr/bin/env python3
"""
Server/CRM validation for AMT release-signature metadata.

Important:
- Do NOT define a 464-character (or other too-small) max_length for `signature`.
- Store the signature as an unbounded text/string field.
- With the current RSA-3072 key, the normalized Base64 is 512 characters
  and decodes to 384 bytes.
"""

from __future__ import annotations

import base64
import binascii
import subprocess
import re
from pathlib import Path


class ReleaseMetadataError(ValueError):
    pass


def expected_rsa_signature_bytes(public_key: str | Path) -> int:
    proc = subprocess.run(
        ["openssl", "pkey", "-pubin", "-in", str(public_key), "-text", "-noout"],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise ReleaseMetadataError(
            proc.stderr.strip() or "Could not inspect public key"
        )

    match = re.search(r"Public-Key:\s*\((\d+)\s*bit\)", proc.stdout)
    if not match:
        raise ReleaseMetadataError("Could not determine RSA public-key size")

    return int(match.group(1)) // 8


def validate_release_signature(
    value: str,
    *,
    public_key: str | Path,
) -> str:
    clean = "".join(str(value or "").split())

    if not clean:
        raise ReleaseMetadataError("Release signature is required")

    try:
        decoded = base64.b64decode(clean, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ReleaseMetadataError(
            f"Release signature is not valid Base64: {exc}"
        ) from exc

    expected = expected_rsa_signature_bytes(public_key)
    if len(decoded) != expected:
        raise ReleaseMetadataError(
            f"Incomplete release signature: decoded {len(decoded)} bytes; "
            f"expected {expected} bytes (Base64 chars={len(clean)})"
        )

    return clean


# FastAPI / Pydantic v2 example:
#
# from pydantic import BaseModel, field_validator
#
# class ReleaseCreate(BaseModel):
#     version: str
#     package_url: str
#     sha256: str
#     signature: str          # IMPORTANT: no max_length=464
#
#     @field_validator("signature")
#     @classmethod
#     def validate_signature(cls, value: str) -> str:
#         return validate_release_signature(
#             value,
#             public_key="/etc/amt/keys/amt-release-public.pem",
#         )
#
# Frontend:
# - Remove maxLength={464} (or any limit < 512) from the signature input.
# - Prefer a textarea.
# - Submit the entire 512-character normalized Base64 string.
#
# Database:
# - Use TEXT / unbounded string storage for this field.
