# AMT 1.2.2 signature-fix bundle

The observed 1.2.1 failure is consistent with signature metadata truncation:

- RSA public key: 3072 bit
- Correct signature: 384 binary bytes / 512 Base64 characters
- Failed client signature: 348 binary bytes
- Direct `signature-base64.txt` from the release server decodes to 384 bytes and verifies successfully.

## Apply order

1. Fix CRM/API storage/input first so it preserves the complete signature.
   - Remove any `maxLength`, `max_length`, `VARCHAR(464)`, slicing such as `[:464]`, or similar truncation.
   - Store the field as TEXT/unbounded string.
   - Add the validation in `crm_signature_validator.py`.

2. Patch the updater.
   - Add `updater_signature.py` to the updater source.
   - Replace the existing signature decode/write/verify block with the integration example at the bottom of that file.
   - The release server's sibling `signature-base64.txt` becomes authoritative; CRM is fallback only.

3. Build AMT 1.2.2.

4. Before publishing, run:
   `sudo bash verify-release.sh 1.2.2`

5. Publish 1.2.2 only after the pre-publish check prints:
   `PASS: release package and signature are publishable.`

## Bootstrap warning

Clients that still run the old updater must receive a complete 512-character signature for 1.2.2 through the existing CRM/API path. Therefore the CRM truncation must be fixed before publishing 1.2.2. Once 1.2.2 is installed, future updates are protected by the canonical release-server signature fallback.
