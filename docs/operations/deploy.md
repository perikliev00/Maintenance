# Staging and production deployment

## Inputs

Use a clean Linux host with Docker Engine and the Compose v2 plugin. Set public DNS for `APP_DOMAIN` and allow inbound TCP 80/443 and UDP 443. Store `.env.production` outside Git with permissions restricted to the deploy account. Start from `.env.production.example`; generate independent random credentials for the PostgreSQL administrator, migration role, bootstrap role, runtime role, monitoring role, JWT signing key, Grafana, and alert receiver. Do not copy production credentials into staging.

Before first deploy, provision PostgreSQL roles and grants using the database provider or an operator-controlled SQL session. Runtime role needs only the application DML privileges required by current services and sequence access. Migration role owns the schema and migration ledger. Bootstrap role can write settings, grants, and SLA defaults. Metrics role has `pg_monitor` and read-only access. Keep PostgreSQL on the internal network or managed private endpoint; never publish port 5432.

## Production promote (image-only — required)

**Never run `docker compose build` on a production host during promote** (OPS-001 / DEP-01). CI publishes images tagged with the full commit SHA. The checked-in `compose.prod.yml` still contains `build:` blocks for staging/local construction only.

From the deployment host (or via `.github/workflows/deploy.yml`):

The workflow passes the job token to GitHub CLI and logs in to GHCR with
`packages: read` for manifest verification. Private packages must grant this
repository access to that token. The production host uses its own preconfigured
read-only registry credentials; the runner login is not forwarded over SSH.

The web image runs as UID 1000. When upgrading volumes created by an older
root-run Caddy image, ensure its data/config volumes are writable by that UID
before the upgrade; the image build cannot change ownership of existing volumes.

```sh
export RELEASE_SHA=<40-char-git-sha>
# Workflow also verifies GHCR manifests exist for this SHA before SSH.
git fetch origin "$RELEASE_SHA" && git checkout --detach "$RELEASE_SHA"
docker compose --env-file .env.production -f compose.prod.yml pull
docker compose --env-file .env.production -f compose.prod.yml up -d --no-build
curl --fail https://$APP_DOMAIN/api/health/ready
```

### Digest / tag contract (honest residual)

Images are promoted by **git SHA tag** (`…/maintenance-api:$RELEASE_SHA`). That is not the same as pinning a registry content digest (`@sha256:…`). Residual risk: a compromised publisher with push rights could overwrite a tag. Mitigations: restrict GHCR writers, record digests from the publish job in release notes, and prefer `imagetools inspect` / digest compare before promote when tooling allows.

## Staging build (allowed)

From the repository root on **staging** only, you may build once to validate Dockerfiles:

```sh
docker compose --env-file .env.production -f compose.prod.yml build
docker compose --env-file .env.production -f compose.prod.yml up -d
docker compose --env-file .env.production -f compose.prod.yml ps
curl --fail https://$APP_DOMAIN/api/health/live
curl --fail https://$APP_DOMAIN/api/health/ready
```

The proxy strips `/api` before forwarding, so `/api/health/ready` reaches API `/health/ready`. The `migrate` service must complete successfully before `bootstrap`, then the API and web services become eligible to start. Any failed migration stops API startup. Run browser smoke/E2E against staging through Caddy, including login/cookie + CSRF, `/api/events/stream` for longer than two 25-second heartbeats, offline outbox behavior during a release, and asset/service-worker update checks.

Use a staging database restored from a sanitized backup or seeded with disposable data. Do not use production credentials or production data in CI/E2E.

## Post-deploy smoke (beyond `/health/ready`) — DEP-05

After promote, operators (or deploy workflow) should confirm:

1. `GET /api/health/ready` → 200 with JSON `ok: true` and `ready: true` (HTML 200 is a failure)  
2. `GET /api/metrics`, `/api/metrics/` and encoded/case variants via the **public** edge → **404/401/403**  
3. Login + one CSRF-protected mutate (staging E2E or manual)  
4. SSE `/api/events/stream` stays open >50s (two heartbeats) on staging  
5. If profile `monitoring` is enabled: real `ALERT_WEBHOOK_URL` + external uptime (see `incident-response.md`)

Optional helper (requires curl and jq): `APP_URL=https://… bash scripts/post-deploy-smoke.sh`.
It also checks that an invalid login POST reaches API JSON validation.

CI runs `API_IMAGE=maintenance-api:<tag> WEB_IMAGE=maintenance-web:<tag> node scripts/verify-containers.mjs`
against the built images. This creates a disposable network, injects only the
readiness database probe, checks real API validation through Caddy, static assets,
SPA fallback, security/cache headers, public metrics denial and internal scrape.
It starts Alertmanager with the checked-in config/entrypoint and sends an alert
only to a receiver on that disposable network. Containers and network are removed
on completion; no application database or external webhook is used.

## Release promotion

CI builds and scans API, migration, and web images. Tag each immutable image with the commit SHA and record registry digests. Promote those same tags/digests to staging and production; do not rebuild on the target host. Keep deployment concurrency serialized so two migration jobs cannot run together. Capture the release SHA in the deployment record and dashboard annotations.

The API deployment is intentionally limited to one replica until cross-process SSE events, rate limits, settings cache invalidation, and job ownership are shared.

## First owner account

After migration and bootstrap, create the initial owner once from a controlled operator terminal. Supply `BOOTSTRAP_DATABASE_URL`, `INITIAL_OWNER_EMAIL`, `INITIAL_OWNER_NAME`, and `INITIAL_OWNER_PASSWORD` through the deployment secret manager, and set `ALLOW_INITIAL_OWNER_CREATION=true` for only this command:

```sh
ALLOW_INITIAL_OWNER_CREATION=true docker compose --profile initial-owner --env-file .env.production -f compose.prod.yml run --rm create-owner
```

The command serializes creation with a PostgreSQL advisory lock, refuses to run if an owner already exists, and emits no password or email to logs. Remove the one-time values afterward. Normal deployment never runs owner creation or the destructive demo seed.

## Rollback

Restore the previous API/web image tags by setting `RELEASE_SHA` to the prior release and applying Compose with `pull` + `up -d --no-build`. Confirm readiness and run the staging smoke flows before reopening traffic. This is an application rollback only: Prisma migrations are not automatically reversed. Every production migration must be backward compatible with the prior application during the rollback window (expand/contract); otherwise use the documented forward fix or an approved database recovery. Never run a demo seed during rollback.
