#!/usr/bin/env bash
# Thin wrapper: force disposable confirmation and development NODE_ENV, then restore.
# Exit on error, treat unset variables as errors, and fail pipelines on any stage failure.
set -euo pipefail
# Require a connection string pointing at a newly created isolated database.
: "${RESTORE_DATABASE_URL:?Point this to a newly created isolated database}"
# Require the isolated database name used for verification checks.
: "${RESTORE_DATABASE_NAME:?Set the isolated database name}"
# Require either an S3 object URI or a local encrypted dump file.
if [ -z "${BACKUP_OBJECT_URI:-}" ] && [ -z "${BACKUP_LOCAL_FILE:-}" ]; then
  echo 'Set BACKUP_OBJECT_URI or BACKUP_LOCAL_FILE to a selected backup object' >&2
  exit 2
fi
# Confirm to restore-db.sh that the target database is disposable.
RESTORE_DISPOSABLE_CONFIRMED=true
# Force non-production NODE_ENV so restore-db.sh will not refuse the drill.
NODE_ENV=development
# Export the safety flags for the child restore script.
export RESTORE_DISPOSABLE_CONFIRMED NODE_ENV
# Invoke the sibling restore-db.sh next to this wrapper.
"$(dirname "$0")/restore-db.sh"
