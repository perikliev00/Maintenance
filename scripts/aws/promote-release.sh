#!/usr/bin/env bash
# Promote an immutable GHCR release by full git SHA. Never compose build.
# Intended for SSM document maintenance-promote (runs as user maintenance).
set -euo pipefail

: "${RELEASE_SHA:?RELEASE_SHA (40-char git sha) is required}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/maintenance}"
ENV_FILE="${ENV_FILE:-/etc/maintenance/.env.production}"
STATE_DIR="${STATE_DIR:-/var/lib/maintenance}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yml}"

[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo "RELEASE_SHA must be a full 40-char lowercase hex git SHA" >&2
  exit 2
}
[[ -d "$DEPLOY_PATH/.git" ]] || {
  echo "DEPLOY_PATH is not a git checkout: $DEPLOY_PATH" >&2
  exit 2
}
[[ -f "$ENV_FILE" ]] || {
  echo "Missing env file: $ENV_FILE" >&2
  exit 2
}

umask 077
install -d -m 0750 "$STATE_DIR"
cd "$DEPLOY_PATH"

prev=""
if [[ -f "$STATE_DIR/current-release-sha" ]]; then
  prev="$(tr -d '[:space:]' <"$STATE_DIR/current-release-sha" || true)"
fi
if [[ -n "$prev" && "$prev" != "$RELEASE_SHA" ]]; then
  printf '%s\n' "$prev" >"$STATE_DIR/previous-release-sha"
fi

# Serialize promotes on this host (also mirrored by GitHub concurrency group).
exec 9>"$STATE_DIR/promote.lock"
if ! flock -n 9; then
  echo "Another promote is in progress on this host" >&2
  exit 3
fi

echo "Fetching $RELEASE_SHA ..."
git fetch origin "$RELEASE_SHA"
git checkout --detach "$RELEASE_SHA"

echo "Pulling images for $RELEASE_SHA (no build) ..."
RELEASE_SHA="$RELEASE_SHA" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull
echo "Applying compose (db→migrate→bootstrap→api→web) ..."
RELEASE_SHA="$RELEASE_SHA" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build

printf '%s\n' "$RELEASE_SHA" >"$STATE_DIR/current-release-sha"
echo "Promote complete: $RELEASE_SHA"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps
