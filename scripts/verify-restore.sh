#!/usr/bin/env bash
set -euo pipefail
: "${BACKUP_OBJECT_URI:?Set BACKUP_OBJECT_URI to a selected backup object}"
: "${RESTORE_DATABASE_URL:?Point this to a newly created isolated database}"
: "${RESTORE_DATABASE_NAME:?Set the isolated database name}"
RESTORE_DISPOSABLE_CONFIRMED=true
NODE_ENV=development
export RESTORE_DISPOSABLE_CONFIRMED NODE_ENV
"$(dirname "$0")/restore-db.sh"
