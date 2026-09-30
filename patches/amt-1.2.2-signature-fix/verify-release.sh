#!/usr/bin/env bash
# Verify a release before publishing it to clients.
# Usage:
#   sudo bash verify-release.sh 1.2.2

set -u

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  exit 2
fi

ROOT="/opt/amt-releases/releases/$VERSION"
PKG="$ROOT/amt-$VERSION.tar.gz"
SIG_B64="$ROOT/signature-base64.txt"
PUB="/etc/amt/keys/amt-release-public.pem"
TMP_SIG="/tmp/amt-$VERSION.release.sig"

echo "=== AMT RELEASE PRE-PUBLISH CHECK: $VERSION ==="

for f in "$PKG" "$SIG_B64" "$PUB"; do
  if [ ! -f "$f" ]; then
    echo "MISSING: $f"
    exit 1
  fi
done

tr -d '\r\n\t ' < "$SIG_B64" > "/tmp/amt-$VERSION.signature.b64"

B64_LEN="$(wc -c < "/tmp/amt-$VERSION.signature.b64")"
echo "Base64 chars: $B64_LEN"

if ! base64 -d "/tmp/amt-$VERSION.signature.b64" > "$TMP_SIG"; then
  echo "FAIL: signature is not valid Base64"
  exit 1
fi

BITS="$(
  openssl pkey -pubin -in "$PUB" -text -noout 2>/dev/null |
  sed -n 's/.*Public-Key: (\([0-9][0-9]*\) bit).*/\1/p' |
  head -1
)"

if [ -z "$BITS" ]; then
  echo "FAIL: cannot determine RSA public-key size"
  exit 1
fi

EXPECTED_BYTES="$((BITS / 8))"
ACTUAL_BYTES="$(wc -c < "$TMP_SIG")"

echo "RSA key bits : $BITS"
echo "Expected sig : $EXPECTED_BYTES bytes"
echo "Actual sig   : $ACTUAL_BYTES bytes"

if [ "$ACTUAL_BYTES" -ne "$EXPECTED_BYTES" ]; then
  echo "FAIL: signature length mismatch"
  exit 1
fi

echo
echo "Package SHA256:"
sha256sum "$PKG"

echo
echo "Signature SHA256:"
sha256sum "$TMP_SIG"

echo
echo "OpenSSL verification:"
if ! openssl dgst \
  -sha256 \
  -verify "$PUB" \
  -signature "$TMP_SIG" \
  "$PKG"
then
  echo "FAIL: digital signature verification failed"
  exit 1
fi

echo
echo "PASS: release package and signature are publishable."
