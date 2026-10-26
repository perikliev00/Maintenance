# P1 isolation database (local)

Ticket lifecycle, cleaning concurrency, and scenario suites refuse the working
seed database. They require a dedicated PostgreSQL database named
`maintenance_p1_test` and the preload in `api/tests/registerP1TestEnv.mjs`.

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
