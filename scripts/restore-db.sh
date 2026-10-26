#!/usr/bin/env bash
# Restore an age-encrypted custom-format dump into a disposable database only.
# Production-like: BACKUP_OBJECT_URI (s3://...) + aws + age identity.
# Local drill: BACKUP_LOCAL_FILE=/path/to/*.dump.age (no S3 required).
set -euo pipefail

: "${BACKUP_AGE_IDENTITY_FILE:?BACKUP_AGE_IDENTITY_FILE must point to a protected age identity file}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL must target an isolated disposable database}"
: "${RESTORE_DATABASE_NAME:?RESTORE_DATABASE_NAME is required}"
[ "${RESTORE_DISPOSABLE_CONFIRMED:-}" = true ] || { echo 'Set RESTORE_DISPOSABLE_CONFIRMED=true after verifying the target is disposable.' >&2; exit 2; }
[ "${NODE_ENV:-}" != production ] || { echo 'Restore drill is disabled when NODE_ENV=production.' >&2; exit 2; }
actual_db="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.urlparse(sys.argv[1]).path.strip("/").split("/")[-1])' "$RESTORE_DATABASE_URL")"
[ "${RESTORE_DATABASE_NAME}" = "$actual_db" ] || { echo 'RESTORE_DATABASE_NAME does not match the URL database.' >&2; exit 2; }
case "$RESTORE_DATABASE_NAME" in production|prod|maintenance) echo 'Refusing a potentially live database name.' >&2; exit 2;; esac
command -v age >/dev/null; command -v pg_restore >/dev/null; command -v psql >/dev/null

if [ -z "${BACKUP_OBJECT_URI:-}" ] && [ -z "${BACKUP_LOCAL_FILE:-}" ]; then
  echo 'Set BACKUP_OBJECT_URI (s3://...) or BACKUP_LOCAL_FILE (local .dump.age).' >&2
  exit 2
fi
if [ -n "${BACKUP_OBJECT_URI:-}" ]; then
  command -v aws >/dev/null
fi

umask 077
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT HUP INT TERM

if [ -n "${BACKUP_LOCAL_FILE:-}" ]; then
  [ -f "$BACKUP_LOCAL_FILE" ] || { echo "BACKUP_LOCAL_FILE not found: $BACKUP_LOCAL_FILE" >&2; exit 2; }
  age --decrypt --identity "$BACKUP_AGE_IDENTITY_FILE" --output "$tmp" "$BACKUP_LOCAL_FILE"
else
  aws s3 cp "$BACKUP_OBJECT_URI" - --only-show-errors | age --decrypt --identity "$BACKUP_AGE_IDENTITY_FILE" > "$tmp"
fi

pg_restore --dbname="$RESTORE_DATABASE_URL" --clean --if-exists --no-owner --no-acl "$tmp"
pg_restore --list "$tmp" >/dev/null
user_count="$(psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc 'SELECT count(*) FROM "User"')"
migration_count="$(psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc 'SELECT count(*) FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL')"
[ "$user_count" -gt 0 ] || { echo 'Restored database has no user rows; verification failed.' >&2; exit 1; }
[ "$migration_count" -gt 0 ] || { echo 'Restored database has no applied migration rows; verification failed.' >&2; exit 1; }
printf 'Restore and schema/data verification succeeded for disposable database %s (users=%s migrations=%s)\n' \
  "$RESTORE_DATABASE_NAME" "$user_count" "$migration_count"
