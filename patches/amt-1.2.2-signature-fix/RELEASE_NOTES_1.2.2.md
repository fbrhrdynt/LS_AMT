# AMT 1.2.2 — Release Signature Transport Fix

Release date: 30 September 2026

## Fixed

- Fixed client update failures caused by an incomplete RSA-3072 release signature reaching the updater.
- The updater now prefers the canonical `signature-base64.txt` stored beside the release package on the release server.
- CRM/API signature metadata is retained only as a validated fallback.
- Added strict Base64 validation before digital-signature verification.
- Added RSA signature-length validation derived from the installed public key.
- Added clearer diagnostics for signature source, Base64 length, decoded byte length, and signature SHA256.
- Release publication validation now rejects incomplete or malformed signatures before a release is exposed to clients.

## Security

- Package SHA256 verification remains mandatory.
- RSA public-key digital-signature verification remains mandatory.
- No signature-verification bypass was added.
- The updater fails closed if neither the canonical release signature nor the CRM fallback is valid.

## Compatibility

- No AMT application data migration is required.
- No database schema migration is required for the AMT application itself.
- The CRM release-signature field must preserve the complete Base64 value without truncation.

## Verified failure addressed

For the current RSA-3072 release key:

- Expected binary signature length: `384 bytes`
- Expected Base64 signature length: `512 characters`
- The failed client received only `348 bytes` after decoding, which corresponds to a truncated Base64 value.
