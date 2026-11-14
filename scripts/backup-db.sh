#!/usr/bin/env bash
# Encrypted PostgreSQL backup → off-host S3, or local directory for drills.
# Production: set BACKUP_S3_URI + BACKUP_AGE_RECIPIENT (+ aws credentials).
# Local drill: set BACKUP_LOCAL_DIR + BACKUP_AGE_RECIPIENT (no S3 required).
# Exit on error, treat unset variables as errors, and fail pipelines on any stage failure.
set -euo pipefail

# Require a PostgreSQL connection string for pg_dump.
: "${DATABASE_URL:?DATABASE_URL is required}"
# Require an age public key/recipient so dumps are encrypted client-side before storage.
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required for client-side encryption}"
# Ensure the PostgreSQL dump utility is available on PATH.
command -v pg_dump >/dev/null
# Ensure the age encryption CLI is available on PATH.
command -v age >/dev/null

# Require either an S3 destination or a local drill directory.
if [ -z "${BACKUP_S3_URI:-}" ] && [ -z "${BACKUP_LOCAL_DIR:-}" ]; then
  # Explain the missing destination configuration on stderr.
  echo 'Set BACKUP_S3_URI (production) or BACKUP_LOCAL_DIR (local drill).' >&2
  # Abort with a distinct configuration-error exit code.
  exit 2
fi
# When uploading to S3, require the AWS CLI.
if [ -n "${BACKUP_S3_URI:-}" ]; then
  # Fail early if aws is missing before dumping the database.
  command -v aws >/dev/null
fi

# Restrict newly created temp files to the current user only.
umask 077
# Create a temporary file for the encrypted dump payload.
tmp="$(mktemp)"
# Delete the temp file on exit or common termination signals.
trap 'rm -f "$tmp"' EXIT HUP INT TERM
# Build a UTC timestamp stamp for the backup object name.
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
# Compose the encrypted dump filename including the timestamp.
object="maintenance-${stamp}.dump.age"
# Dump the database in custom format without ownership/ACL metadata,
# then encrypt the stream with age into the temporary file.
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl \
  | age --recipient "$BACKUP_AGE_RECIPIENT" --output "$tmp"

# Prefer a local destination when BACKUP_LOCAL_DIR is set (restore drills).
if [ -n "${BACKUP_LOCAL_DIR:-}" ]; then
  # Ensure the local backup directory exists.
  mkdir -p "$BACKUP_LOCAL_DIR"
  # Build the final local path for the encrypted object.
  dest="${BACKUP_LOCAL_DIR%/}/$object"
  # Copy the encrypted dump into the local drill directory.
  cp "$tmp" "$dest"
  # Restrict permissions on the stored encrypted backup.
  chmod 600 "$dest"
  # Report the local path that was written.
  printf 'Wrote encrypted database backup %s\n' "$dest"
else
  # Upload the encrypted dump to S3 with server-side AES256 encryption.
  aws s3 cp "$tmp" "${BACKUP_S3_URI%/}/$object" --only-show-errors --sse AES256
  # Report the uploaded object key.
  printf 'Uploaded encrypted database backup %s\n' "$object"
fi

# Optionally publish a Prometheus-style success timestamp metric file.
if [ -n "${BACKUP_METRICS_FILE:-}" ]; then
  # Ensure the metrics file parent directory exists.
  mkdir -p "$(dirname "$BACKUP_METRICS_FILE")"
  # Atomically write the success timestamp via a temporary sibling file.
  printf 'backup_last_success_timestamp_seconds %s\n' "$(date -u +%s)" > "${BACKUP_METRICS_FILE}.tmp"
  # Replace the metrics file only after the write succeeds.
  mv "${BACKUP_METRICS_FILE}.tmp" "$BACKUP_METRICS_FILE"
fi
# Optionally ping an external heartbeat URL after a successful backup.
if [ -n "${BACKUP_HEARTBEAT_URL:-}" ]; then
  # Fail the script if the heartbeat request does not succeed quickly.
  curl --fail --silent --show-error --max-time 10 "$BACKUP_HEARTBEAT_URL" >/dev/null
fi
