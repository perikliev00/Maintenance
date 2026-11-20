#!/usr/bin/env bash
# Read-only host/container health summary for SSM diagnostics.
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/maintenance}"
ENV_FILE="${ENV_FILE:-/etc/maintenance/.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yml}"
failed=0

echo "=== host ==="
hostnamectl --static 2>/dev/null || hostname
uname -a
date -u +"utc=%Y-%m-%dT%H:%M:%SZ"

echo "=== disk ==="
df -h / /var/lib/docker 2>/dev/null || df -h /
root_use="$(df -P / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
if [[ "$root_use" =~ ^[0-9]+$ ]] && (( root_use >= 85 )); then
  echo "WARN: root filesystem ${root_use}% used" >&2
  failed=1
fi

echo "=== memory ==="
free -h
avail_kb="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)"
if [[ "$avail_kb" =~ ^[0-9]+$ ]] && (( avail_kb < 200000 )); then
  echo "WARN: MemAvailable under 200MiB" >&2
  failed=1
fi

echo "=== docker ==="
if ! systemctl is-active --quiet docker; then
  echo "FAIL: docker is not active" >&2
  exit 1
fi
docker info >/dev/null
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'

echo "=== ssm agent ==="
if systemctl is-active --quiet snap.amazon-ssm-agent.amazon-ssm-agent.service \
  || systemctl is-active --quiet amazon-ssm-agent; then
  echo "ssm-agent: active"
else
  echo "WARN: ssm-agent not active" >&2
  failed=1
fi

echo "=== compose ==="
if [[ -f "$ENV_FILE" && -d "$DEPLOY_PATH" ]]; then
  (
    cd "$DEPLOY_PATH"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps || failed=1
  )
else
  echo "WARN: compose env/checkout not ready yet" >&2
fi

echo "=== release state ==="
if [[ -f /var/lib/maintenance/current-release-sha ]]; then
  echo "current=$(tr -d '[:space:]' </var/lib/maintenance/current-release-sha)"
fi
if [[ -f /var/lib/maintenance/previous-release-sha ]]; then
  echo "previous=$(tr -d '[:space:]' </var/lib/maintenance/previous-release-sha)"
fi

if (( failed != 0 )); then
  echo "host-health: WARNINGS present" >&2
  exit 1
fi
echo "host-health: ok"
