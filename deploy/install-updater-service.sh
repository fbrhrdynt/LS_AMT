#!/bin/bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo."
  exit 1
fi

REPO="/opt/amt"

install -d -o ubuntu -g ubuntu -m 0750 /var/lib/amt-updater
install -d -o root -g root -m 0755 /opt/amt-update-backups
install -d -o root -g root -m 0755 /etc/amt/keys

install -o root -g root -m 0755 \
  "$REPO/deploy/amt-update-runner" \
  /usr/local/sbin/amt-update-runner

install -o root -g root -m 0755 \
  "$REPO/deploy/amt-update-trigger" \
  /usr/local/sbin/amt-update-trigger

install -o root -g root -m 0644 \
  "$REPO/deploy/amt-updater.service" \
  /etc/systemd/system/amt-updater.service

install -o root -g root -m 0440 \
  "$REPO/deploy/amt-updater.sudoers" \
  /etc/sudoers.d/amt-updater

visudo -cf /etc/sudoers.d/amt-updater

if [ ! -f /etc/amt/keys/amt-release-public.pem ]; then
  if [ -f /opt/amt-signing/amt-release-public.pem ]; then
    install -o root -g root -m 0644 \
      /opt/amt-signing/amt-release-public.pem \
      /etc/amt/keys/amt-release-public.pem
  else
    echo "ERROR: release public key not found."
    exit 1
  fi
fi

command -v rsync >/dev/null || {
  echo "ERROR: rsync is required."
  exit 1
}

command -v mongodump >/dev/null || {
  echo "ERROR: mongodump is required."
  exit 1
}

command -v openssl >/dev/null || {
  echo "ERROR: openssl is required."
  exit 1
}

systemctl daemon-reload

sudo -u ubuntu sudo -n -l \
  /usr/local/sbin/amt-update-trigger >/dev/null

echo "AMT secure updater installed."
