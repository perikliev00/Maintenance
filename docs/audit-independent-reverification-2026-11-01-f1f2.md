# Audit module — independent re-verification after F1/F2 fixes (2026-11-01)

Auditor stance: adversarial; did not implement the remediation. Prior docs were treated as claims only. Everything below was re-run by me.
DB: `maintenance_p1_test` only. Scenario tests ran through `api/tests/runWithP1Isolation.mjs`. The Playwright API server ran through `registerP1TestEnv.mjs`. A DB probe confirmed `current_database() = maintenance_p1_test`.
Prior reports were not overwritten.

## 1. Verdict

**PASS_WITH_RISKS**

F1 (jobs E2E 409 flake) and F2 (boot-abandon not pinned) are fixed and mutation-verified. All earlier closures are still real. Every gate is green.

It is not a clean PASS for four reasons:
- Nothing is committed.
- The `DISABLE_JOB_SCHEDULER` flag and the 409 retry are not themselves pinned by any test.
- One prior mutation claim did not reproduce (M-lock on the HTTP test).
- The flag is undocumented and gives no startup signal.

## 2. Claim → evidence → status

| Claim | Evidence (my own re-check) | Status |
|---|---|---|
| **F2** Separate boot test with large `intervalMs` pins the boot sweep | `scheduler.test.ts` has `sweeps stale JobRuns once on boot before any interval tick`. It uses `startJobScheduler(60_000, …, abandon)`, asserts `abandonCalls === 1` within 1s, then asserts it is still 1 after 80ms. **M-boot:** I removed the boot `void abandon().catch(warnAbandonFailed)`. The boot test failed (`boot must call abandon exactly once before the first interval`, 3 tests: 2 pass, 1 fail). The interval test and the overlap test stayed green, as expected. | **REAL** |
| **F1a** `DISABLE_JOB_SCHEDULER=1` in the Playwright API env; `index.ts` honors it | `playwright.config.ts:60` sets it in the API `webServer.env`. `index.ts:23` has `if (closing \|\| process.env.DISABLE_JOB_SCHEDULER === "1") return;`. I started the API myself with the flag, waited about 30s (past the 15s boot cycle), and found 0 JobRuns started in that window. Fresh-server E2E runs passed 4/4 (below), and the jobs test took 4.3–5.4s, so there was no retry sleep. | **REAL** functionally. **PARTIAL** on pinning, see R2/R3. |
| **F1b** `postJobRunWhenFree` 409 retry | The code exists: it retries 409 every 1.5s for up to 120s, fails fast on any non-200/409, and `test.setTimeout(180_000)` is set. The retry branch was **never executed** in any run of mine, because the scheduler was off. It is untested code. | **UNEXERCISED** (plausible by inspection) |
| Discriminating jobs E2E (new run id + `data-job-run-id`) | The spec snapshots `beforeIds` and POSTs `lock_inactive_users`. It polls for a fresh row not in `beforeIds`, then asserts `[data-job-run-id="<freshId>"]` is visible with no reload. **M-jobs:** with `"jobs.changed"` removed from `AUDIT_PAGE_LIVE_EVENTS`, the test failed at `spec.ts:97`: `locator('[data-job-run-id="cmvxu9ptb0008vvdkbb29erin"]') … element(s) not found`, after the full 20s. There was no 409 in the failure. It failed because the live refresh did not happen. | **REAL** (right reason) |
| `connection_limit=1` unit test | `executionLock.test.ts › advisoryLockDatabaseUrl forces connection_limit=1`. **M-limit:** I deleted `parsed.searchParams.set("connection_limit","1")`. That test failed (`actual '20', expected '1'`; 4 tests: 3 pass, 1 fail). | **REAL** (URL-level only, see R6) |
| `deploy.md` § Background job lock | `docs/operations/deploy.md:80-89` covers direct Postgres or session pooling, PgBouncer transaction pooling breaking the lock, `connection_limit=1`, the idle-session timeout, and the 30-minute stale TTL swept on boot and every tick. The code matches the doc. The doc says nothing about `DISABLE_JOB_SCHEDULER` and nothing about crash recovery. | **REAL**, with gaps (R3) |
| Cross-session advisory lock | `executionLock.test.ts › returns acquired:false when another session holds the Postgres advisory lock` passes. **M-lock:** I replaced `if (!rows[0]?.locked)` with `if (false as boolean)`. The cross-session unit test failed. `jobs.run.http.test › returns 409 while the shared lock is held` **did not fail** (7 tests: 6 pass, 1 fail). The prior pass-check claimed both failed. | Unit **REAL**. HTTP test is not a reliable discriminator (R4). |
| Interval abandon | **M-interval:** I removed the interval-tick `abandon()`. `sweeps stale JobRuns again on each interval tick` failed after 2023ms. The boot and overlap tests stayed green. | **REAL** |
| Settings E2E | Passed on all 4 clean runs. I did not re-run M-settings (optional); the prior auditor reported it killed. | **REAL (unmutated pass only)** |
| `docs/audit-remediation-followup.md` "READY" | Gates are green (§3). The follow-up doc still says 292 web tests, but the suite now has 295. | **READY for the working tree only** (§6) |
| `docs/audit-independent-verification.md` BUG/NEW backlog | Spot-checked through the green suites: `audit.sla-scope.db`, `audit.overdue-scope.db`, `audit.producers`, `audit.scope`, `authorizeLiveEvent`, `jobs.run.http` (NEW-05 view-only 403 on POST), the web `auditLiveEvents` / `auditPageLogic` / `audit/labels` tests. I did not re-prove each BUG-0x/NEW-0x with its own mutation. | **HOLDS (spot)** |

## 3. Gates (run by me)

| Gate | Result |
|---|---|
| `api` `npm run lint` | exit 0 |
| `api` `npm run build` | exit 0 |
| `api` `runWithP1Isolation --test-concurrency=1` on the 12 requested files | **44 tests / 13 suites: 44 pass, 0 fail, 0 cancelled, 0 skipped** (the prior run had 43; +1 is the new boot test) |
| `web` `npm run lint` | exit 0 |
| `web` `npm run build` | exit 0 (tsc + vite + PWA) |
| `web` `npm test` | **295 tests / 73 suites: 295 pass, 0 fail** |
| e2e `npx playwright test tests/audit-page-smoke.spec.ts tests/audit-page-live-refresh.spec.ts` | **3/3 pass**, repeated on 3 separate fresh-server runs (15.1–15.8s). Ports 4000 and 5173 were free before each run, so Playwright started the API with `DISABLE_JOB_SCHEDULER=1`. |

## 4. Mutations (all restored; SHA-256 verified)

| ID | Mutation | Required result | Observed |
|---|---|---|---|
| **M-boot** | Remove the boot `abandon()` in `scheduler.ts` | The boot-specific test fails | **Killed** by the boot test only |
| **M-jobs** | Remove `"jobs.changed"` from `AUDIT_PAGE_LIVE_EVENTS` | Jobs live E2E fails, not for a 409 | **Killed** at the `data-job-run-id` visibility assertion, with no 409 |
| **M-limit** | Delete the `connection_limit=1` set | Unit fails | **Killed** |
| M-interval (opt.) | Remove the interval `abandon()` | Interval test fails | **Killed** |
| M-lock (opt.) | `!locked` → `false` | Cross-session test fails | Unit **killed**. The HTTP 409 test **survived** this run. |
| M-flag (not run) | Remove the `DISABLE_JOB_SCHEDULER` check | n/a | Not run. It would start a multi-minute SLA cycle on P1 (about 900 overdue tickets) and leave orphan `running` JobRuns. |

Final SHA-256 prefixes, all identical to pre-mutation:

| File | Hash prefix |
|---|---|
| `scheduler.ts` | `A44090592A9AC51A` |
| `executionLock.ts` | `0ED7DB245AA3097D` |
| `auditPageLogic.ts` | `DEAA05E94A59F5B7` |
| `index.ts` | `A28737818AC07481` |
| `playwright.config.ts` | `CA983E38DBC7F785` |
| `audit-page-live-refresh.spec.ts` | `F0809CDF9391E91A` |
| `scheduler.test.ts` | `2048680F80A79298` |
| `executionLock.test.ts` | `43384D2D70C62A20` |

I verified these by `Get-FileHash` after the last mutation.

## 5. Remaining risks

- **R1 (medium, process): Audit work is not committed.** HEAD is `2b2aa00` ("Harden people access concurrency…"), which is unrelated to Audit. `git status` shows about 158 entries. `docs/audit-*.md`, `audit.producers.ts`, `auditPageLogic.ts`, both Audit E2E specs and the `20261101140000_backfill_audit_location_ids` migration are untracked, and `deploy.md` is modified, not committed. The tree is shared with other work, including Housekeeping, so "READY" describes a moving working tree, not an artifact.
- **R2 (low–medium): the F1 flag has no regression test.**
  - Nothing asserts that `index.ts` honors `DISABLE_JOB_SCHEDULER=1`.
  - My probe was positive-only. I did not run a negative control (flag unset → JobRuns appear).
  - Each E2E run lasts about 5s, shorter than the 15s boot delay. Fresh-server E2E therefore passes whether or not the flag works. The flag only matters on later runs against a long-lived server.
  - If `index.ts` stopped honoring the flag, or `reuseExistingServer` attached to an API started without it, nothing but the retry would save the test.
- **R3 (low–medium, ops): `DISABLE_JOB_SCHEDULER` is undocumented and silent.** It appears only in `playwright.config.ts`, an `index.ts` comment and the prior audit doc. It is not in `deploy.md`, `.env.example`, or any env validation. It emits no startup log line. If it leaked into a production env, background jobs (SLA breach, overdue sessions, stale abandon) would stop with no signal. `deploy.md` also says nothing about crash recovery of orphan `running` rows (the prior F5), beyond the 30-minute TTL.
- **R4 (low): the HTTP 409 lock test is timing-dependent.** In `jobs.run.http.test.ts:55-62` the holder starts `runWithJobExecutionLock`, then the test does only `await Promise.resolve()`. `activeExecution` is set only after the async `pg_try_advisory_lock` round-trip. So the POST races lock acquisition, and under M-lock the test survived. The earlier claim that M-lock fails both tests is not reproducible. The cross-session unit test is the only reliable guard for the advisory-lock path.
- **R5 (low): the 409 retry is untested.** Retry is only needed on a reused server where the scheduler is enabled. With a scheduler cycle in that window, a scheduler-produced `lock_inactive_users` row could also be mistaken for the "fresh" row. That is negligible with the flag on.
- **R6 (low): `connection_limit` coverage is URL-only.** The unit test proves the URL string, not that Prisma pins one backend. Real PgBouncer transaction-pooling behavior is not tested.
- **R7 (doc drift, low):** `audit-remediation-followup.md` still says "292 pass" for web (now 295) and says "Няма" open items. It does not mention the F1/F2 fixes or `DISABLE_JOB_SCHEDULER`.
- **Not re-proven individually:** BUG-02..05, 08..10 and NEW-01/02/04/07. They were covered by suites only. M-settings was not re-run.

## 6. Is "READY" justified now?

**Conditionally yes, for "functional closure in the working tree". No for "release-ready".**

- The F1 and F2 fixes are real. F2 is a hard, correctly targeted mutation kill. F1 removes the flake: three consecutive fresh-server runs passed, and M-jobs fails for the right reason.
- Earlier closures still hold: the discriminating jobs E2E, the `connection_limit` unit test, `deploy.md`, the cross-session advisory lock unit test, interval abandon, and the settings E2E.
- READY should not be called unconditional until:
  1. the Audit changes are committed;
  2. the scheduler-disable flag is documented and given a startup log, ideally with a small unit or integration test pinning it;
  3. the HTTP lock test is made deterministic or its claim is dropped.
- A clean PASS was withheld because R1 and R2 are real gaps and one prior mutation claim did not reproduce.

## 7. Housekeeping

- No `.bak` or scratch files remain. The temporary probe `api/_f1f2_probe.mts` was deleted. Temp logs and `.orig` copies were removed. `e2e/test-results` (gitignored) was cleared.
- The API I started for the flag probe was stopped. Ports 4000 and 5173 are free.
- `api/__pycache__` is a pre-existing directory from 15 Oct and is not mine.

---

## 8. Post-audit fixes (same day)

| Gap | Fix |
|---|---|
| Flag untested | `isJobSchedulerDisabled()` + `schedulerFlag.test.ts` |
| 409 retry unexercised | Injectable `postJobRunWhenFree` + `e2e/tests/helpers/jobRun.spec.ts` (409→200, non-409 fail, timeout) |
| No startup log / docs | warn `event=job_scheduler_disabled`; `api/.env.example`; `deploy.md` § DISABLE_JOB_SCHEDULER |
