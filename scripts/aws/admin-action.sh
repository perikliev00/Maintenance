#!/usr/bin/env bash
# Allowlisted admin actions for SSM document maintenance-admin-shell.
# Refuses destructive database operations.
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/maintenance}"
ENV_FILE="${ENV_FILE:-/etc/maintenance/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yml}"

if [[ "${APPROVAL_TOKEN:-}" != "ADMIN_APPROVED" ]]; then
  echo "Set APPROVAL_TOKEN=ADMIN_APPROVED for admin actions" >&2
  exit 2
fi

: "${ADMIN_ACTION:?ADMIN_ACTION is required}"

case "$ADMIN_ACTION" in
  restart-stack)
    systemctl restart maintenance-stack.service
    systemctl --no-pager --full status maintenance-stack.service || true
    ;;
  status)
    /usr/local/bin/maintenance-host-health.sh || true
    systemctl --no-pager --full status maintenance-stack.service || true
    ;;
  journal-backup)
    journalctl -u maintenance-backup.service -n 100 --no-pager
    ;;
  compose-ps)
    cd "$DEPLOY_PATH"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
    ;;
  *)
    echo "Unsupported ADMIN_ACTION=$ADMIN_ACTION (refusing arbitrary shell)" >&2
    exit 2
    ;;
esac
