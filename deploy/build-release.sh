#!/bin/bash
set -euo pipefail

VERSION="${1:-}"
CHANNEL="${2:-stable}"
MIN_VERSION="${3:-1.0.0}"

REPO="/opt/amt"
RELEASE_ROOT="/opt/amt-releases/releases"
PRIVATE_KEY="/opt/amt-signing/amt-release-private.pem"
PUBLIC_KEY="/etc/amt/keys/amt-release-public.pem"
RELEASE_HOST="https://release.logisourcedigital.web.id"
GIT_USER="${SUDO_USER:-ubuntu}"

git_user() {
  sudo -u "$GIT_USER" -H git -C "$REPO" "$@"
}

SEMVER_RE='^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$'

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[ -n "$VERSION" ] || fail "Usage: sudo bash deploy/build-release.sh <version> [stable|beta|dev] [min_supported_version]"
[[ "$VERSION" =~ $SEMVER_RE ]] || fail "Invalid version: $VERSION"
[[ "$MIN_VERSION" =~ $SEMVER_RE ]] || fail "Invalid minimum supported version: $MIN_VERSION"

case "$CHANNEL" in
  stable|beta|dev) ;;
  *) fail "Channel must be stable, beta, or dev" ;;
esac

[ "$(id -u)" -eq 0 ] || fail "Run with sudo."
[ -d "$REPO/.git" ] || fail "Git repository not found at $REPO"
[ -f "$PRIVATE_KEY" ] || fail "Private signing key not found: $PRIVATE_KEY"
[ -f "$PUBLIC_KEY" ] || fail "Public verification key not found: $PUBLIC_KEY"

for cmd in git tar openssl sha256sum rsync curl; do
  command -v "$cmd" >/dev/null || fail "Required command not found: $cmd"
done

cd "$REPO"

BRANCH="$(git_user branch --show-current)"
[ "$BRANCH" = "main" ] || fail "Release must be built from main. Current branch: $BRANCH"

git_user diff --quiet || fail "Tracked working tree has uncommitted changes."
git_user diff --cached --quiet || fail "Staged changes exist."

git_user fetch origin main --quiet

LOCAL_HEAD="$(git_user rev-parse HEAD)"
REMOTE_HEAD="$(git_user rev-parse origin/main)"

[ "$LOCAL_HEAD" = "$REMOTE_HEAD" ] || fail "Local main is not exactly origin/main."

SHORT_COMMIT="$(git_user rev-parse --short=12 HEAD)"
FULL_COMMIT="$(git_user rev-parse HEAD)"

TARGET_DIR="$RELEASE_ROOT/$VERSION"
PACKAGE_NAME="amt-$VERSION.tar.gz"
SIG_NAME="amt-$VERSION.sig"
PACKAGE="$TARGET_DIR/$PACKAGE_NAME"
SIG="$TARGET_DIR/$SIG_NAME"
MANIFEST="$TARGET_DIR/manifest.json"
CRM_INFO="$TARGET_DIR/crm-release.txt"

if [ -e "$PACKAGE" ] || [ -e "$MANIFEST" ]; then
  fail "Release $VERSION already exists. Published versions are immutable; use a new version."
fi

TMP="$(mktemp -d /tmp/amt-release-${VERSION}.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

SOURCE="$TMP/source"
mkdir -p "$SOURCE"

echo "Building AMT $VERSION from commit $SHORT_COMMIT..."

# Export only committed files. Untracked patches, env, storage, venv,
# node_modules and build output are not part of git archive.
git_user archive --format=tar HEAD | tar -xf - -C "$SOURCE"

# Runtime version is stored in /var/lib/amt-updater/current-version.
# Keep the tracked VERSION file unchanged so self-updates do not dirty Git.

# Never ship local secrets/runtime directories even if accidentally tracked later.
rm -f "$SOURCE/backend/.env"
rm -rf \
  "$SOURCE/backend/venv" \
  "$SOURCE/frontend/node_modules" \
  "$SOURCE/frontend/build" \
  "$SOURCE/storage" \
  "$SOURCE/patches" \
  "$SOURCE/backups" \
  "$SOURCE/.git"

mkdir -p "$TARGET_DIR"

# Stable archive ordering improves reproducibility.
tar \
  --sort=name \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  --mtime='UTC 2026-01-01' \
  -C "$SOURCE" \
  -czf "$PACKAGE" \
  .

SHA256="$(sha256sum "$PACKAGE" | awk '{print $1}')"

openssl dgst \
  -sha256 \
  -sign "$PRIVATE_KEY" \
  -out "$SIG" \
  "$PACKAGE"

VERIFY_OUTPUT="$(
  openssl dgst \
    -sha256 \
    -verify "$PUBLIC_KEY" \
    -signature "$SIG" \
    "$PACKAGE"
)"

[ "$VERIFY_OUTPUT" = "Verified OK" ] || fail "Signature verification failed: $VERIFY_OUTPUT"

SIGNATURE_B64="$(base64 -w0 "$SIG")"
SIZE_BYTES="$(stat -c '%s' "$PACKAGE")"
CREATED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
PACKAGE_URL="$RELEASE_HOST/releases/$VERSION/$PACKAGE_NAME"
SIG_URL="$RELEASE_HOST/releases/$VERSION/$SIG_NAME"

cat > "$MANIFEST" <<EOF
{
  "product_slug": "ls-amt-baroid-uae",
  "version": "$VERSION",
  "channel": "$CHANNEL",
  "git_commit": "$FULL_COMMIT",
  "created_at": "$CREATED_AT",
  "package_filename": "$PACKAGE_NAME",
  "package_url": "$PACKAGE_URL",
  "signature_url": "$SIG_URL",
  "size_bytes": $SIZE_BYTES,
  "sha256": "$SHA256",
  "signature": "$SIGNATURE_B64",
  "min_supported_version": "$MIN_VERSION",
  "has_database_migration": false,
  "requires_restart": true
}
EOF

cat > "$CRM_INFO" <<EOF
PRODUCT SLUG
ls-amt-baroid-uae

VERSION
$VERSION

CHANNEL
$CHANNEL

TITLE
AMT $VERSION

PACKAGE URL
$PACKAGE_URL

SHA256
$SHA256

SIGNATURE
$SIGNATURE_B64

MINIMUM SUPPORTED VERSION
$MIN_VERSION

HAS DATABASE MIGRATION
false

REQUIRES RESTART
true

GIT COMMIT
$FULL_COMMIT
EOF

chown -R www-data:www-data "$TARGET_DIR"
find "$TARGET_DIR" -type d -exec chmod 755 {} \;
find "$TARGET_DIR" -type f -exec chmod 644 {} \;

echo
echo "Local verification:"
echo "  SHA256:     $SHA256"
echo "  Signature:  Verified OK"
echo
echo "Testing HTTPS release URL..."
HTTP_CODE="$(
  curl -sS -o /dev/null -w '%{http_code}' "$PACKAGE_URL"
)"

[ "$HTTP_CODE" = "200" ] || fail "Release URL returned HTTP $HTTP_CODE"

REMOTE_SHA="$(
  curl -sS "$PACKAGE_URL" | sha256sum | awk '{print $1}'
)"

[ "$REMOTE_SHA" = "$SHA256" ] || fail "Remote package SHA256 mismatch."

echo
echo "AMT release $VERSION is ready."
echo "Package:  $PACKAGE_URL"
echo "SHA256:   $SHA256"
echo "Signature verification: Verified OK"
echo
echo "CRM values:"
echo "----------------------------------------"
cat "$CRM_INFO"
echo "----------------------------------------"
echo
echo "Do not rebuild this version. If anything changes, create a new version."
