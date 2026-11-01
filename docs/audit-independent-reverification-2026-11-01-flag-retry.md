# Independent re-verification — Audit remediation after flag / retry / docs fixes

Date: 2026-11-01. Auditor: independent. I did not implement the remediation. I treated every prior doc as a claim and re-checked code and re-ran tests myself.
DB: `maintenance_p1_test` only, via `runWithP1Isolation.mjs` and the Playwright API `registerP1TestEnv.mjs` webServer command.

## 1. Verdict: **PASS_WITH_RISKS**

The claimed fixes exist and work. All gates are green. The three required mutations (M-flag, M-retry, M-boot) are caught by the tests.

I am not giving a clean PASS, for five reasons:

- **The `index.ts` flag wiring is not pinned by any test.** I removed the check there and every E2E gate stayed green (see §4, M-index).
- **The startup warn log has no automated assertion.** It is observed only by hand, in the Playwright webServer log.
- **The `jobRun.ts` retry loop has a live-lock hazard.** One mutation hangs the runner instead of failing it (§4, M-retry-C).
- **Nothing stops `DISABLE_JOB_SCHEDULER=1` in production.** `env.ts` rejects the E2E rate-limit flag in production but has no equivalent guard for this one.
- **The Audit work is not committed.** It is all uncommitted working-tree changes.

## 2. Claim → evidence → status

| # | Claim | Evidence (re-checked) | Status |
|---|---|---|---|
| 1 | `isJobSchedulerDisabled()` plus `schedulerFlag.test.ts` is mutation-sensitive | `schedulerFlag.ts` is `env.DISABLE_JOB_SCHEDULER === "1"`. The test passes injected env objects and covers `"1"`, unset, `""`, `"0"` and `"true"`. **M-flag** (always `false`) → test FAILS (1 fail, restored, hash matches). Always-`true` would fail the second `it` (inferred, not run). | **REAL** for the pure function. **PARTIAL** for wiring (see M-index). |
| 2 | Startup warn `event=job_scheduler_disabled` | `index.ts:25-36` calls `console.warn` with JSON `{level:"warn", event:"job_scheduler_disabled", reason}` and returns before `startJobScheduler()`. **Observed live** in the Playwright webServer output: `[WebServer] {"timestamp":"2026-11-01T13:13:32.220Z","level":"warn","service":"maintenance-api","event":"job_scheduler_disabled","reason":"DISABLE_JOB_SCHEDULER=1"}`. In the M-index run the line was absent, as expected. | **REAL** (code and observed). **No automated assertion** (R1). |
| 3 | Docs: `api/.env.example` and `deploy.md` § DISABLE_JOB_SCHEDULER | `.env.example:12-16` has a commented `# DISABLE_JOB_SCHEDULER=1` with a never-in-production warning and the warn event name. `deploy.md:91-95` has the section: skips `startJobScheduler()`, Playwright reason, warn event, "Never set in staging/production". Both match the code. | **REAL** |
| 4 | `jobRun.ts` plus `jobRun.spec.ts` cover 409→200, non-409 fail and timeout, and are mutation-sensitive | The spec has three tests: 409,409,200 with exact sleep args `[25,25]`; 403 fails on the first call with no sleep; always-409 with an injected clock fails with "still 409 after 100ms". Mutations in §4: A, B and D are caught. C is caught only by a hang. | **REAL**, with a robustness gap (R2) |
| 5 | F1/F2 are still real | **F1**: `playwright.config.ts:60` sets `DISABLE_JOB_SCHEDULER: "1"` in the API webServer env, and a fresh server logs the warn line. `audit-page-live-refresh.spec.ts` goes through `postJobRunWhenFree`, and the jobs test took 4.0–4.4s on fresh runs (no retry sleeps). **F2**: `scheduler.test.ts` "sweeps stale JobRuns once on boot" uses a 60 000 ms interval, asserts exactly 1 abandon call, and re-asserts after 80 ms. **M-boot** FAILS it. **M-interval** FAILS the interval test. | **REAL** |
| 6 | Earlier closures | See below. | |
| 6a | Discriminating jobs E2E | The test snapshots `beforeIds`, triggers the job, finds a NEW id for `lock_inactive_users` with status ok/running, and asserts `[data-job-run-id=<freshId>]` is visible with no reload. This is discriminating against pre-existing P1 rows. Weakness: an unrelated concurrent new run with the same key would also match. With the scheduler disabled that is unlikely. | **REAL** |
| 6b | `connection_limit` unit | `executionLock.test.ts` passed. I did not re-mutate it. | **REAL** (tests green) |
| 6c | Cross-session lock | `executionLock.test.ts` ("shared scheduled/manual job execution lock") and `jobs.run.http.test.ts` ("409 while the shared lock is held, then succeeds after release") pass. | **REAL** |
| 6d | Interval abandon | M-interval FAILS the test. | **REAL** |
| 6e | Settings E2E | `events panel refreshes on settings.changed` passed on 3 fresh runs. The assertion is on a unique reason string. | **REAL** |
| 6f | Deploy lock section | `deploy.md` § Background job lock matches the code: session lock, PgBouncer warning, `connection_limit=1`, 30 min TTL swept on boot and each tick. Verified by reading against `scheduler.ts` and `executionLock.ts`. | **REAL** |
| 7 | `audit-remediation-followup.md` READY | See §6. | **Qualified** |

## 3. Gates and counts

| Gate | Result |
|---|---|
| api `npm run lint` (oxlint) | exit 0 |
| api `npm run build` (tsc) | exit 0 |
| `runWithP1Isolation.mjs --test-concurrency=1` on the 13 requested files | exit 0. **46 tests, 14 suites, 46 pass, 0 fail, 0 skipped, 0 cancelled**. All 13 files ran: `executionLock`, `runLifecycle`, `scheduler`, `schedulerFlag`, `audit.scope`, `audit.producers`, `audit.backfillLocationIds`, `authorizeLiveEvent`, `jobs.db`, `jobs.run.http`, `scenarios/scheduler`, `audit.sla-scope.db`, `audit.overdue-scope.db`. |
| web `npm run lint` | exit 0 |
| web `npm run build` | exit 0 (PWA generated) |
| web `npm test` | **295 tests, 73 suites, 295 pass, 0 fail** |
| e2e `playwright test tests/helpers/jobRun.spec.ts tests/audit-page-smoke.spec.ts tests/audit-page-live-refresh.spec.ts` | **6/6 pass**, three separate fresh-server runs (15.2–16.8s). Ports 4000 and 5173 were verified free beforehand, without `CI`. The warn log was seen on the first run. After each run I killed the orphan Vite process that Playwright leaves on port 5173 under Windows. |

I did not run the full api `src/**` suite or the full e2e suite.

## 4. Mutations (restore + SHA-256 verified)

| ID | Mutation | Expected | Observed |
|---|---|---|---|
| **M-flag** (required) | `isJobSchedulerDisabled` returns `false` | `schedulerFlag` test fails | **CAUGHT**. 1 fail, 1 pass. Hash restored. |
| **M-retry-A** | 409 treated as success | `jobRun.spec` fails | **CAUGHT** (tests 1 and 3 fail) |
| **M-retry-B** | Fail on any non-200, including 409 (no retry) | `jobRun.spec` fails | **CAUGHT** (tests 1 and 3 fail) |
| **M-retry-C** | Remove `await sleep(...)` | spec fails | **Caught only by a hang.** Test 3 becomes a microtask-only busy loop because the injected `now` never advances. It starves the event loop, so Playwright's 60s timeout cannot fire and the worker pinned a CPU. I let it run about 4 minutes and then killed the worker; it then reported "2 failed". The mutation is detected, but only by a stuck runner. R2. |
| **M-retry-D** | Never fail on non-409 | spec fails | **CAUGHT** (test 2 fails) |
| **M-retry-E** | Timeout returns `last` instead of failing | — | Not run. My string replace did not match, and I did not retry it. The test-3 regex would be expected to catch it. |
| **M-boot** (required) | Remove the boot `abandon()` call in `startJobScheduler` | boot test fails | **CAUGHT** ("sweeps stale JobRuns once on boot" fails; 1 fail, 2 pass). Hash restored. |
| **M-interval** | Remove the interval-tick `abandon()` | interval test fails | **CAUGHT**. Hash restored. |
| **M-index** (extra, adversarial) | `index.ts`: `if (false && isJobSchedulerDisabled())`, so the flag is ignored, no warn and the scheduler starts | Some gate fails | **SURVIVED**. 6/6 E2E pass, the warn line is absent, and no unit test covers `index.ts`. |
| M-jobs, M-limit | Optional | — | Not run. |

All mutated files (`schedulerFlag.ts`, `jobRun.ts`, `scheduler.ts`, `index.ts`) were restored. SHA-256 matched the pre-mutation hashes. `executionLock.ts` and `runLifecycle.ts` were hashed and unchanged.

## 5. Remaining risks

- **R1 (medium): flag wiring is untested.** `schedulerFlag.test.ts` pins only the pure predicate. The `index.ts` call site (skip `startJobScheduler`, emit the warn) is covered by nothing. M-index survived. The E2E run is short and `jobRun.ts` retries 409 for up to 120s, so removing the Playwright env flag would probably still pass, slowly. The flag in `playwright.config.ts` is likewise not pinned. Suggested fix: extract `bootJobScheduler({start, log, env})` and unit-test it, or have the CI log line be asserted.
- **R2 (low–medium): `postJobRunWhenFree` can live-lock.** With an injected `now` that doesn't advance and no sleep, it spins on microtasks and Playwright cannot time it out. Production use is safe because the real `Date.now` advances. Add a max-iteration guard or a real macrotask yield.
- **R3 (medium, ops): no production guard.** `env.ts` throws if `E2E_DISABLE_RATE_LIMIT` is enabled in production. It has nothing for `DISABLE_JOB_SCHEDULER`. A leaked flag in prod silently stops SLA, overdue and lock jobs, and the only signal is a warn log. Docs say "never set" but nothing enforces it.
- **R4: Audit work is uncommitted.** HEAD is `2b2aa00` ("Harden people access…", Oct 28). `git status` shows 100+ modified or untracked paths, including `schedulerFlag.*`, `jobRun.*`, `audit.*` and the new docs. Nothing is reviewable as a commit, and nothing is protected from loss or accidental revert.
- **R5: partial scope.** I ran the 13 requested API files, not the full API suite. Web `npm test` was run. The full e2e suite was not.
- **R6: job-test weak spot.** The jobs test matches any new ok/running `lock_inactive_users` row. It is reliable only while the scheduler is off or no other instance is running.
- **R7 (low): doc drift.** I did not recheck `audit-remediation-followup.md` line by line. Per the prior audit it still cites older web test counts (292 vs the current 295).
- **R8: log-asserting spec absent.** The warn event name is only a string in `index.ts`, `deploy.md` and `.env.example`. Renaming it would break nothing.
- **R9: M-index side effects.** M-index started the real scheduler on the P1 test DB for a few seconds, and I killed the API mid-boot. Any orphan `running` JobRun is closed by the stale sweep (30 min TTL). It was P1 only.

## 6. Is READY justified now?

**Qualified yes for functional and behavioural readiness; no for "fully locked down".**

- **Behaviour:** the Audit gates are green.
  - 46 API tests, 295 web tests and 6 E2E tests pass.
  - Lint and build are clean on api and web.
  - M-flag, M-boot and M-interval are caught.
  - M-retry-A/B/D are caught; M-retry-C is caught only by a hang.
  - The warn log and docs exist and are accurate.
- **What would make a clean PASS:**
  1. Pin the `index.ts` wiring with a test or a log assertion (R1).
  2. Guard the flag in production or reject it in `assertEnv` (R3).
  3. Harden the retry loop against live-lock (R2).
  4. Commit the work (R4).
- **Verdict stands at PASS_WITH_RISKS.** The remaining issues are about test strength and operations safety, not about broken functionality I could reproduce.

## 7. Housekeeping

- DB used: `maintenance_p1_test` only.
- Scratch files I created (backups of mutated files and run logs in `%TEMP%`) are removed. No `.bak` or `.orig` files remain in the repo.
- This report is new; no prior doc was overwritten.

---

## 8. Post-audit fixes (same day)

| Gap | Fix |
|---|---|
| R1 index wiring unpinned | `afterBootstrapStartJobs` + unit asserts warn payload / no start; `index.ts` source contract forbids direct `startJobScheduler()` |
| R1 warn log unasserted | Boot unit test asserts `event=job_scheduler_disabled` on the warn payload |
| R3 prod allows flag | `assertEnv` throws on `DISABLE_JOB_SCHEDULER=1` in production (+ `env.test.ts`) |
| R2 retry hang | `maxAttempts` cap; new jobRun spec for no-op sleep + frozen clock |
