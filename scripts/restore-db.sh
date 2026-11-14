#!/usr/bin/env bash
# Restore an age-encrypted custom-format dump into a disposable database only.
# Production-like: BACKUP_OBJECT_URI (s3://...) + aws + age identity.
# Local drill: BACKUP_LOCAL_FILE=/path/to/*.dump.age (no S3 required).
# Exit on error, treat unset variables as errors, and fail pipelines on any stage failure.
set -euo pipefail

# Require a protected age identity file for decryption.
: "${BACKUP_AGE_IDENTITY_FILE:?BACKUP_AGE_IDENTITY_FILE must point to a protected age identity file}"
# Require a connection string that targets an isolated disposable database.
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL must target an isolated disposable database}"
# Require the expected disposable database name for cross-checks.
: "${RESTORE_DATABASE_NAME:?RESTORE_DATABASE_NAME is required}"
# Refuse to continue unless the operator explicitly confirmed disposability.
[ "${RESTORE_DISPOSABLE_CONFIRMED:-}" = true ] || { echo 'Set RESTORE_DISPOSABLE_CONFIRMED=true after verifying the target is disposable.' >&2; exit 2; }
# Refuse restores when NODE_ENV indicates a production runtime.
[ "${NODE_ENV:-}" != production ] || { echo 'Restore drill is disabled when NODE_ENV=production.' >&2; exit 2; }
# Parse the database name from the restore URL path for verification.
actual_db="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.urlparse(sys.argv[1]).path.strip("/").split("/")[-1])' "$RESTORE_DATABASE_URL")"
# Ensure the declared database name matches the URL database name.
[ "${RESTORE_DATABASE_NAME}" = "$actual_db" ] || { echo 'RESTORE_DATABASE_NAME does not match the URL database.' >&2; exit 2; }
# Refuse common live database names as an extra safety gate.
case "$RESTORE_DATABASE_NAME" in production|prod|maintenance) echo 'Refusing a potentially live database name.' >&2; exit 2;; esac
# Ensure age, pg_restore, and psql are available before downloading/decrypting.
command -v age >/dev/null; command -v pg_restore >/dev/null; command -v psql >/dev/null

# Require either an S3 object URI or a local encrypted dump file.
if [ -z "${BACKUP_OBJECT_URI:-}" ] && [ -z "${BACKUP_LOCAL_FILE:-}" ]; then
  echo 'Set BACKUP_OBJECT_URI (s3://...) or BACKUP_LOCAL_FILE (local .dump.age).' >&2
  exit 2
fi
# When restoring from S3, require the AWS CLI.
if [ -n "${BACKUP_OBJECT_URI:-}" ]; then
  command -v aws >/dev/null
fi

# Restrict permissions on temporary decrypted dump files.
umask 077
# Create a temporary file for the decrypted custom-format dump.
tmp="$(mktemp)"
# Delete the temporary dump on exit or termination signals.
trap 'rm -f "$tmp"' EXIT HUP INT TERM

# Prefer a local encrypted dump when BACKUP_LOCAL_FILE is set.
if [ -n "${BACKUP_LOCAL_FILE:-}" ]; then
  # Fail fast if the local encrypted dump path does not exist.
  [ -f "$BACKUP_LOCAL_FILE" ] || { echo "BACKUP_LOCAL_FILE not found: $BACKUP_LOCAL_FILE" >&2; exit 2; }
  # Decrypt the local age file into the temporary dump path.
  age --decrypt --identity "$BACKUP_AGE_IDENTITY_FILE" --output "$tmp" "$BACKUP_LOCAL_FILE"
else
  # Stream the S3 object through age decryption into the temporary dump path.
  aws s3 cp "$BACKUP_OBJECT_URI" - --only-show-errors | age --decrypt --identity "$BACKUP_AGE_IDENTITY_FILE" > "$tmp"
fi

# Restore the custom-format dump into the disposable database.
pg_restore --dbname="$RESTORE_DATABASE_URL" --clean --if-exists --no-owner --no-acl "$tmp"
# Sanity-check that the dump TOC can still be listed after restore prep.
pg_restore --list "$tmp" >/dev/null
# Count restored User rows as a basic data verification gate.
user_count="$(psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc 'SELECT count(*) FROM "User"')"
# Count applied Prisma migrations as a schema verification gate.
migration_count="$(psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc 'SELECT count(*) FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL')"
# Fail if no users were restored.
[ "$user_count" -gt 0 ] || { echo 'Restored database has no user rows; verification failed.' >&2; exit 1; }
# Fail if no applied migrations were restored.
[ "$migration_count" -gt 0 ] || { echo 'Restored database has no applied migration rows; verification failed.' >&2; exit 1; }
# Report successful restore verification with counts.
printf 'Restore and schema/data verification succeeded for disposable database %s (users=%s migrations=%s)\n' \
  "$RESTORE_DATABASE_NAME" "$user_count" "$migration_count"
