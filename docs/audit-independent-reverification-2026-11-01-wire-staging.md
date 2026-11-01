# Independent re-verification — Audit remediation after `wireJobSchedulerAfterBootstrap` + staging-guard fixes

Date: 2026-11-01. Auditor: independent. I did not implement the remediation. Every FIXED/DONE/READY line and every prior report was treated as a claim. I re-read the code, re-ran the gates and ran my own mutations.
DB: `maintenance_p1_test` only. Every API run went through `runWithP1Isolation.mjs` / `registerP1TestEnv.mjs`, and the Playwright API webServer uses the same register. The gate logs do not print the DB name, so I rely on the runner's fail-closed guard (`registerP1TestEnv.mjs` enforces the name). Housekeeping-sectors work was not examined.

## 1. Verdict: **PASS_WITH_RISKS** (not a clean PASS)

The functional claims hold:
- The flag is read from `process.env` only, with no injectable env bag.
- The production entry point goes through `wireJobSchedulerAfterBootstrap(closing)`.
- All four required mutations (M-wire, M-staging, M-release, M-boot-flag) are caught.
- All gates are green.
- S2 (`env: {}`) is dead for real, because the parameter no longer exists.

I do not give a clean PASS because the **wording of the claims overstates what is enforced**. The sharpest points:

1. **The `index.ts` contract is still a regex over comment-stripped source.** I got 5 new wiring bypasses past it, plus one more that is a stripper defect (§4a). The real `wire…(closing)` call can be replaced by a template string, hidden in dead code, or given a shadowed `closing = true`, and the contract stays green. A forbidden `startJobScheduler` can also hide behind a `//` or `/*` inside a string literal.
2. **S5 and S6 moved inside `wire…()` and are now unpinned.** `wireJobSchedulerAfterBootstrap` is only tested with `.length === 1`.
   - `start: () => {}` survives all unit tests: the scheduler would never run in production.
   - `closing: false` hardcoded survives, so shutdown-race protection is lost.
   - `warn: () => {}` survives, so the operator warning is lost.
3. **The staging guard is "first defined wins", not "any of".** `APP_ENV ?? DEPLOY_ENV ?? ENVIRONMENT` means `APP_ENV=development` + `DEPLOY_ENV=staging` is **ALLOWED**, and so is `APP_ENV=""` + `DEPLOY_ENV=staging` (probed, §4b). `stage`, `stg`, `preprod`, `uat` and `live` are also allowed. `docs/operations/deploy.md` says `APP_ENV`/`DEPLOY_ENV`/`ENVIRONMENT` ∈ {staging, production, prod}, which is inaccurate for the multi-variable case.
4. **`DEPLOY_ENV`, `ENVIRONMENT` and `APP_ENV=prod|production` have no tests.** Dropping `DEPLOY_ENV ?? ENVIRONMENT` and dropping `production|prod` both leave `env.test.ts` at 15/15 pass. Only `APP_ENV=staging` is pinned.
5. **Process (accepted as out-of-scope):** HEAD is `2b2aa00`, the people-access commit. `git status` shows 170 modified or untracked paths, including every file in this audit. Nothing is committed or protected.

The real backstop for deployed hosts is `RELEASE_SHA`, which `compose.prod.yml` requires (`${RELEASE_SHA:?Set RELEASE_SHA}`). The `RELEASE_SHA` check is pinned and mutation-verified. A staging host outside `compose.prod.yml` and without `RELEASE_SHA` relies on the weak `APP_ENV` family.

## 2. Claim → evidence → status

| # | Claim | Evidence (re-checked) | Status |
|---|---|---|---|
| 1 | `wireJobSchedulerAfterBootstrap(closing)` hard-wires start + `process.env`; no injectable env bag | `schedulerBoot.ts`: `wire…` builds `{closing, start: startJobScheduler, warn: defaultWarn}`. `afterBootstrapStartJobs` reads `isJobSchedulerDisabled(process.env)`, and `JobSchedulerBootDeps` has no `env` field. M-boot-flag (`false &&`) and M-boot-flag-`{}` are both caught. | **REAL** (flag read), **PARTIAL** (wire internals unpinned, S5/S6 relocated) |
| 2 | Contract strips comments, exactly one call, forbids `startJobScheduler` / `afterBootstrapStartJobs` / `env:` / hardcoded false | The test exists and passes on the current source. It catches a direct call, a removed call, `env:`, and `wire(false)` / `wire(closing && false)`. Gaps: the comment-stripper is defeated by `//` or `/*` inside strings; a template-string "call" satisfies the match; dead code and a shadowed `closing` pass; the computed property `["start"+"JobScheduler"]` passes; deleting or resetting the `process.env` flag in `index.ts` passes. "Forbids hardcoded false" covers only the literal `(false)`. | **PARTIAL** (shape pinned, not liveness or data flow) |
| 3 | `assertDisableJobSchedulerAllowed` rejects production, APP_ENV/DEPLOY_ENV/ENVIRONMENT staging\|prod, or RELEASE_SHA | Production: pinned. `APP_ENV=staging`: pinned. `RELEASE_SHA` set: pinned. `DEPLOY_ENV` alone and `ENVIRONMENT` alone work when `APP_ENV` is unset (probe). **First-defined-wins bypass.** `RELEASE_SHA=" "` or `""` is treated as unset (reasonable). `NODE_ENV=staging` is rejected by the NODE_ENV allowlist. | **PARTIAL** |
| 4 | `deploy.md` § `DISABLE_JOB_SCHEDULER` | The warn event name and the production refusal match the code. `compose.prod.yml` requires `RELEASE_SHA`. The "∈ {staging, production, prod}" wording over-claims for multi-variable setups and is silent on `stage`/`stg`/`uat`/`preprod`. | **PARTIAL** (doc drift) |
| 5 | `audit-remediation-followup.md` READY | The doc predates the flag, wiring and staging work and does not mention them. The gates it describes still pass. Web count is now 295. | **Qualified** |
| 6 | `audit-independent-verification.md` BUG/NEW backlog | Not item-by-item re-audited. I re-ran the producers, scope, backfill, SLA, overdue and `authorizeLiveEvent` tests, `jobs.db`, and `jobs.run.http` (incl. the NEW-05 403 for view-only). All pass. | **REAL for what was exercised** |
| 7 | Prior closures hold (boot abandon, jobs E2E, `connection_limit`, lock, settings E2E, retry `maxAttempts`) | All re-mutated (§4c); every mutation was caught. | **REAL** |

## 3. Gates and counts

| Gate | Result |
|---|---|
| api `npm run lint` (oxlint) | exit 0 |
| api `npm run build` (tsc) | exit 0 |
| `runWithP1Isolation.mjs --test-concurrency=1` on the 15 requested files | exit 0. **67 tests, 18 suites, 67 pass, 0 fail, 0 cancelled, 0 skipped.** The 15 files are `executionLock`, `runLifecycle`, `scheduler`, `schedulerFlag`, `schedulerBoot`, `env`, `audit.scope`, `audit.producers`, `audit.backfillLocationIds`, `authorizeLiveEvent`, `jobs.db`, `jobs.run.http`, `scenarios/scheduler`, `audit.sla-scope.db` and `audit.overdue-scope.db`. |
| web `npm run lint` | exit 0 |
| web `npm run build` | exit 0 (PWA generated) |
| web `npm test` | **295 tests, 73 suites, 295 pass, 0 fail** |
| e2e `playwright test tests/helpers/jobRun.spec.ts tests/audit-page-smoke.spec.ts tests/audit-page-live-refresh.spec.ts` | **7/7 pass** (18.8s). I ran it with `CI=1` after verifying 4000/5173 were free; both were free again afterwards. |

I did not run the full `src/**` API suite or the full E2E suite.

## 4. Mutations

Every mutated file was restored. SHA-256 hashes matched before and after for all 6 touched API files (`index.ts`, `env.ts`, `schedulerBoot.ts`, `scheduler.ts`, `schedulerBoot.test.ts`, `env.test.ts`) and for `executionLock.ts`, `runLifecycle.ts`, `settings.ts` and `jobRun.ts`.

### 4a. Required, and the S2–S6 style bypasses (target: `schedulerBoot.test.ts`)

| ID | Mutation | Result |
|---|---|---|
| **M-wire-A** (required) | `index.ts`: wire call → direct `startJobScheduler();` | **CAUGHT** (contract) |
| **M-wire-B** (required) | `index.ts`: wire call → `afterBootstrapStartJobs({…, env: {}} as any)` | **CAUGHT** (contract) |
| M-wire-C | `index.ts`: wire call removed (`void closing;`) | **CAUGHT** |
| **M-staging** (required) | `appEnv === "staging" \|\|` removed, and a separate run with the whole `appEnv` block set to `if (false)` | **CAUGHT** (APP_ENV=staging test, 14 pass / 1 fail) |
| **M-release** (required) | `RELEASE_SHA?.trim()` check disabled | **CAUGHT** (RELEASE_SHA test) |
| M-prod | `NODE_ENV === "production"` guard disabled | **CAUGHT** |
| **M-boot-flag** (required) | `afterBootstrapStartJobs` ignores `process.env` (`false &&`) | **CAUGHT** (2 fail) |
| M-boot-flag-`{}` | flag read from `{}` instead of `process.env` | **CAUGHT** (2 fail, via the "ignores a fake env bag" test) |

Prior S2–S6 mapped onto the new code:

| Prior | Now | Result |
|---|---|---|
| S2 `env: {}` | the field is gone, and `env:` is forbidden by the contract | **CLOSED** (type and contract) |
| S1 `start: () => startJobScheduler()` | `startJobScheduler` is forbidden in `index.ts` | **CLOSED** |
| S3 alias `const _s = startJobScheduler` | caught by `/startJobScheduler/`; `["start"+"JobScheduler"]` is not | **PARTIAL** |
| S4b commented-out call | the stripper removes comments, so a commented call no longer satisfies the match | **CLOSED for line comments**. But a template string `` `wireJobSchedulerAfterBootstrap(closing)` `` replacing the real call **SURVIVES** (6/6 pass), so the scheduler never starts |
| S5 no-op `start` | the arrow is gone from `index.ts`, but `start: () => {}` inside `wire()` **SURVIVES** (6/6 pass) | **RELOCATED, NOT CLOSED** |
| S6 hardcoded `closing:false` | `wire(false)` and `wire(closing && false)` are **CAUGHT**. `const closing = true;` shadowing **SURVIVES**, and `closing: false` inside `wire()` **SURVIVES** | **PARTIAL** |

Additional `index.ts` bypasses, each applied to the real call site; the contract stayed green (6/6 pass) unless noted:

| Mutation | Result |
|---|---|
| `delete process.env.DISABLE_JOB_SCHEDULER;` before the wire call (flag silently ignored) | **SURVIVES** |
| `process.env.DISABLE_JOB_SCHEDULER = "0";` before the wire call | **SURVIVES** |
| `if (false as boolean) { wire(closing); }` (dead code) | **SURVIVES** |
| wire call inside a never-invoked arrow | **SURVIVES** |
| `const closing = true; wire(closing);` | **SURVIVES** |
| real call turned into a template string | **SURVIVES** |
| real call plus `startJobScheduler(0)` hidden after `"x//"` on the next line (stripper treats the rest of the line as a comment) | **SURVIVES** (6/6). Source-level only; I did not compile it. |
| real call plus `startJobScheduler(0)` hidden between `"/*"` and `"*/"` strings | **SURVIVES** (6/6). Source-level only. |
| `wire(closing && false)` | caught |
| `env :` with a space in the replacement | caught (`\benv\s*:`) |

Unpinned internals of `afterBootstrapStartJobs`/`wire`:

| Mutation | Result |
|---|---|
| `wire()` → `start: () => {}` | **SURVIVES** |
| `wire()` → `closing: false` | **SURVIVES** |
| `wire()` → `warn: () => {}` | **SURVIVES** |

### 4b. Staging guard

| Mutation | Result |
|---|---|
| drop `DEPLOY_ENV ?? ENVIRONMENT` | **SURVIVES** (`env.test` 15/15) |
| drop `\|\| appEnv === "production" \|\| appEnv === "prod"` | **SURVIVES** (15/15) |

I called `assertEnv()` directly (`DISABLE_JOB_SCHEDULER=1`, `JWT_SECRET` 48 chars, `NODE_ENV=development`):

| Case | Result |
|---|---|
| `APP_ENV=staging` | REJECT |
| `APP_ENV=" Staging "` | REJECT (trim + lowercase) |
| `DEPLOY_ENV=staging` alone | REJECT |
| `ENVIRONMENT=staging` alone | REJECT |
| `APP_ENV=prod` | REJECT |
| `RELEASE_SHA=abc` | REJECT |
| `NODE_ENV=staging` | REJECT (allowlist) |
| `NODE_ENV=production` | REJECT |
| **`APP_ENV=development` + `DEPLOY_ENV=staging`** | **ALLOWED (bypass)** |
| **`APP_ENV=""` + `DEPLOY_ENV=staging`** | **ALLOWED (bypass)** |
| `APP_ENV=stage` / `stg` / `preprod` / `uat` / `live` | ALLOWED (unknown labels) |
| `RELEASE_SHA=" "` or `""` | ALLOWED (treated as unset, reasonable) |
| `NODE_ENV` unset, no markers | ALLOWED (local) |
| `DISABLE_JOB_SCHEDULER=true` | ALLOWED, but it is also not honoured by `isJobSchedulerDisabled`, so the scheduler still runs. No hazard. |

### 4c. Prior closures

| ID | Mutation | Result |
|---|---|---|
| M-boot-abandon | boot `abandon()` removed in `scheduler.ts` | **CAUGHT** |
| M-interval-abandon | interval `abandon()` removed | **CAUGHT** |
| M-connection_limit | `searchParams.set("connection_limit","1")` removed | **CAUGHT** |
| M-advisory-lock | `pg_try_advisory_lock` → `SELECT true` | **CAUGHT** (cross-session holder test) |
| M-jobs (E2E) | `publish("jobs.changed")` removed in `runLifecycle.ts` | **CAUGHT** (the jobs-panel live-refresh test failed, 1 failed / 1 passed) |
| M-settings (E2E) | `publish("settings.changed")` removed in `services/settings.ts` | **CAUGHT** (the events-panel settings test failed, 1 failed / 1 passed) |
| M-retry-C | `await sleep()` removed | **CAUGHT** (2 fail, no hang) |
| M-retry-cap1 | attempt cap forced to 1 | **CAUGHT** (1 fail) |

I did not repeat the "guard removed" retry hang mutation. It was already shown in the previous report to hang the runner, and I did not want to burn 60s plus a process kill.

## 5. Remaining risks

- **R1 (medium): `index.ts` wiring is regex-guarded, not behaviour-guarded.** The ways a future edit can leave the scheduler never started, or the flag ignored, are the template string, dead code, shadowed `closing`, `delete`/set of the `process.env` flag, and a `//` or `/*` inside a string that defeats the stripper. Fix: expose `bootstrapJobs(closing)` and test it with real deps, or use a TypeScript AST check. A cheaper hardening is to assert that `index.ts` neither mentions `DISABLE_JOB_SCHEDULER` outside comments nor assigns to `process.env`.
- **R2 (medium): `wire()` is untested.** `start: startJobScheduler`, `closing` passthrough and `warn: defaultWarn` are not pinned. Fix: make `wire` take its collaborators through an internal seam used by the test, without exposing an env bag, or add a test that spies on `startJobScheduler` via `scheduler.ts` module state, since `startJobScheduler` is idempotent and observable.
- **R3 (medium): the staging guard is first-defined-wins.** Use an "any of" check over all three variables, and reject unknown non-dev labels (`stage`, `stg`, `uat`, `preprod`), or invert to an allowlist (`development|test|local|unset`). Add tests for `DEPLOY_ENV`, `ENVIRONMENT`, `prod`/`production` and the multi-variable case.
- **R4 (low): `deploy.md` over-claims** on the `APP_ENV`/`DEPLOY_ENV`/`ENVIRONMENT` ∈ {…} wording. Align it with the code, or fix R3.
- **R5 (low): `env.test.ts` is order- and ambient-sensitive.** The `RELEASE_SHA` case does not unset `APP_ENV`/`DEPLOY_ENV`, so an ambient `APP_ENV=staging` would fail the test with the wrong message. This is an environment hazard, not a product bug.
- **R6 (process, accepted as out-of-scope): all Audit work is uncommitted.** HEAD is `2b2aa00`, with 170 modified or untracked paths.
- **R7 (low): doc drift.** `audit-remediation-followup.md` has no mention of the flag, wire or guard.
- **R8 (scope): partial runs.** I did not run the full `src/**` API suite or the full E2E suite, and I did not re-audit each BUG/NEW item.

## 6. READY justified NOW?

- **Functionally: yes.** Every claimed behaviour exists and was mutation-verified at the level the claim states: the flag is read from `process.env`, `index.ts` goes through the wire helper, production, `APP_ENV=staging` and `RELEASE_SHA` are rejected, and all the prior closures hold. All gates are green, and the 7/7 E2E ran on a fresh server.
- **As written: no, not a clean PASS.** "Contract forbids hardcoded false", "no injectable bypasses" and "APP_ENV/DEPLOY_ENV/ENVIRONMENT staging|prod rejected" are each narrower in reality than in the claim. Closing R1–R3 (an AST check or `bootstrapJobs` test, a `wire()` seam test, and an any-of guard with tests) would turn this into a clean PASS. The uncommitted state is accepted as a process-only point.

## 7. Housekeeping

- DB used: `maintenance_p1_test` only, via the P1 isolation runner and register.
- All mutated source files were restored, with hashes verified. There are no `.bak` or `.orig` files.
- Scratch under `%TEMP%` (backups, probe, logs) was deleted.
- Ports 4000 and 5173 are free.
- `e2e/playwright-report` and `e2e/test-results` exist but are gitignored.
- This report is new; no prior document was overwritten.

---

## 8. Post-audit fixes (same day)

| Gap | Fix |
|---|---|
| R3 first-wins staging | `assertDisableJobSchedulerAllowed` checks **any of** APP_ENV/DEPLOY_ENV/ENVIRONMENT against {staging, stage, stg, production, prod, preprod, uat}; env tests cover DEPLOY_ENV alone, ENVIRONMENT=prod, APP_ENV=development+DEPLOY_ENV=staging, empty APP_ENV, aliases |
| R1 wire internals | `getJobSchedulerWireBindings().start === startJobScheduler`; wire source contract forbids arrow start / hardcoded closing |
| R1/R2 index regex | TypeScript AST: exactly one `CallExpression` `wireJobSchedulerAfterBootstrap(closing)`, one `let closing = false`, no `startJobScheduler` / `afterBootstrapStartJobs` calls |
