#!/usr/bin/env bash
# Thin wrapper: force disposable confirmation and development NODE_ENV, then restore.
set -euo pipefail
: "${RESTORE_DATABASE_URL:?Point this to a newly created isolated database}"
: "${RESTORE_DATABASE_NAME:?Set the isolated database name}"
if [ -z "${BACKUP_OBJECT_URI:-}" ] && [ -z "${BACKUP_LOCAL_FILE:-}" ]; then
  echo 'Set BACKUP_OBJECT_URI or BACKUP_LOCAL_FILE to a selected backup object' >&2
  exit 2
fi
RESTORE_DISPOSABLE_CONFIRMED=true
NODE_ENV=development
export RESTORE_DISPOSABLE_CONFIRMED NODE_ENV
"$(dirname "$0")/restore-db.sh"
