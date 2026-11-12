#!/usr/bin/env bash
# Minimal post-deploy checks (DEP-05). Usage: APP_URL=https://host ./scripts/post-deploy-smoke.sh
# Exit on error, treat unset variables as errors, and fail pipelines on any stage failure.
set -euo pipefail
# Require the public application origin used for smoke probes.
: "${APP_URL:?Set APP_URL to the public origin, e.g. https://maintenance.example.com}"
# Normalize the base URL by stripping a trailing slash.
base="${APP_URL%/}"
# Ensure jq is available for JSON assertions.
command -v jq >/dev/null
# Allocate a temporary file for response bodies.
tmp="$(mktemp)"
# Clean up the temporary file on exit or termination signals.
trap 'rm -f "$tmp"' EXIT HUP INT TERM

# Announce the readiness probe.
echo "ready..."
# Assert the readiness endpoint reports ok and ready.
curl --fail --silent --show-error --max-time 15 "$base/api/health/ready" | jq -e '.ok == true and .ready == true' >/dev/null
# Confirm the readiness check passed.
echo "ok /api/health/ready"

# Announce metrics lockdown checks.
echo "metrics lockdown..."
# Probe several metrics path variants that must not be anonymously public.
for path in /api/metrics /api/metrics/ /api/METRICS/ /api/%6detrics; do
# Capture the HTTP status code without failing the loop on non-2xx responses.
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$base$path" || true)"
# Accept only auth/not-found status codes for metrics exposure.
case "$code" in
  401|403|404) echo "ok $path -> $code (not anonymously public)" ;;
  *) echo "FAIL: $path returned $code (expected 401/403/404)" >&2; exit 1 ;;
esac
done

# Announce API request validation checks.
echo "API POST validation..."
# POST an empty JSON body to login and capture status plus body.
code="$(curl --silent --show-error --max-time 15 -o "$tmp" -w '%{http_code}' -H 'Content-Type: application/json' --data '{}' "$base/api/auth/login")"
# Expect validation to reject the empty payload with HTTP 400.
if [ "$code" != 400 ]; then
  # Report unexpected status codes for the invalid login probe.
  echo "FAIL: invalid login POST returned $code (expected 400)" >&2
  # Abort the smoke run on unexpected login validation behavior.
  exit 1
fi
# Assert the response body uses the validation error shape.
jq -e '.error == "validation"' "$tmp" >/dev/null

# Announce the liveness probe.
echo "live..."
# Assert the liveness endpoint reports ok.
curl --fail --silent --show-error --max-time 15 "$base/api/health/live" | jq -e '.ok == true' >/dev/null
# Confirm the liveness check passed.
echo "ok /api/health/live"

# Summarize that automated smoke checks finished successfully.
echo "post-deploy smoke passed (login/CSRF/SSE remain manual or E2E)"
