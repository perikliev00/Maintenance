#!/usr/bin/env bash
# Run encrypted pg_dump against Postgres on the Compose internal backend network.
# Fixes host-side DATABASE_URL=...@db:5432/... which is unreachable from the host namespace.
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/maintenance}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-maintenance}"
BACKEND_NETWORK="${BACKEND_NETWORK:-${COMPOSE_PROJECT}_backend}"
PG_IMAGE="${PG_IMAGE:-postgres:16.10-alpine}"
ENV_FILE="${BACKUP_ENV_FILE:-/etc/maintenance/backup.env}"

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

: "${DATABASE_URL:?DATABASE_URL is required in backup env}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"
: "${BACKUP_S3_URI:?BACKUP_S3_URI is required for production backups}"

if [[ -n "${BACKUP_ROLE_ARN:-}" ]]; then
  creds="$(aws sts assume-role \
    --role-arn "$BACKUP_ROLE_ARN" \
    --role-session-name maintenance-backup \
    --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
    --output text)"
  # Avoid printing credentials.
  AWS_ACCESS_KEY_ID="$(awk '{print $1}' <<<"$creds")"
  AWS_SECRET_ACCESS_KEY="$(awk '{print $2}' <<<"$creds")"
  AWS_SESSION_TOKEN="$(awk '{print $3}' <<<"$creds")"
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
  unset creds
fi

command -v age >/dev/null
command -v aws >/dev/null
command -v docker >/dev/null

if ! docker network inspect "$BACKEND_NETWORK" >/dev/null 2>&1; then
  echo "Docker network $BACKEND_NETWORK not found. Is the compose stack up?" >&2
  exit 2
fi

umask 077
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT HUP INT TERM
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
object="maintenance-${stamp}.dump.age"

# Dump from inside the backend network so hostname `db` resolves.
docker run --rm \
  --network "$BACKEND_NETWORK" \
  -e DATABASE_URL \
  "$PG_IMAGE" \
  pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl \
  | age --recipient "$BACKUP_AGE_RECIPIENT" --output "$tmp"

aws s3 cp "$tmp" "${BACKUP_S3_URI%/}/$object" --only-show-errors --sse AES256
printf 'Uploaded encrypted database backup %s\n' "$object"

if [[ -n "${BACKUP_METRICS_FILE:-}" ]]; then
  mkdir -p "$(dirname "$BACKUP_METRICS_FILE")"
  printf 'backup_last_success_timestamp_seconds %s\n' "$(date -u +%s)" >"${BACKUP_METRICS_FILE}.tmp"
  mv "${BACKUP_METRICS_FILE}.tmp" "$BACKUP_METRICS_FILE"
fi

if [[ -n "${BACKUP_HEARTBEAT_URL:-}" ]]; then
  curl --fail --silent --show-error --max-time 10 "$BACKUP_HEARTBEAT_URL" >/dev/null
fi
