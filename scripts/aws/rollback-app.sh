#!/usr/bin/env bash
# Application-only rollback to the previous RELEASE_SHA.
# Never rolls back the database. Requires schema compatibility (expand/contract).
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/maintenance}"
ENV_FILE="${ENV_FILE:-/etc/maintenance/.env.production}"
STATE_DIR="${STATE_DIR:-/var/lib/maintenance}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yml}"

if [[ "${ROLLBACK_CONFIRM:-}" != "ROLLBACK_APP" ]]; then
  echo "Set ROLLBACK_CONFIRM=ROLLBACK_APP to proceed with application-only rollback" >&2
  exit 2
fi

[[ -f "$STATE_DIR/previous-release-sha" ]] || {
  echo "No previous-release-sha recorded; cannot rollback automatically" >&2
  exit 2
}

RELEASE_SHA="$(tr -d '[:space:]' <"$STATE_DIR/previous-release-sha")"
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo "previous-release-sha is not a valid git SHA" >&2
  exit 2
}

export RELEASE_SHA DEPLOY_PATH ENV_FILE STATE_DIR COMPOSE_FILE
echo "Rolling back application to $RELEASE_SHA (no database rollback) ..."
promote="$(dirname "$0")/promote-release.sh"
if [[ ! -x "$promote" ]]; then
  promote=/usr/local/bin/maintenance-promote-release.sh
fi
exec "$promote"
