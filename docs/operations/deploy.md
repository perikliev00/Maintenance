# Staging and production deployment

## Inputs

Use a clean Linux host with Docker Engine and the Compose v2 plugin. Set public DNS for `APP_DOMAIN` and allow inbound TCP 80/443 and UDP 443. Store `.env.production` outside Git with permissions restricted to the deploy account. Start from `.env.production.example`; generate independent random credentials for the PostgreSQL administrator, migration role, bootstrap role, runtime role, monitoring role, JWT signing key, Grafana, and alert receiver. Do not copy production credentials into staging.

**AWS EC2 path (preferred):** bootstrap with Terraform + cloud-init + SSM — see [`aws-ec2.md`](./aws-ec2.md) and [`agent-access.md`](./agent-access.md). GitHub Actions deploys via OIDC → SSM `maintenance-promote` (no long-lived SSH deploy keys).

Before first deploy, provision PostgreSQL roles and grants using the database provider or an operator-controlled SQL session (example: [`infra/postgres/provision-roles.sql.example`](../../infra/postgres/provision-roles.sql.example)). Runtime role needs only the application DML privileges required by current services and sequence access. Migration role owns the schema and migration ledger. Bootstrap role can write settings, grants, and SLA defaults. Metrics role has `pg_monitor` and read-only access. Keep PostgreSQL on the internal network or managed private endpoint; never publish port 5432.

## Production promote (image-only — required)

**Never run `docker compose build` on a production host during promote** (OPS-001 / DEP-01). CI publishes images tagged with the full commit SHA. The checked-in `compose.prod.yml` still contains `build:` blocks for staging/local construction only.

From the deployment host (or via `.github/workflows/deploy.yml`):

The workflow verifies CI success and GHCR manifests, assumes the AWS deploy role
via GitHub OIDC, confirms the instance SSM agent is Online, then runs
`scripts/aws/ssm-promote.sh` (SSM document `maintenance-promote`). After promote
it runs `scripts/post-deploy-smoke.sh` against `APP_URL`. Private GHCR packages
must allow the repository token to inspect manifests; the EC2 host uses its own
read-only GHCR credentials from Secrets Manager. Long-lived SSH deploy keys are
not part of the supported path.

The web image runs as UID 1000. When upgrading volumes created by an older
root-run Caddy image, ensure its data/config volumes are writable by that UID
before the upgrade; the image build cannot change ownership of existing volumes.

```sh
export RELEASE_SHA=<40-char-git-sha>
# Preferred: from a workstation with ops/GHA AWS creds
./scripts/aws/ssm-promote.sh
APP_URL=https://$APP_DOMAIN ./scripts/post-deploy-smoke.sh

# Equivalent on the host itself (SSM session or emergency console):
git fetch origin "$RELEASE_SHA" && git checkout --detach "$RELEASE_SHA"
docker compose --env-file /etc/maintenance/.env.production -f compose.prod.yml pull
docker compose --env-file /etc/maintenance/.env.production -f compose.prod.yml up -d --no-build
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

The API deployment is intentionally limited to one replica until cross-process SSE fan-out, rate limits, and settings cache invalidation are shared. Background **job ownership** is already multi-instance-safe via a Postgres session advisory lock (see below); that alone does not authorize scaling API replicas.

## Background job lock (multi-instance)

Scheduled and manual job cycles (`runWithJobExecutionLock` / `POST /jobs/run`) take a session-level Postgres advisory lock so two API processes cannot run overlapping job cycles.

**Required for that lock to work:**

- Point `DATABASE_URL` / Compose `RUNTIME_DATABASE_URL` at **direct Postgres** or a pooler in **session** mode. **PgBouncer transaction pooling breaks session advisory locks** (lock and unlock can land on different backends; jobs may all race or never acquire).
- The lock client forces `connection_limit=1` so try_lock / hold / unlock share one backend session. Do not strip that in a custom datasource URL.
- Keep individual job cycles shorter than the Postgres/pool **idle session timeout**; dropping the lock session mid-run releases the advisory lock while work may still be in flight.
- Orphaned `running` JobRun rows are abandoned after a **30 minute** stale TTL, swept on API boot and on every scheduler tick. Do not run jobs that legitimately stay `running` longer than that TTL across instances.

**Pre-deploy checklist (ops sign-off):**

1. Print and inspect the **runtime** URL host (not migration-only):
   - Compose prod: env var `RUNTIME_DATABASE_URL` → `api` service `DATABASE_URL` (`compose.prod.yml`).
   - Local/dev: `DATABASE_URL` from `api/.env` / `api/.env.example` (default host `localhost:5433` → Compose `db` mapped Postgres, **direct**, no PgBouncer service in `docker-compose.yml`).
   - Reject hosts/ports that belong to a known **transaction-mode** pooler (e.g. many managed `*.pooler.*` endpoints default to transaction unless explicitly session). Prefer the primary Postgres hostname / `db` service name on port `5432` inside the compose network.
2. Confirm checked-in Compose / env examples still use direct Postgres (`db` / `:5432` / local `:5433`) — grep `compose.prod.yml`, `docker-compose.yml`, `api/.env.example` for `pgbouncer` / `pooler` / `6543` before promote.
3. Confirm the advisory-lock client still forces `connection_limit=1` via `advisoryLockDatabaseUrl` (do not override with a custom URL that drops it).
4. If a managed pooler is added later, either keep **session** affinity for the API job connection or redesign the lock protocol — do not assume transaction pooling is safe.
5. Repo unit/integration tests (`api/src/services/jobs/executionLock.test.ts`) cover in-process + cross-session mutual exclusion against the **test** DB; they do **not** prove production pool mode. Production/staging pool mode remains an **unverified assumption** until ops records the live `RUNTIME_DATABASE_URL` host + pool mode in the release notes.

### `DISABLE_JOB_SCHEDULER` (E2E / probes only)

Set `DISABLE_JOB_SCHEDULER=1` to skip `startJobScheduler()` after bootstrap. Playwright sets this for the Audit live suite so `POST /jobs/run` is not blocked by the 15s boot cycle holding the advisory lock. The API emits a structured **warn** log `event=job_scheduler_disabled` at startup when the flag is set.

**Deployed environments refuse to start** if the flag is set (`assertEnv` / `assertDisableJobSchedulerAllowed`): `NODE_ENV=production`; or **any of** `APP_ENV` / `DEPLOY_ENV` / `ENVIRONMENT` is set to a value outside the local allowlist {development, dev, test, local} (allowlist — unknown labels like `live`, `qa`, `staging-1`, `production-eu` are refused; a benign `APP_ENV=development` cannot hide `DEPLOY_ENV=staging`); or any process with `RELEASE_SHA` set (compose.prod.yml). Local/E2E (development|test, unset or local allowlist labels only) may set it. Leave unset (default) for all real deployments.

## First owner account

After migration and bootstrap, create the initial owner once from a controlled operator terminal. Supply `BOOTSTRAP_DATABASE_URL`, `INITIAL_OWNER_EMAIL`, `INITIAL_OWNER_NAME`, and `INITIAL_OWNER_PASSWORD` through the deployment secret manager, and set `ALLOW_INITIAL_OWNER_CREATION=true` for only this command:

```sh
ALLOW_INITIAL_OWNER_CREATION=true docker compose --profile initial-owner --env-file .env.production -f compose.prod.yml run --rm create-owner
```

The command serializes creation with a PostgreSQL advisory lock, refuses to run if an owner already exists, and emits no password or email to logs. Remove the one-time values afterward. Normal deployment never runs owner creation or the destructive demo seed.

## Rollback

Restore the previous API/web image tags by setting `RELEASE_SHA` to the prior release and applying Compose with `pull` + `up -d --no-build` (host helper: `scripts/aws/ssm-rollback-app.sh`, which reads `/var/lib/maintenance/previous-release-sha`). Confirm readiness and run smoke checks before reopening traffic. This is an application rollback only: Prisma migrations are not automatically reversed. Every production migration must be backward compatible with the prior application during the rollback window (expand/contract); otherwise use the documented forward fix or an approved database recovery. Never run a demo seed during rollback.
