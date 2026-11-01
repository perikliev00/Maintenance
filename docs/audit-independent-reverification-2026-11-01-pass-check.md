# Audit module — independent pass-check (2026-11-01)

Auditor stance: adversarial; did not implement the remediation; prior docs treated as claims only.
Test DB: `maintenance_p1_test` only (via `api/tests/runWithP1Isolation.mjs` / `registerP1TestEnv.mjs`; Playwright servers also use `registerP1TestEnv`). Seed/prod never touched.

## 1. Executive verdict

**PASS_WITH_RISKS**

All four post-PASS_WITH_RISKS fixes (R1 jobs E2E, R2 `connection_limit` unit test, R3 scheduler `finally`, R5 deploy doc) are real, and every required mutation failed the intended test for the right reason. Gates are green.

It is not a clean PASS for four reasons:
1. **Nothing is committed.** HEAD `2b2aa00` ("Harden people access concurrency…") is unrelated to Audit. All Audit work is dirty/untracked (145 `git status` entries, including `audit.producers.ts`, `auditPageLogic.ts` and both Audit E2E specs). "READY" describes a working tree, not a release artifact.
2. **The jobs E2E is race-prone.** It fails with a `409 job_already_running` that is unrelated to the feature (see §5, F1). I hit this 6 times when the scheduler's boot cycle overlapped the test.
3. **The boot sweep is not mutation-sensitive.** Removing the boot-time `abandon()` call leaves the scheduler tests green (see §4).
4. **The working tree is shared and moving.** Files unrelated to Audit (Housekeeping, locations catalog, `schema.prisma`) were being edited during the audit window.

## 2. Claim → evidence → status

| Claim | Evidence (re-checked myself) | Status |
|---|---|---|
| **R1** jobs E2E asserts a NEW run id via `beforeIds` + `data-job-run-id` | `e2e/tests/audit-page-live-refresh.spec.ts` snapshots `GET /jobs/runs?limit=50` ids, then `POST /jobs/run {jobKey:"lock_inactive_users"}`. It polls for a row not in `beforeIds` and asserts `[data-job-run-id="<freshId>"]` is visible without reload. `AuditPage.tsx:372` renders `data-job-run-id={job.id}`. **M-jobs:** with `"jobs.changed"` removed from `AUDIT_PAGE_LIVE_EVENTS`, the test failed at `expect(locator('[data-job-run-id="cmvxtrrna…"]')).toBeVisible()` (element not found, 20s). The same test passed unmutated on the same servers. | **REAL**, but flaky vs the scheduler (F1) |
| **R2** `advisoryLockDatabaseUrl` forces `connection_limit=1`; unit test catches deletion | `executionLock.test.ts` feeds `connection_limit=20&schema=public` and asserts the result has `connection_limit=1`. **M-limit:** deleting `parsed.searchParams.set("connection_limit","1")` failed exactly that test (`✖ advisoryLockDatabaseUrl forces connection_limit=1`; 3 pass, 1 fail). | **REAL** (URL-level only, see F4) |
| **R3** scheduler tests use `try/finally { await stopJobScheduler() }` | Both tests in `scheduler.test.ts` have `finally { await stopJobScheduler(); }`. | **REAL** |
| **R5** `deploy.md` § Background job lock | `docs/operations/deploy.md:80-89` exists. It covers direct Postgres or session pooling, that PgBouncer transaction pooling breaks session advisory locks, `connection_limit=1`, the idle session timeout, and the 30-minute stale TTL swept on boot and every tick. TTL verified against `DEFAULT_STALE_JOB_RUN_MS = 30*60*1000` in `runLifecycle.ts:54`. | **REAL**, with a gap (F5) |
| Cross-session advisory lock test is mutation-sensitive | `executionLock.test.ts` has a second `PrismaClient` hold `pg_try_advisory_lock(87201501)`. **M-lock:** replacing `if (!rows[0]?.locked)` with `if (false as boolean)` failed both `executionLock.test.ts › returns acquired:false when another session holds…` and `jobs.run.http.test.ts › returns 409 while the shared lock is held…` (pass 5, fail 2). | **REAL** |
| Periodic abandon (boot + interval) is real | `scheduler.ts` calls `abandon()` in `startJobScheduler` (boot) and inside `setInterval`. **M-interval:** removing the interval `abandon()` failed `sweeps stale JobRuns on boot and on each interval tick`. **M-boot:** removing the boot `abandon()` left both scheduler tests **green**. | Interval **REAL**; boot **PARTIAL** (F2) |
| settings.changed E2E is real | **M-settings:** with `"settings.changed"` removed from the allowlist, the events-panel test failed (unique reason `e2e-audit-live-<ts>` never visible). Unmutated, it passed. | **REAL** |
| BUG-01 (SLA/overdue location scope) | `audit.sla-scope.db` and `audit.overdue-scope.db` pass. **Extra mutation:** removing `locationId: ticket.locationId` from the SLA `recordAudit` failed `audit.sla-scope.db` (pass 2, fail 1). | HOLDS |
| BUG-06/07/NEW-03 live events contract | `auditLiveEvents.test.ts` and `useLiveRefresh.events.test.ts` are in the 295-pass web suite. E2E covers jobs and settings. | HOLDS (spot) |
| BUG-02..05, 08..10, NEW-01/02/04/07 | Covered by the passing web suite (295/295, includes `auditPageLogic`, `audit/labels`, `permissionsSaveFlow`) and API suites. Not each re-proven with its own mutation. | HOLDS (spot, not full re-prove) |
| NEW-05 `jobs.run` ≠ `jobs.view` | `routes/jobs.ts` uses `requireAction("jobs.run")` on POST. `jobs.run.http.test` passes ("jobs.view alone cannot POST /jobs/run", "denies callers without jobs.run"). | HOLDS |
| NEW-06 smoke E2E | `audit-page-smoke.spec.ts` passed in every official run. | HOLDS |

## 3. Gates (run by me, exact counts)

| Gate | Result |
|---|---|
| `api`: `npm run lint` (oxlint) | exit 0 |
| `api`: `npm run build` (tsc) | exit 0 |
| `api`: `runWithP1Isolation --test-concurrency=1` on the 12 requested files (executionLock, runLifecycle, scheduler (unit), audit.scope, audit.producers, audit.backfillLocationIds, authorizeLiveEvent, jobs.db, jobs.run.http, scenarios/scheduler, audit.sla-scope.db, audit.overdue-scope.db) | **43 tests / 13 suites: 43 pass, 0 fail, 0 cancelled, 0 skipped** |
| `web`: `npm run lint` | exit 0 |
| `web`: `npm run build` (tsc -b + vite) | exit 0 (only the chunk-size warning) |
| `web`: `npm test` | **295 tests / 73 suites: 295 pass, 0 fail** |
| `e2e`: `npx playwright test tests/audit-page-smoke.spec.ts tests/audit-page-live-refresh.spec.ts` | **3/3 pass** in the first run and in two later official runs (2 of 2 re-runs, ~22–24s each). See F1 for the flake. |

## 4. Mutation results (all files restored; SHA-256 verified after each)

Final hashes: `executionLock.ts` = `0ED7DB24…B312C`; `auditPageLogic.ts` = `DEAA05E9…F0BA`. Both identical to the pre-mutation hashes. `scheduler.ts` and `ticketSlaBreach.ts` were also hash-verified as restored.

| ID | Mutation | Expected | Observed |
|---|---|---|---|
| M-jobs | Remove `"jobs.changed"` from `AUDIT_PAGE_LIVE_EVENTS` | jobs E2E fails | **Killed.** Fails at the fresh-run-id visibility assertion. Only valid on a scheduler-free API; the first four attempts failed with 409 for an unrelated reason (F1). |
| M-limit | Delete the `connection_limit=1` line | unit fails | **Killed** (1 fail). |
| M-lock | Ignore the `!locked` path | cross-session test fails | **Killed** (2 fails: unit and HTTP). |
| M-settings (opt.) | Remove `"settings.changed"` | settings E2E fails | **Killed.** |
| M-interval (opt.) | Remove the interval `abandon()` | scheduler test fails | **Killed.** |
| M-boot (extra) | Remove the boot `abandon()` | scheduler test fails | **SURVIVED** (2/2 pass). |
| M-sla-loc (extra) | Remove `locationId` from the SLA audit | `audit.sla-scope.db` fails | **Killed.** |

Cleanup: no `.bak_*` files created. Scratch scripts (`api/_audit_scratch.mjs`, `api/_audit_noscheduler.ts`) deleted. Temp logs removed. My ad-hoc API and Vite servers were stopped (ports 4000 and 5173 free).

## 5. Remaining risks / why not PASS

- **F1 (medium): the jobs E2E can hit 409 against the scheduler.** `startJobScheduler()` fires a full job cycle 15s after API boot, then every 5 minutes. The test calls `POST /jobs/run` with no 409 handling or retry. If the UI login or Vite cold start pushes the POST past about 15s after boot, or if the cycle is still running, it fails with `job_already_running`. I saw this 6 times: once on a cold Vite after a source edit, and on repeat runs against servers I had started myself.
  - **Why it is slow on this DB:** the local P1 DB had about 899 overdue tickets. The SLA job writes audit rows and notifications per ticket and took roughly 6 minutes per cycle, holding the advisory lock the whole time. This is a P1 DB accumulation effect, not proof of a prod issue, but it means local reruns can fail.
  - **Consequence for M-jobs:** a failing mutation run can be a false kill (409), not evidence of mutation sensitivity. I got a valid kill only after switching to a scheduler-free API.
  - **Fix:** retry on 409, or disable the scheduler in E2E.
- **F2 (low): the boot-time stale sweep is not independently tested.** The test uses a 40ms interval, so the first interval tick satisfies "boot sweep called". With the default interval the boot sweep matters, and nothing pins it. Use a large interval and assert the sweep ran before the first tick.
- **F3 (medium, process): not committed.** HEAD does not contain the Audit work. The tree is concurrently being edited by other work. READY is true only for the tree as it was during my run.
- **F4 (low): `connection_limit` coverage is URL-only.** The unit test proves the URL string, not that Prisma actually pins one backend. Deleting the pin is caught, but a regression in how Prisma applies it is not.
- **F5 (low, doc): `deploy.md` does not cover crash recovery.** It does not cover what happens to the session advisory lock when a process dies mid-cycle. I saw `ticket_sla_breach` JobRun rows left `running` after I killed API servers mid-job. These are cleared only by the 30-minute TTL. Orphans exist, and `deploy.md` mentions the TTL but not this path. The lock itself released quickly in my runs (local Postgres on port 5433).
- Not exhaustively re-proven: every one of BUG-02..05, 08..10 and NEW-01/02/04/07 with its own mutation. Only the suites plus the SLA-scope mutation were checked.

## 6. Is "follow-up READY" justified now?

**Conditionally.** The R1/R2/R3/R5 closures are real and demonstrably mutation-sensitive, and gates are green on a fresh run. I would not call it unconditionally READY because of F1 (E2E flake that can mask or fake a mutation result), F2 (boot sweep unpinned) and F3 (nothing committed). Accept READY for "functional closure of the audit remediation in the working tree". Do not accept it for "release-ready" until the Audit changes are committed and the jobs E2E tolerates a concurrent scheduler cycle.

---

## 7. Post-pass-check fixes (same day)

| Finding | Fix |
|---|---|
| F1 jobs E2E 409 | `DISABLE_JOB_SCHEDULER=1` in Playwright API `webServer` env + `postJobRunWhenFree` 409 retry; `api/src/index.ts` honors the flag |
| F2 boot abandon unpinned | Separate test with `intervalMs=60_000` asserts exactly one boot sweep before any tick; M-boot now fails that test |
