# Audit module — independent residual re-verification (2026-11-01)

Auditor: independent. Did not implement the remediation. Every gate below was re-run by me against `maintenance_p1_test`
(via `runWithP1Isolation.mjs`; Playwright's `webServer` uses `registerP1TestEnv.mjs`; ports 4000/5173 were free beforehand,
so no pre-existing server on a different DB was reused). The seed/prod DB was not touched.

## 1. Executive verdict: **PASS_WITH_RISKS**

All gates are green and the advisory-lock and scheduler-sweep closures are real. But two closures are weaker than
claimed, and one of the residual closures (the jobs live-refresh E2E) does not test what it says it tests.
"READY / nothing open" is not justified. Nothing is committed.

## 2. Claim → evidence → status

| Claim | Evidence (re-checked) | Status |
|---|---|---|
| 1. Cross-session advisory-lock regression test | `executionLock.test.ts` second case: an independent `PrismaClient` takes `pg_try_advisory_lock(KEY)`, then `runWithJobExecutionLock` must return `{acquired:false}`; then releases and re-acquires. **Mutation M1** (`if (false && !rows[0]?.locked)`) → test fails with "cross-session advisory lock must block…". | **REAL** (mutation-sensitive for the `!locked` path) |
| 2. Periodic stale-JobRun abandon at boot + interval | `scheduler.ts`: `abandon()` is called once at start and again in each `setInterval` tick. TTL is `DEFAULT_STALE_JOB_RUN_MS` = 30m in `runLifecycle.ts`. **M2** (remove interval abandon) → `sweeps stale JobRuns…` fails. **M3** (remove boot abandon) → same test fails. Real-DB TTL behaviour is covered by `runLifecycle.test.ts` (closes stale, keeps fresh). | **REAL**, with caveats (R3, R4) |
| 3a. Playwright: settings.changed → events panel updates without reload | Passes 1/1. **M5** (remove `settings.changed` and `jobs.changed` from `AUDIT_PAGE_LIVE_EVENTS`) → test fails after 20s timeout. The unique `reason` string cannot be on the page pre-mutation. | **REAL** |
| 3b. Playwright: jobs.changed → jobs panel updates without reload | Passes, but **still passes under M5** with `jobs.changed` removed from the live-event list. The assertions (any "Lock inactive users" cell + any "Succeeded" cell) are satisfied by rows left in the persistent P1 DB from earlier runs, or from the initial load. The test never asserts a new or changed row (no row-count delta, no run id, no timestamp). | **FAKE / non-discriminating** — the claimed jobs.changed E2E proof is not proven. (The unit-level `startJobRun`/`finishJobRun` publish tests are still valid.) |
| 4a. Lock deployment assumptions documented | Only a code comment in `executionLock.ts`. `docs/operations/deploy.md` has no mention of PgBouncer, session pooling, or the lock. An operator reading deploy docs would not learn it. | **PARTIAL** |
| 4b. `connection_limit=1` on lock client | Present in `advisoryLockDatabaseUrl` and used for the lock client. **M4** (delete the `connection_limit` line) → `executionLock.test.ts` still **2/2 pass**. No test asserts the URL param or that lock/unlock share one backend session. The test holder also uses `advisoryLockDatabaseUrl`, so it follows the mutation. | **IMPLEMENTED, UNTESTED** |
| BUG-01 SLA/overdue `locationId` in scope | `audit.sla-scope.db.test.ts`, `audit.overdue-scope.db.test.ts`, `audit.scope.test.ts` (BUG-01 case) pass; backfill test passes. | **HOLDS** (tests re-run) |
| BUG-02/03/04/05/08 (web logic) | Web tests 295/295 pass (race guard, banner, independent sections, nested diff, SLA identity). Logic-level only; no DOM test for race guard. | **HOLDS** (logic) |
| BUG-06/07 live events | `authorizeLiveEvent.test.ts`, `runLifecycle.test.ts` pass; settings path proven in E2E (3a). jobs path: unit-level only (3b). | **HOLDS** (E2E for jobs not proven) |
| BUG-09/10 | Web/API suites green (labels/producers/web tests). Not individually re-proven end-to-end. | **HOLDS (spot-check)** |
| NEW-01/03/04/07 | Web tests + `authorizeLiveEvent.test.ts` + `audit.producers.test.ts` pass. | **HOLDS (spot-check)** |
| NEW-05 `jobs.run` split | `jobs.run.http.test.ts`: "NEW-05: jobs.view alone cannot POST /jobs/run" passes, plus the 403 and 409-lock cases. | **HOLDS** |
| NEW-06 Playwright smoke | 1/1 pass; shallow by its own description. | **HOLDS (shallow)** |
| NEW-02 API build | `tsc` clean. | **HOLDS** |

## 3. Gates run (exact counts)

| Gate | Result |
|---|---|
| `api`: `npm run lint` | exit 0 |
| `api`: `npm run build` (tsc) | exit 0 |
| `api`: `runWithP1Isolation.mjs --test-concurrency=1` on the 12 required files | **tests 41, suites 13, pass 41, fail 0, cancelled 0, skipped 0**; exit 0 |
| `web`: `npm run lint` | exit 0 |
| `web`: `npm run build` | exit 0 |
| `web`: `npm test` | **tests 295, suites 73, pass 295, fail 0** |
| `e2e`: `playwright test audit-page-smoke + audit-page-live-refresh` | **3 passed, 0 failed** (18.9s) |

The 12 API files include `executionLock`, `runLifecycle`, `scheduler` (unit and scenario), `audit.scope`, `audit.producers`, `audit.backfillLocationIds`, `authorizeLiveEvent`, `jobs.db`, `jobs.run.http`, `audit.sla-scope.db` and `audit.overdue-scope.db`.
The follow-up doc says web = 292 tests; the current count is 295 (doc is stale on this number, harmless).

## 4. Mutation results (all files restored; hash or content verified)

| # | Mutation | Test run | Outcome |
|---|---|---|---|
| M1 | `executionLock.ts`: ignore `!locked` (`if (false && !rows[0]?.locked)`) | `executionLock.test.ts` | **Caught**: 1 pass / 1 fail (the cross-session test). Restored hash = original (`0ED7DB24…`). |
| M2 | `scheduler.ts`: remove `abandon()` from `setInterval` | `scheduler.test.ts` | **Caught** (sweep test fails). Restored. |
| M3 | `scheduler.ts`: remove boot `abandon()` | `scheduler.test.ts` | **Caught**, but the failing assertion fires before `stopJobScheduler()`, so the timers leak and the node test process **hangs** instead of exiting. I had to kill node and restore from backup. Restored hash = original (`A4409059…`). |
| M4 | `executionLock.ts`: delete `connection_limit=1` | `executionLock.test.ts` | **NOT caught** (2/2 pass). Restored. |
| M5 | `auditPageLogic.ts`: drop `settings.changed` and `jobs.changed` from `AUDIT_PAGE_LIVE_EVENTS` | `audit-page-live-refresh.spec.ts` | settings test **caught**; jobs test **NOT caught**. Restored. |

## 5. Remaining risks / why not PASS

1. **R1 — jobs live E2E is non-discriminating (M5).** Residual closure #3 is only half real. Fix: assert a newly created run (record the run count or max `startedAt` before the trigger, or filter by a fresh run id) and then check for an increase without reload.
2. **R2 — `connection_limit=1` is not guarded by any test (M4).** The documented invariant "try_lock / unlock / hold share one backend session" can regress silently. With the default pool the lock client could use a different connection for `pg_advisory_unlock`, which silently fails because it is best-effort and swallowed. Impact is limited because `$disconnect()` releases the session lock, but the assumption is unenforced. Add a unit test on `advisoryLockDatabaseUrl` (`connection_limit=1` present) or assert `pg_backend_pid()` stability across the lock and unlock calls.
3. **R3 — scheduler test hygiene.** The sweep test calls `stopJobScheduler()` outside `finally`. Any assertion failure leaks the intervals and hangs the test runner (observed in M3), which is a CI-hang risk.
4. **R4 — sweep vs. long jobs.** `abandonStaleRunningJobRuns` is time-based only (30 min), not liveness- or advisory-lock-aware. A legitimately running job longer than 30 min on instance A would be marked "error" by instance B's periodic sweep while still running, and its later `finishJobRun` would overwrite that. There is no test for this. The TTL comment says "keep above the longest job" but nothing enforces it.
5. **R5 — deployment assumptions live only in a code comment.** `docs/operations/deploy.md` has no entry. PgBouncer transaction pooling would break the lock, and the failure is silent: every instance might fail to acquire (jobs never run) or all acquire.
6. **R6 — nothing is committed.** `git status`: ~80 modified tracked files plus untracked Audit sources, tests, migrations (including `20261101140000_backfill_audit_location_ids`), the two E2E specs and all the docs. HEAD (`2b2aa00`) contains none of the Audit remediation. "READY" is true only for the dirty working tree.
7. **R7 — unrelated untracked migrations/workflow** (`20261029200000…`, `…210000`, `…220000`, `20261031200000`, `20261101120000`, `.github/workflows/nightly-perf.yml`) are mixed into the same uncommitted tree, so the Audit change set is not isolated for review.

Not found: any product regression in BUG-01..10 / NEW-01..07 on the paths I re-ran. The gates are green and nothing contradicted the code.

## 6. Is "READY / nothing open" justified now?

**No.** Claims #1 and #2 are real. Claim #3 is half fake (jobs half). Claim #4 is only a code comment, and `connection_limit=1` is untested.
The follow-up's "Отворено: Няма" should be changed to list R1, R2, R5 and R6 at minimum.
A clean **PASS** would need: a discriminating jobs E2E, a `connection_limit` test, the deploy doc entry, a `finally { stopJobScheduler }` in the sweep test, and a commit of the Audit change set.

---

## 7. Post-audit fixes (same day)

Engineering closed R1/R2/R3/R5 after this report (commit still operator-owned):

| Item | Fix |
|---|---|
| R1 jobs E2E | Asserts a **new** run id (`beforeIds` delta + `data-job-run-id`); mutation dropping `jobs.changed` from allowlist now fails the test |
| R2 `connection_limit=1` | Unit asserts on `advisoryLockDatabaseUrl` |
| R3 scheduler hygiene | `stopJobScheduler()` in `finally` |
| R5 deploy assumptions | `docs/operations/deploy.md` § Background job lock |
