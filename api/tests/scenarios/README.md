# Scenario regressions

Run from `api/`: `npm run test:scenarios`. This uses the existing direct Node
register preload + tsx loader, serial workers, `.env.p1_test`, and a real
`current_database()` assertion before mutations. Never point it at the working
database or replace `.env`. Migrate and seed a dedicated `maintenance_p1_test`
database first; run `npm run prove:p1-isolation` before the suites.

Local isolation DB setup (including `P1_TEST_DATABASE_URL` when `:55439` is
unreachable): see [`docs/testing/P1_ISOLATION_DB.md`](../../docs/testing/P1_ISOLATION_DB.md).

Run from `web/`: `npm test` and `npm run typecheck:tests`.
Run from `e2e/`: `npm run typecheck:scenarios` and `npm run test:scenarios`.
Chromium must be installed. The scenario config starts separate servers on
4018/5185 against the isolated database; it refuses to reuse running servers.
The ordinary Playwright config excludes this directory so these tests do not
accidentally run against the normal development API. CI runs both configurations.

`auth`, `sync`, `notifications`, `jobs`, `analytics`, `attendance`, `catalog-settings`,
`qr` (sync ownership residual), `rollback`, and `sse` suites exercise actual PostgreSQL and/or HTTP. Lock
tests observe real PostgreSQL waiters, including indirect blocker chains. SQL
faults prove writes reached the intended point and are removed in teardown.
`scheduler.test.ts` isolates timer lifecycle with controlled timers.

The browser specs load production modules using `web/tests/browserHarness.tsx`.
`offline`, `live`, `ui`, and `calendar` are browser integrations with controlled
transport, clocks, or storage faults. They are **not** server-commit E2E proof.
`workflows.spec.ts` uses the real UI/API/database; delayed requests are forwarded
to the real server, and committed records are checked afterward. Its quota test
uses a browser storage fault and is classified as browser integration instead.

Existing empty-entries roster coverage is the direct proof for clearing a single day; it is intentionally not duplicated.
Existing source unit tests and lifecycle/scope suites remain regression evidence.
