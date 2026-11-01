# Independent re-verification — Audit remediation after wiring / prod-guard / retry-harden fixes

Date: 2026-11-01. Auditor: independent. I did not implement the remediation. I treated every FIXED/READY line and prior report as a claim, re-read the code, re-ran the gates and ran my own mutations.
DB: `maintenance_p1_test` only, via `runWithP1Isolation.mjs` / `registerP1TestEnv.mjs` (the Playwright API webServer uses the same env). Housekeeping-sectors work was not examined.

## 1. Verdict: **PASS_WITH_RISKS**

Every claimed fix exists and is mutation-verified at the level the claim states. All gates are green. I am not giving a clean PASS, for four reasons:

1. **The `index.ts` contract test is a regex over raw source, and only guards the shape of the call, not its arguments.** `schedulerBoot.test.ts` greps `index.ts` for `afterBootstrapStartJobs(` and rejects `startJobScheduler(`. I found five wiring bypasses that survive it and every other gate, including the full E2E set (§4, S2–S6). The sharpest one: passing `env: {}` to the helper silently disables the flag in production and E2E. The warn line vanished and 7/7 E2E stayed green.
2. **The helper, the prod guard and the retry cap are each pinned.** The only remaining hole is the `index.ts` call-site arguments (item 1).
3. **`DISABLE_JOB_SCHEDULER` is rejected only when `NODE_ENV=production`.** A staging host with a different `NODE_ENV` is unenforced. The docs say "never in staging", but nothing checks it.
4. **The Audit work is not committed.** HEAD is `2b2aa00` (the people-access commit). `git status` shows 169 modified or untracked paths, including every file in this audit. This is a process point, so I accept it as out-of-scope for the code verdict, but nothing is protected or reviewable as a commit.

## 2. Claim → evidence → status

| # | Claim | Evidence (re-checked) | Status |
|---|---|---|---|
| 1 | `afterBootstrapStartJobs` + unit test asserts the warn payload | `schedulerBoot.ts` skips when `closing`, warns and returns when `isJobSchedulerDisabled(env)`, else `start()`. The test asserts `started==0`, exactly 1 warn, and `event`, `level` and `reason` fields; it also covers flag-unset (start once, no warn) and closing (neither). Six helper mutations were all caught (§4). | **REAL** |
| 2 | `index.ts` source contract forbids a direct `startJobScheduler()` and requires the helper | The contract test passes on current source. Removing the call, replacing it with a direct call, or calling `startJobScheduler()` inside the `start` arrow all fail it. But it is a text grep: an aliased call, a commented-out call, `env: {}`, a no-op `start` and a hardcoded `closing:false` all survive. | **PARTIAL** (shape pinned, arguments and liveness not pinned) |
| 3 | `assertEnv` rejects `DISABLE_JOB_SCHEDULER=1` in production | `env.ts` throws inside the `isProduction()` block after the JWT checks. `index.ts` calls `assertEnv()` first. The `env.test.ts` case uses `validProduction` + the flag and asserts `/DISABLE_JOB_SCHEDULER/`. Four mutations were caught (§4). | **REAL** (production only, see risk R3) |
| 4 | `maxAttempts` on the 409 retry + a jobRun spec for no-op sleep | `jobRun.ts` computes `max(2, ceil(timeout/delay)+5)` and fails with "exceeded N attempts" when it is crossed. The spec has 4 tests, the 4th using a no-op sleep and a frozen clock. **Removing the guard hangs the runner** (60s, killed). With the guard, a removed sleep fails cleanly (2 tests fail, no hang). | **REAL** |
| 5 | `deploy.md` § Background job lock / DISABLE_JOB_SCHEDULER | Matches the code: session advisory lock, PgBouncer transaction-pooling warning, `connection_limit=1`, 30 min stale TTL swept on boot and every tick. The `DISABLE_JOB_SCHEDULER` section matches the warn event and the prod refusal. `api/.env.example` has the commented flag. No `compose.prod.yml` or CI file sets the flag. | **REAL** |
| 6 | Prior closures hold: boot abandon, interval abandon, `connection_limit`, cross-session lock, jobs E2E, settings E2E | All re-mutated or re-run (§3–§4). | **REAL** |
| 7 | `audit-remediation-followup.md` READY | The doc predates the flag, wiring and retry work. It cites web `292 pass` (actual: 295) and never mentions `DISABLE_JOB_SCHEDULER`, `afterBootstrapStartJobs` or the prod guard. | **Qualified** |
| 8 | `audit-independent-verification.md` BUG/NEW backlog | I did not re-audit each BUG/NEW item. I re-ran the producer, scope, backfill, SLA and overdue tests plus the `jobs.run` permission tests (403 for view-only, 403 without `jobs.run`). | **REAL for what was exercised** |

## 3. Gates and counts

| Gate | Result |
|---|---|
| api `npm run lint` (oxlint) | exit 0 |
| api `npm run build` (tsc) | exit 0 |
| `runWithP1Isolation.mjs --test-concurrency=1` on the 15 requested files | exit 0. **62 tests, 17 suites, 62 pass, 0 fail, 0 cancelled, 0 skipped.** Output shows `environment validation` (incl. the prod flag test), `afterBootstrapStartJobs`, `index.ts job-scheduler wiring contract`, the shared execution lock suite, the jobs E2E-style DB suite and the 409 HTTP suite. |
| web `npm run lint` | exit 0 |
| web `npm run build` | exit 0 (PWA generated) |
| web `npm test` | **295 tests, 73 suites, 295 pass, 0 fail** |
| e2e `playwright test tests/helpers/jobRun.spec.ts tests/audit-page-smoke.spec.ts tests/audit-page-live-refresh.spec.ts` | **7/7 pass** (17.2s) on a fresh server. Ports 4000 and 5173 were verified free beforehand, without `CI`. The webServer log shows `job_scheduler_disabled` once. I killed the orphan Vite and API processes afterwards. |

I did not run the full `src/**` API suite or the full E2E suite.

## 4. Mutations (restore + SHA-256 verified, every file's hash matched before and after)

Unit runs used `runWithP1Isolation.mjs` on the named test file. E2E runs used a fresh server with a hard timeout.

| ID | Mutation | Test that must fail | Result |
|---|---|---|---|
| control | no-op edit of `schedulerBoot.ts` | none | 4/4 pass (the harness works) |
| **M-boot-helper** (required) | `afterBootstrapStartJobs` ignores the flag (`false && isJobSchedulerDisabled`) so it always starts | `schedulerBoot.test` | **CAUGHT** ("warns and skips start…") |
| M-boot warn-event | warn `event` renamed | `schedulerBoot.test` | **CAUGHT** |
| M-boot reason | warn `reason` changed | `schedulerBoot.test` | **CAUGHT** |
| M-boot warn-but-start | warns but still calls `start()` | `schedulerBoot.test` | **CAUGHT** |
| M-boot never-start | `start()` removed | `schedulerBoot.test` | **CAUGHT** ("starts when flag unset") |
| M-boot closing | `closing` check removed | `schedulerBoot.test` | **CAUGHT** |
| M-boot env | helper reads `process.env` instead of the injected env | `schedulerBoot.test` | **CAUGHT** |
| M-flag inverted | `=== "1"` becomes `!== "1"` | `schedulerFlag.test` + boot test | **CAUGHT** (4 fail) |
| **M-index-A** (required) | `index.ts`: the helper call replaced with a direct `startJobScheduler();` | contract test | **CAUGHT** |
| **M-index-B** (required) | `index.ts`: helper call removed (import left) | contract test | **CAUGHT** |
| M-index-B2 | helper call removed and replaced with `void closing;` | contract test | **CAUGHT** |
| S1 | `start: () => startJobScheduler()` | contract test | **CAUGHT** |
| **S2** | `index.ts` passes `env: {}` to the helper, so the flag is ignored | contract test | **SURVIVED**. All E2E also green (7/7); the warn line was absent. |
| **S3** | `const _s = startJobScheduler; _s();` before the helper call | contract test | **SURVIVED** |
| **S4b** | the helper call commented out (`// afterBootstrapStartJobs(`) with the real call turned into `void ({…})` | contract test | **SURVIVED**. The regex matches the comment, so the scheduler never starts. |
| **S5** | `start: () => {}` | contract test | **SURVIVED** (scheduler never runs in prod) |
| **S6** | `closing` hardcoded `false` | contract test | **SURVIVED** |
| **M-prod** (required) | prod-guard `if` block removed from `assertEnv` | `env.test` | **CAUGHT** |
| M-prod2 | guard condition becomes `false` | `env.test` | **CAUGHT** |
| M-prod3 | the whole `isProduction()` block disabled | `env.test` | **CAUGHT** (4 fail) |
| M-prod4 | guard compares to `"true"` instead of `"1"` | `env.test` | **CAUGHT** |
| **M-retry-hang** (required) | `maxAttempts` guard removed | no-op sleep test | **HANG, as the prior note predicted.** The first 3 tests pass, then test 4 never returns: the microtask-only loop starves the event loop. After 60s I killed the process tree. This proves the guard is what prevents the hang. |
| M-retry-C | `await sleep()` removed, guard kept | spec | **CAUGHT cleanly** (2 fail in 7s, "exceeded 9 attempts", no hang) |
| M-retry-cap1 | cap forced to 1 | spec | **CAUGHT** |
| M-retry-cap ×1e6 | cap multiplied by 1,000,000 | — | **Survived, not a real hang.** A finite 9M-iteration cap finishes in 1.5s, so the spec cannot detect a huge-but-finite cap. |
| M-boot-abandon | boot `abandon()` removed in `scheduler.ts` | `scheduler.test` | **CAUGHT** |
| M-interval-abandon | interval `abandon()` removed | `scheduler.test` | **CAUGHT** |
| M-connection_limit | `connection_limit=1` stripped | `executionLock.test` | **CAUGHT** |
| M-advisory-lock | `pg_try_advisory_lock` replaced with `SELECT true` | `executionLock.test` | **CAUGHT** (cross-session holder test) |
| M-jobs | all three `publish("jobs.changed")` calls removed | live-refresh E2E | **CAUGHT** (jobs-panel test fails after 25s, "element(s) not found"; the settings test still passes) |

## 5. Remaining risks

- **R1 (medium): the `index.ts` call-site is only grep-pinned.** S2, S3, S4b, S5 and S6 all survive. S2 and S5 are production-impacting: the flag is ignored, or the scheduler is silently never started, and no gate fails. Fix: extract `bootstrapJobs()` that builds the deps (using `process.env`) and test that, or assert on the `start` identity through a small `main()` seam. Failing that, use a TypeScript AST check instead of a regex.
- **R2 (low): contract regex also matches comments.** The `afterBootstrapStartJobs(` match is satisfied by a commented line (S4b).
- **R3 (low–medium): the prod guard is `NODE_ENV=production` only.** A staging deployment with another `NODE_ENV` can set the flag. Only `"1"` is rejected; other truthy strings are neither rejected nor honoured, which is consistent with `isJobSchedulerDisabled`.
- **R4 (process): the Audit work is uncommitted.** HEAD is `2b2aa00`, with 169 modified or untracked paths. Nothing is reviewable as a commit or protected from an accidental revert.
- **R5 (low): `jobRun.spec` cannot detect a huge-but-finite attempt cap.** The no-op-sleep test detects only a missing cap, not a lax one.
- **R6 (low): doc drift.** `audit-remediation-followup.md` still says 292 web tests, and has no mention of the wiring, prod guard or retry cap.
- **R7 (scope): partial runs.** I ran the 15 requested API files, web `npm test` and the 3 requested E2E files. I did not run the full API suite or the full E2E suite, and I did not re-audit every BUG/NEW item from `audit-independent-verification.md`.
- **R8 (low): jobs E2E selectivity.** The jobs live-refresh test matches any new ok/running `lock_inactive_users` row, so it is reliable only while the in-process scheduler is disabled.

## 6. Is READY justified now?

**Yes for the Audit module's functional readiness. No for "fully locked down".**

- All the specific fixes claimed in §8 of the flag-retry report are real and mutation-verified: the helper (7 mutations caught), the prod guard (4 caught), the retry cap (the hang is proven to be prevented by it; removing the sleep fails cleanly).
- Prior closures (boot and interval abandon, `connection_limit`, advisory-lock cross-session, jobs live E2E, deploy docs) still hold.
- Not yet justified: the wiring claim ("flag wiring pinned") is overstated. The contract test pins the call shape, not its arguments, and S2/S5 would disable the flag or the scheduler in production without any test noticing.
- To reach a clean PASS: close R1 (test the real deps `index.ts` passes, or an AST check), commit the work (R4), and refresh the follow-up doc (R6).

## 7. Housekeeping

- DB used: `maintenance_p1_test` only.
- Every mutated file was restored. SHA-256 hashes of all 11 touched files matched their pre-audit values, and `runLifecycle.ts` was restored after M-jobs. No `.bak` or `.orig` files remain.
- Scratch scripts, logs and backups in `%TEMP%` were deleted, and orphan API and Vite processes on ports 4000 and 5173 were stopped.
- This report is new; no prior doc was overwritten.

---

## 8. Post-audit fixes (same day)

| Gap | Fix |
|---|---|
| R1 `env: {}` / custom `start` | `wireJobSchedulerAfterBootstrap(closing)` hard-wires `startJobScheduler` + `process.env`; flag no longer injectable via env bag |
| R1/R2 weak regex | Contract strips comments; requires exactly `wireJobSchedulerAfterBootstrap(closing)`; forbids `startJobScheduler`, `afterBootstrapStartJobs`, `env:`, hardcoded `false` |
| R3 staging | `assertDisableJobSchedulerAllowed`: reject on production, APP_ENV/DEPLOY_ENV/ENVIRONMENT staging\|prod, or `RELEASE_SHA` set |
