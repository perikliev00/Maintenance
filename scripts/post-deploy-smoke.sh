#!/usr/bin/env bash
# Minimal post-deploy checks (DEP-05). Usage: APP_URL=https://host ./scripts/post-deploy-smoke.sh
set -euo pipefail
: "${APP_URL:?Set APP_URL to the public origin, e.g. https://maintenance.example.com}"
base="${APP_URL%/}"
command -v jq >/dev/null
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT HUP INT TERM

echo "ready..."
curl --fail --silent --show-error --max-time 15 "$base/api/health/ready" | jq -e '.ok == true and .ready == true' >/dev/null
echo "ok /api/health/ready"

echo "metrics lockdown..."
for path in /api/metrics /api/metrics/ /api/METRICS/ /api/%6detrics; do
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$base$path" || true)"
case "$code" in
  401|403|404) echo "ok $path -> $code (not anonymously public)" ;;
  *) echo "FAIL: $path returned $code (expected 401/403/404)" >&2; exit 1 ;;
esac
done

echo "API POST validation..."
code="$(curl --silent --show-error --max-time 15 -o "$tmp" -w '%{http_code}' -H 'Content-Type: application/json' --data '{}' "$base/api/auth/login")"
if [ "$code" != 400 ]; then
  echo "FAIL: invalid login POST returned $code (expected 400)" >&2
  exit 1
fi
jq -e '.error == "validation"' "$tmp" >/dev/null

echo "live..."
curl --fail --silent --show-error --max-time 15 "$base/api/health/live" | jq -e '.ok == true' >/dev/null
echo "ok /api/health/live"

echo "post-deploy smoke passed (login/CSRF/SSE remain manual or E2E)"
