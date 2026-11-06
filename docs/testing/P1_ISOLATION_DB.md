# P1 isolation database (local)

Ticket lifecycle, cleaning concurrency, and scenario suites refuse the working
seed database. They require a dedicated PostgreSQL database named
`maintenance_p1_test` and the preload in `api/tests/registerP1TestEnv.mjs`.
CI keeps that separate DB so mutating suites cannot wipe the job’s working
`maintenance` seed used by smoke scripts.

## API test commands (api/)

Canonical runners use `runWithP1Isolation.mjs` (preload + `--test-concurrency=1`).
Aliases below forward extra args after `--`.

| Purpose | Command | Notes |
|---|---|---|
| Everyday / CI `unit-src` | `npm test` | `src/**/*.test.ts` only. Despite the CI log label, many of these files need the P1 DB. |
| Full API package | `npm run test:all` | Both wide globs: `src/**/*.test.ts` and `tests/**/*.test.ts`. |
| Domain packs | `npm run test:cleaning-lifecycle`, `test:readiness`, `test:tickets-lifecycle`, `test:plan`, `test:sectors`, `test:shifts`, `test:my-work`, `test:attendance`, `test:cards`, `test:people`, `test:auth`, `test:scenarios` | Same globs CI Smoke invokes under those suite names. |
| Isolation aliases | `npm run test:regress-p1-isolated`, `test:attendance:isolated`, `test:cards:isolated` | Compatible aliases for `npm test`, `test:attendance`, `test:cards`. |
| Inventory / proof | `npm run test:inventory`, `npm run prove:p1-isolation` | Inventory globs must cover every `*.test.ts` under `src/` and `tests/` (incl. `tests/scenarios/*.test.ts`). |
| Selected DB four | `npm run test:db` | Exactly four files: attendance rebuild, cards filter, roleGrants seed, audit write. |
| Coverage / mutation | `npm run coverage`, `coverage:all`, `test:mutation*` | Same isolation wrapper / Stryker scope as today; see [COVERAGE.md](./COVERAGE.md) and [MUTATION_TESTING.md](./MUTATION_TESTING.md). |

## Quick path (recommended)

1. Ensure Postgres is reachable (Compose often maps host **5433** → container 5432).
2. Create and migrate the isolated DB (once):

```bash
# From a shell that can reach Postgres as role `maintenance`
psql -h 127.0.0.1 -p 5433 -U maintenance -d postgres -c "CREATE DATABASE maintenance_p1_test OWNER maintenance;"
cd api
DATABASE_URL="postgresql://maintenance:maintenance@127.0.0.1:5433/maintenance_p1_test?schema=public" npx prisma migrate deploy
DATABASE_URL="postgresql://maintenance:maintenance@127.0.0.1:5433/maintenance_p1_test?schema=public" DEMO_SEED_DATABASE_NAME=maintenance_p1_test node --import ./tests/registerP1TestEnv.mjs --import tsx prisma/seed.ts
```

3. Run suites with an explicit override (do **not** edit committed secrets; do **not**
   point mutating suites at the working `maintenance` DB):

```powershell
cd api
$env:P1_TEST_DATABASE_URL='postgresql://maintenance:maintenance@127.0.0.1:5433/maintenance_p1_test?schema=public&connection_limit=20'
npm run prove:p1-isolation
npm run test:tickets-lifecycle
# or a focused file:
node ./tests/runWithP1Isolation.mjs --test-concurrency=1 "tests/tickets/assign.start.concurrency.test.ts"
```

## Why `:55439` vs `:5433`

`api/.env.p1_test` (gitignored) may still point at a historical scratch cluster on
`127.0.0.1:55439`. If that port is down, `registerP1TestEnv` fails unless you set
`P1_TEST_DATABASE_URL` to a reachable `maintenance_p1_test` endpoint (commonly
`:5433` on the local Docker Postgres). CI creates the same DB name on its
Postgres service and writes `.env.p1_test` for the job.

## Safety rules

- Prefer `P1_TEST_DATABASE_URL` over rewriting `api/.env`.
- `assertTestDatabase` / `EXPECTED_TEST_DATABASE=maintenance_p1_test` must pass
  before mutating tests proceed.
- Full ticket lifecycle: `npm run test:tickets-lifecycle` (serial, isolation preload).

## Main Playwright E2E isolation

`e2e/playwright.config.ts` starts the API with
`node --import ./tests/registerP1TestEnv.mjs … src/index.ts`, the same fail-closed
preload as scenario E2E. It must **not** load ambient `api/.env` against the
working `maintenance` seed DB.

If `reuseExistingServer` is true and an API is already listening on `:4000`
without P1 isolation, Playwright will reuse it — stop that process or set
`CI=1` / `reuseExistingServer: false` so the isolated webServer starts.

## Safe cleanup of E2E stamps (manual, non-destructive by default)

E2E suites stamp titles like `E2E-R-<timestamp>` and may create rooms with
`E2E…` numbers on the first hierarchy floor. **ANNEX** is intentional demo
seed geography (`MAIN` / `ANNEX` / `ROYAL`), not a test namespace — do not delete
ANNEX locations as “test litter.”

Never run automatic destructive cleanup against production or the working seed
DB. When cleaning the isolated `maintenance_p1_test` database after local E2E:

```sql
-- Inspect only (safe)
SELECT id, title, status, "openedAt"
FROM "MaintenanceTicket"
WHERE title LIKE 'E2E-R-%'
ORDER BY "openedAt" DESC
LIMIT 50;

-- Optional delete ONLY on maintenance_p1_test after review:
-- DELETE FROM "TicketEvent" WHERE "ticketId" IN (
--   SELECT id FROM "MaintenanceTicket" WHERE title LIKE 'E2E-R-%'
-- );
-- DELETE FROM "MaintenanceTicket" WHERE title LIKE 'E2E-R-%';
```

Prefer re-seeding `maintenance_p1_test` over ad-hoc deletes when unsure.
