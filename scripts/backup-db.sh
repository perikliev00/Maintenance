#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_S3_URI:?BACKUP_S3_URI must point to an off-host S3 bucket/prefix}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required for client-side encryption}"
command -v pg_dump >/dev/null
command -v age >/dev/null
command -v aws >/dev/null

umask 077
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT HUP INT TERM
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
object="maintenance-${stamp}.dump.age"
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl \
  | age --recipient "$BACKUP_AGE_RECIPIENT" --output "$tmp"
aws s3 cp "$tmp" "${BACKUP_S3_URI%/}/$object" --only-show-errors --sse AES256

if [ -n "${BACKUP_METRICS_FILE:-}" ]; then
  mkdir -p "$(dirname "$BACKUP_METRICS_FILE")"
  printf 'backup_last_success_timestamp_seconds %s\n' "$(date -u +%s)" > "${BACKUP_METRICS_FILE}.tmp"
  mv "${BACKUP_METRICS_FILE}.tmp" "$BACKUP_METRICS_FILE"
fi
if [ -n "${BACKUP_HEARTBEAT_URL:-}" ]; then
  curl --fail --silent --show-error --max-time 10 "$BACKUP_HEARTBEAT_URL" >/dev/null
fi
printf 'Uploaded encrypted database backup %s\n' "$object"
