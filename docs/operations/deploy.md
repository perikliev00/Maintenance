# Staging and production deployment

## Inputs

Use a clean Linux host with Docker Engine and the Compose v2 plugin. Set public DNS for `APP_DOMAIN` and allow inbound TCP 80/443 and UDP 443. Store `.env.production` outside Git with permissions restricted to the deploy account. Start from `.env.production.example`; generate independent random credentials for the PostgreSQL administrator, migration role, bootstrap role, runtime role, monitoring role, JWT signing key, Grafana, and alert receiver. Do not copy production credentials into staging.

Before first deploy, provision PostgreSQL roles and grants using the database provider or an operator-controlled SQL session. Runtime role needs only the application DML privileges required by current services and sequence access. Migration role owns the schema and migration ledger. Bootstrap role can write settings, grants, and SLA defaults. Metrics role has `pg_monitor` and read-only access. Keep PostgreSQL on the internal network or managed private endpoint; never publish port 5432.

## Build and staging check

From the repository root on staging, use the exact commit SHA as `RELEASE_SHA`:

```sh
docker compose --env-file .env.production -f compose.prod.yml build
docker compose --env-file .env.production -f compose.prod.yml up -d
docker compose --env-file .env.production -f compose.prod.yml ps
curl --fail https://$APP_DOMAIN/api/health/live
curl --fail https://$APP_DOMAIN/api/health/ready
```

The proxy strips `/api` before forwarding, so `/api/health/ready` reaches API `/health/ready`. The `migrate` service must complete successfully before `bootstrap`, then the API and web services become eligible to start. Any failed migration stops API startup. Run browser smoke/E2E against staging through Caddy, including login/cookie + CSRF, `/api/events/stream` for longer than two 25-second heartbeats, offline outbox behavior during a release, and asset/service-worker update checks.

Use a staging database restored from a sanitized backup or seeded with disposable data. Do not use production credentials or production data in CI/E2E.

## Release promotion

CI builds and scans API, migration, and web images. Tag each immutable image with the commit SHA and record registry digests. Promote those same digests to staging and production; do not rebuild on the target host. Keep deployment concurrency serialized so two migration jobs cannot run together. Capture the release SHA in the deployment record and dashboard annotations.

The checked-in Compose file supports local image builds. For registry promotion, configure the private registry image names in deployment tooling and update the `image:` references without changing the source commit. The API deployment is intentionally limited to one replica until cross-process SSE events, rate limits, settings cache invalidation, and job ownership are shared.

## First owner account

After migration and bootstrap, create the initial owner once from a controlled operator terminal. Supply `BOOTSTRAP_DATABASE_URL`, `INITIAL_OWNER_EMAIL`, `INITIAL_OWNER_NAME`, and `INITIAL_OWNER_PASSWORD` through the deployment secret manager, and set `ALLOW_INITIAL_OWNER_CREATION=true` for only this command:

```sh
ALLOW_INITIAL_OWNER_CREATION=true docker compose --profile initial-owner --env-file .env.production -f compose.prod.yml run --rm create-owner
```

The command serializes creation with a PostgreSQL advisory lock, refuses to run if an owner already exists, and emits no password or email to logs. Remove the one-time values afterward. Normal deployment never runs owner creation or the destructive demo seed.

## Rollback

Restore the previous API/web image digests by setting `RELEASE_SHA` to the prior release and applying Compose. Confirm readiness and run the staging smoke flows before reopening traffic. This is an application rollback only: Prisma migrations are not automatically reversed. Every production migration must be backward compatible with the prior application during the rollback window (expand/contract); otherwise use the documented forward fix or an approved database recovery. Never run a demo seed during rollback.
