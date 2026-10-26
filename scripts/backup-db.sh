#!/usr/bin/env bash
# Encrypted PostgreSQL backup → off-host S3, or local directory for drills.
# Production: set BACKUP_S3_URI + BACKUP_AGE_RECIPIENT (+ aws credentials).
# Local drill: set BACKUP_LOCAL_DIR + BACKUP_AGE_RECIPIENT (no S3 required).
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required for client-side encryption}"
command -v pg_dump >/dev/null
command -v age >/dev/null

if [ -z "${BACKUP_S3_URI:-}" ] && [ -z "${BACKUP_LOCAL_DIR:-}" ]; then
  echo 'Set BACKUP_S3_URI (production) or BACKUP_LOCAL_DIR (local drill).' >&2
  exit 2
fi
if [ -n "${BACKUP_S3_URI:-}" ]; then
  command -v aws >/dev/null
fi

umask 077
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT HUP INT TERM
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
object="maintenance-${stamp}.dump.age"
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl \
  | age --recipient "$BACKUP_AGE_RECIPIENT" --output "$tmp"

if [ -n "${BACKUP_LOCAL_DIR:-}" ]; then
  mkdir -p "$BACKUP_LOCAL_DIR"
  dest="${BACKUP_LOCAL_DIR%/}/$object"
  cp "$tmp" "$dest"
  chmod 600 "$dest"
  printf 'Wrote encrypted database backup %s\n' "$dest"
else
  aws s3 cp "$tmp" "${BACKUP_S3_URI%/}/$object" --only-show-errors --sse AES256
  printf 'Uploaded encrypted database backup %s\n' "$object"
fi

if [ -n "${BACKUP_METRICS_FILE:-}" ]; then
  mkdir -p "$(dirname "$BACKUP_METRICS_FILE")"
  printf 'backup_last_success_timestamp_seconds %s\n' "$(date -u +%s)" > "${BACKUP_METRICS_FILE}.tmp"
  mv "${BACKUP_METRICS_FILE}.tmp" "$BACKUP_METRICS_FILE"
fi
if [ -n "${BACKUP_HEARTBEAT_URL:-}" ]; then
  curl --fail --silent --show-error --max-time 10 "$BACKUP_HEARTBEAT_URL" >/dev/null
fi
