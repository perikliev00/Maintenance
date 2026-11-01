# Independent re-verification — Audit remediation after any-of staging guard, wire bindings and AST contract

Date: 2026-11-01. Auditor: independent. I did not implement the remediation or the later fixes. Every FIXED/DONE/READY line and every prior report was treated as a claim. I re-read the code, re-ran the gates and ran my own mutations.

DB: `maintenance_p1_test` only. Every API run went through `runWithP1Isolation.mjs` / `registerP1TestEnv.mjs`, and the Playwright API webServer uses the same register (`playwright.config.ts`). `.env.p1_test` points at `127.0.0.1:5433/maintenance_p1_test`, and the register throws on any other database name. Housekeeping-sectors work was not examined.

## 1. Verdict: **PASS_WITH_RISKS**

All code claims hold as written, and each is mutation-verified. The four required mutations (M-anyof, M-wire-start, M-ast, M-shadow) are all caught, and so is `wire(false)`. All gates are green. The prior closures still hold.

I do not give a clean PASS for four reasons:

1. **The AST and wire contracts pin shape, not liveness.** Several one-line edits that would stop the scheduler or break shutdown still pass all 8 tests in `schedulerBoot.test.ts` (§4c, §4d).
   - A **parameter or binding-element shadow** of `closing` survives. The contract counts only `VariableDeclaration` nodes.
   - **Dead code** around the wire call survives.
   - A **never-invoked arrow** around the wire call survives.
   - `delete process.env.DISABLE_JOB_SCHEDULER` before the call survives.
   - **Removing `closing = true` from `shutdown`** survives. The shutdown-race guard is unpinned.
   - Inside `wire…()`, `const start = () => {}`, `closing = false;` and an early `return` all survive. The contract only forbids the literal `start: (` and `closing: false`.
2. **The label allowlist has a coverage gap.** The label `production` is in the code but is not exercised by `env.test.ts`. Removing it passes 23/23. Trim and lowercase normalisation is also unpinned: removing either passes 23/23.
3. **The label list is a denylist.** `APP_ENV=live`, `qa`, `prd`, `production-eu` and `staging-1` are **ALLOWED** with `DISABLE_JOB_SCHEDULER=1`. `deploy.md` documents this ("set at least one deploy marker"). The real backstop is `RELEASE_SHA`, which `compose.prod.yml` requires.
4. **Process (accepted as out-of-scope):** HEAD is `2b2aa00`, the people-access commit. `git status` shows 171 modified or untracked paths, including every file in this audit. Nothing is committed or protected.

## 2. Claim → evidence → status

| # | Claim | Evidence (re-checked) | Status |
|---|---|---|---|
| 1 | Any-of staging guard over APP_ENV/DEPLOY_ENV/ENVIRONMENT against {staging, stage, stg, production, prod, preprod, uat} | `env.ts` maps all three to trimmed, lowercased labels, filters empties, then `.some(BLOCKED…)`. Direct `assertEnv()` probe (§4a): `APP_ENV=development`+`DEPLOY_ENV=staging` REJECT; `APP_ENV=""`+`DEPLOY_ENV=staging` REJECT; `APP_ENV=" "`+`ENVIRONMENT=prod` REJECT; DEPLOY_ENV alone, ENVIRONMENT alone, `Production`, `STG`, `preprod` and `uat` all REJECT. M-anyof (first-wins `??`) is caught by 2 tests. | **REAL** for the listed labels. **PARTIAL** for `production`, trim and lowercase, which are unpinned. |
| 2 | env tests cover DEPLOY_ENV alone, ENVIRONMENT=prod, development+staging, empty APP_ENV, aliases | All are present in `env.test.ts`. Mutation proof: dropping DEPLOY_ENV fails 3, dropping ENVIRONMENT fails 1, dropping APP_ENV fails 5, and removing each of `staging`, `stage`, `stg`, `prod`, `preprod` and `uat` fails 1 or more. **Removing `production` fails 0.** | **REAL, with one gap** |
| 3 | `getJobSchedulerWireBindings().start === startJobScheduler` | The test asserts identity. M-wire-start in bindings (`start: (() => {}) as …`) is caught by "pins start identity". | **REAL** |
| 4 | Wire source contract forbids arrow start and hardcoded closing | `start: () => {}` inside `wire()` is caught. `closing: false` / `closing: true` is forbidden by regex. Evasions that survive (§4c): `const start = () => {}`, `closing = false;` before the call, and an early `return`. | **PARTIAL** (forbids the stated literal forms only) |
| 5 | AST contract: one `wireJobSchedulerAfterBootstrap(closing)` CallExpression, one `let closing = false`, no `startJobScheduler` / `afterBootstrapStartJobs` calls | The AST test exists and passes on the current source. A template-string call, `const closing = true`, `wire(false)`, `wire(closing && false)`, `(0, wire)(closing)` and `let closing = true` are all caught. Survives: parameter shadow, binding-element shadow, dead code, never-invoked arrow, `delete process.env.DISABLE_JOB_SCHEDULER`, and removal of `closing = true` in `shutdown`. | **REAL for the stated shape. PARTIAL for liveness.** |
| 6 | `deploy.md` § DISABLE_JOB_SCHEDULER | The 7 labels, the any-of rule, the `RELEASE_SHA` rule, the production refusal and the warn event name `job_scheduler_disabled` all match the code (`env.ts`, `schedulerBoot.ts`). `api/.env.example` matches. The flag is read only from `process.env`: `schedulerFlag.ts` and `schedulerBoot.ts` are the only readers, and no controller reads it. | **REAL** |
| 7 | `audit-remediation-followup.md` READY | Every gate it lists re-ran green. It does not mention the flag, wire or staging work. Its "292 web tests" is stale (now 295), and "Няма" (no open items) is not true of the surviving evasions above. | **Qualified** |
| 8 | `audit-independent-verification.md` BUG/NEW backlog | Not re-audited item by item. I re-ran producers, scope, backfill, SLA, overdue and `authorizeLiveEvent`, `jobs.db`, and `jobs.run.http` (NEW-05 403 for view-only). All pass. | **REAL for what was exercised** |
| 9 | Prior closures hold | All re-mutated (§4d) and all caught. | **REAL** |

## 3. Gates and counts

| Gate | Result |
|---|---|
| api `npm run lint` (oxlint) | exit 0 |
| api `npm run build` (tsc) | exit 0 |
| `node ./tests/runWithP1Isolation.mjs --test-concurrency=1` on the 15 requested files | exit 0. **77 tests, 18 suites, 77 pass, 0 fail, 0 cancelled, 0 skipped.** The 15 files are `executionLock`, `runLifecycle`, `scheduler`, `schedulerFlag`, `schedulerBoot`, `env`, `audit.scope`, `audit.producers`, `audit.backfillLocationIds`, `authorizeLiveEvent`, `jobs.db`, `jobs.run.http`, `scenarios/scheduler`, `audit.sla-scope.db` and `audit.overdue-scope.db`. |
| web `npm run lint` | exit 0 |
| web `npm run build` | exit 0 (PWA generated) |
| web `npm test` | **295 tests, 73 suites, 295 pass, 0 fail** |
| e2e `CI=1 npx playwright test tests/helpers/jobRun.spec.ts tests/audit-page-smoke.spec.ts tests/audit-page-live-refresh.spec.ts` | **7/7 pass** (17.7s). Ports 4000 and 5173 were free beforehand. |

I did not run the full `src/**` API suite or the full E2E suite.

## 4. Mutations

SHA-256 hashes were taken before the run and compared after, for the 10 touched API sources and for `jobRun.ts`. All matched, with 0 mismatches. Each mutation ran through a restore-in-`finally` helper.

### 4a. Direct `assertEnv()` probe (`NODE_ENV=development`, `DISABLE_JOB_SCHEDULER=1`)

| Case | Result |
|---|---|
| **`APP_ENV=development` + `DEPLOY_ENV=staging`** | **REJECT** |
| **`APP_ENV=""` + `DEPLOY_ENV=staging`** | **REJECT** |
| `APP_ENV=" "` + `ENVIRONMENT=prod` | REJECT |
| `DEPLOY_ENV=staging` alone | REJECT |
| `ENVIRONMENT=prod` alone | REJECT |
| `APP_ENV=Production`, `APP_ENV=STG` | REJECT |
| `APP_ENV=development` + `ENVIRONMENT=uat` | REJECT |
| `APP_ENV=preprod` | REJECT |
| `RELEASE_SHA=abc` | REJECT |
| `NODE_ENV=staging` | REJECT (NODE_ENV allowlist) |
| `NODE_ENV=production` (minimal config) | REJECT (fails earlier on DATABASE_URL, which is still a rejection) |
| `APP_ENV=live`, `qa`, `prd`, `production-eu`, `staging-1` | **ALLOWED** (not in the denylist; see risk R3) |
| `RELEASE_SHA=" "` | ALLOWED (treated as unset) |
| `DISABLE_JOB_SCHEDULER=" 1"` or `"true"` with `APP_ENV=staging` | ALLOWED, but `isJobSchedulerDisabled` only honours the exact `"1"`, so the scheduler still runs. No hazard. |
| local, no markers | ALLOWED |

### 4b. Required mutations

| ID | Mutation | Result |
|---|---|---|
| **M-anyof** | Replace the any-of block with a first-wins `APP_ENV ?? DEPLOY_ENV ?? ENVIRONMENT` chain | **CAUGHT**: `env.test` 21/23, failing both the "APP_ENV=development but DEPLOY_ENV=staging" and the "APP_ENV empty string" tests |
| **M-wire-start** (bindings) | `start: (() => {}) as typeof startJobScheduler` | **CAUGHT**: "pins start identity to startJobScheduler" (7/8) |
| **M-wire-start** (inside `wire`) | `afterBootstrapStartJobs({ closing, start: () => {}, warn })` | **CAUGHT**: wire source contract (7/8) |
| **M-ast** | Replace the real call with the template string `` `wireJobSchedulerAfterBootstrap(closing)` `` | **CAUGHT**: AST test (7/8) |
| **M-shadow** | `const closing = true; wireJobSchedulerAfterBootstrap(closing);` | **CAUGHT**: AST test (7/8) |
| M-wire-false | `wireJobSchedulerAfterBootstrap(false)` | **CAUGHT** |

### 4c. Evasion probes (all in `schedulerBoot.test.ts`; "SURVIVES" means 8/8 pass)

| ID | Mutation | Result |
|---|---|---|
| X-and-false | `wire(closing && false)` | caught |
| X-comma-call | `(0, wire)(closing)` | caught (call counted as 0) |
| X-closing-init-true | `let closing = true;` | caught |
| X-optional-call | `wire?.(closing)` | survives. Behaviour is unchanged, so this is benign. |
| **X-param-shadow** | `((closing: boolean) => wire(closing))(true)` | **SURVIVES**. The scheduler never starts. |
| **X-binding-shadow** | `const { closing } = { closing: true }; wire(closing);` | **SURVIVES** |
| **X-dead-code** | `if (false as boolean) { wire(closing); }` | **SURVIVES** |
| **X-never-invoked** | The call is wrapped in an arrow that is never called | **SURVIVES** |
| **X-delete-flag** | `delete process.env.DISABLE_JOB_SCHEDULER;` before the call | **SURVIVES**. The flag is silently ignored. |
| X-extra-closing-var | An extra `const closing2 = true` | survives (harmless) |
| **X-remove-shutdown-assign** | Remove `closing = true` in `shutdown` | **SURVIVES**. Shutdown-race protection is lost. |
| **X-wire-const-start** | In `wire`, `const start = () => {}` after destructuring only `warn` | **SURVIVES** |
| **X-wire-closing-reassign** | In `wire`, `closing = false;` before the inner call | **SURVIVES** |
| **X-wire-early-return** | In `wire`, an early `return` | **SURVIVES** |

### 4d. Staging guard, flag and prior closures

| ID | Mutation | Result |
|---|---|---|
| M-label-staging / stage / stg / prod / preprod / uat | Remove each label from the denylist | all **CAUGHT** (fail 1 to 4) |
| **M-label-production** | Remove `"production"` | **SURVIVES** (23/23) |
| M-drop-DEPLOY_ENV / ENVIRONMENT / APP_ENV | Remove one variable from the array | all CAUGHT |
| **M-no-trim** | Remove `.trim()` | **SURVIVES** (23/23) |
| **M-no-lower** | Remove `.toLowerCase()` | **SURVIVES** (23/23) |
| M-release | `RELEASE_SHA` check disabled | CAUGHT |
| M-assert-removed | `assertDisableJobSchedulerAllowed()` call removed from `assertEnv` | CAUGHT (11 fail) |
| M-prod-guard | `NODE_ENV === "production"` branch disabled | CAUGHT |
| M-flag-ignored | `false && isJobSchedulerDisabled(process.env)` | CAUGHT (2 fail) |
| M-flag-envbag | `isJobSchedulerDisabled({})` | CAUGHT (2 fail). The flag is process.env only. |
| M-flag-default | `schedulerFlag` also accepts `"true"` | CAUGHT |
| M-closing-ignored | `if (deps.closing) return;` removed | CAUGHT |
| M-boot-abandon | Boot `abandon()` removed from `scheduler.ts` | CAUGHT |
| M-interval-abandon | Interval `abandon()` removed | CAUGHT |
| M-connection_limit | `searchParams.set("connection_limit","1")` removed | CAUGHT |
| M-advisory-lock | `pg_try_advisory_lock` replaced by `SELECT true` | CAUGHT (2 fail) |
| M-lifecycle-publish (unit and DB) | `publish("jobs.changed")` removed from `runLifecycle.ts` | CAUGHT (`runLifecycle` + `jobs.db`) |
| M-jobs (E2E) | All `jobs.changed` publishes removed | CAUGHT (live-refresh: 1 failed, 1 passed) |
| M-settings (E2E) | `settings.changed` publish removed | CAUGHT (1 failed, 1 passed) |
| M-retry maxAttempts | `if (false && attempts > maxAttempts)` in `jobRun.ts` | CAUGHT, by a hang: the no-op-sleep test never finishes. I killed it after about 80s. It is detected, but not as a clean assertion failure. |

## 5. Remaining risks

- **R1 (medium): the `closing` and wire contracts do not pin liveness.** The survivors are in §4c.
  - Fix: a `bootstrapJobs(closing)` function tested with a real scheduler spy, or an extended AST check.
  - The extended AST check would count `Parameter` and `BindingElement` declarations named `closing`. It would require the call to be a top-level expression in the `.then` callback. It would require an assignment `closing = true` inside `shutdown`. It would forbid `process.env.DISABLE_JOB_SCHEDULER` in `index.ts`.
- **R2 (low–medium): `wire()` body is regex-guarded.** Replace the regex with an AST check, or test `wire` against a scheduler spy.
- **R3 (medium): the staging guard is a denylist.** `live`, `qa`, `prd`, `production-eu` and `staging-1` are allowed. `deploy.md` documents this. The backstop is `RELEASE_SHA`, so a host outside `compose.prod.yml` and without `RELEASE_SHA` relies on the label set. Prefer an allowlist (`development|test|local|` or unset).
- **R4 (low): test gaps.** No test for the label `production`, and none for trim or lowercase normalisation.
- **R5 (low): the retry-cap regression shows up as a hang, not a failure.**
- **R6 (process, accepted as out-of-scope): all Audit work is uncommitted.** HEAD is `2b2aa00`, with 171 paths modified or untracked.
- **R7 (low): doc drift.** `audit-remediation-followup.md` does not mention the flag, wire or guard, and its web test count (292) is stale.
- **R8 (scope): partial runs.** I did not run the full `src/**` API suite or the full E2E suite, and I did not re-audit each BUG/NEW item.

## 6. READY justified NOW?

- **Functionally: yes.** Every claim, as worded, is true and mutation-verified: any-of staging with aliases, the wire identity, the AST shape contract (template string, shadowing and `wire(false)` all caught), the process.env-only flag, and every prior closure. All gates are green, and the E2E ran on fresh servers.
- **Not a clean PASS.**
  - The contracts still pass trivially adversarial edits (R1, R2) that would silently disable the scheduler or shutdown protection.
  - The `production` label and the trim and lowercase handling are unpinned (R4).
  - The label list is a denylist (R3).
  - The work is uncommitted (R6, accepted).
- **Net: READY is defensible for merge-readiness only with R1 to R4 acknowledged.**

## 7. Post-audit hardening (same day, toward clean PASS)

| Gap | Fix |
|---|---|
| Denylist miss (`live`/`qa`/`staging-1`) | Allowlist-only local labels {development,dev,test,local}; unknown refused |
| `production` / trim / lower unpinned | env tests for `production`, `Production`, `" Staging "` |
| Wire `const start` / early return | Wire is single AST statement: `afterBootstrapStartJobs({ ...getJobSchedulerWireBindings(), closing })` |
| Index dead code / param shadow / delete flag / shutdown | AST: sole live stmt in `.then` block; no closing param/binding; `closing = true` in shutdown; no DISABLE_JOB_SCHEDULER delete/assign |

## 8. Housekeeping

- DB used: `maintenance_p1_test` only.
- All mutated files were restored, with hashes verified (0 mismatches). There are no `.bak`, `.orig` or `.rej` files in the repo.
- Scratch under `%TEMP%\aud-anyof` (backups, probe, logs, mutation script) was deleted at the end (see below).
- Ports 4000 and 5173 are free, and no stray node, playwright or vite processes remain.
- `e2e/playwright-report`, `e2e/test-results` and `api/dist` are gitignored.
- `git status` still shows 171 paths, the same as before I started. This report is the only new file I added, and it was written after that count was taken.
- This report is new; no prior document was overwritten.
