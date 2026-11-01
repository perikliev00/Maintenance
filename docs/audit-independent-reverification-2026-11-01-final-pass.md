# Independent re-verification — final PASS check (allowlist + wire AST + index AST)

Date: 2026-11-01. Auditor: independent. I did not implement the remediation or the hardening. Every claim in `audit-independent-reverification-2026-11-01-anyof-ast.md` §7 was treated as unproven. I re-read `env.ts`, `schedulerBoot.ts`, `schedulerBoot.test.ts`, `env.test.ts`, `index.ts` and `docs/operations/deploy.md`. I re-ran every gate and ran my own mutations.

DB: `maintenance_p1_test` only. Every API run went through `runWithP1Isolation.mjs`, and the Playwright API webServer uses the same register. Housekeeping-sectors was ignored. The uncommitted working tree (172 paths) is accepted as an out-of-scope process residual and does not affect the verdict.

## 1. Verdict: **PASS**

All §7 claims hold in the code. Every previously surviving evasion that you listed is now CAUGHT, or no longer applies. I re-ran all of them. All gates are green, and all required mutations (M-allow, M-wire, M-dead, M-param, M-shutdown, M-delete-flag) are caught.

Six new evasions survive (§4c). They are different from the earlier ones. None is an edit that a plausible regression would produce, and none is the shape you asked me to re-check. I list them as non-blocking, low-severity residuals (§5), not as PASS blockers.

## 2. Claim → evidence

| # | Claim | Evidence | Status |
|---|---|---|---|
| 1 | Deploy labels are an allowlist {development, dev, test, local}. Unknown labels are refused, any-of over APP_ENV/DEPLOY_ENV/ENVIRONMENT. | `env.ts`: `LOCAL_DEPLOY_LABELS = {development, dev, test, local}`. Labels are trimmed, lowercased and empties dropped, then `some(label => !LOCAL_DEPLOY_LABELS.has(label))` throws. Probe through `assertEnv()` (§4a): live, qa, prd, production-eu, staging-1, ENVIRONMENT=live, `" LIVE "`, development+DEPLOY_ENV=staging and RELEASE_SHA are all REJECTED. No label, development, dev, Test, local and `" Development "` are ALLOWED. | **REAL** |
| 2 | env tests cover production, Production and trim. | `env.test.ts` has an alias loop with `production`, `live`, `qa`, `prd`, `production-eu`, `staging-1`. It also has "APP_ENV=Production (case normalization)" and "surrounding whitespace (trim)" with `" Staging "`. The live label fails a test when added to the allowlist (§4b). | **REAL** |
| 3 | `wireJobSchedulerAfterBootstrap` is a single AST statement: `afterBootstrapStartJobs({ ...getJobSchedulerWireBindings(), closing })` | Source has exactly that. The test asserts one statement, one call, one object argument with exactly two properties (spread of the bindings call, then shorthand `closing`), and `.length === 1`. A separate test pins `bindings.start === startJobScheduler`. | **REAL** |
| 4 | The index AST makes the wire call the sole live statement in the `.then` block. There is no `closing` param or binding shadow. Shutdown has `closing = true`. There is no DISABLE_JOB_SCHEDULER delete or assign. | `schedulerBoot.test.ts` "index.ts job-scheduler wiring contract (AST)" asserts all of these. `index.ts` matches: a block-bodied `.then(() => { wireJobSchedulerAfterBootstrap(closing); })`, one `let closing = false`, and `closing = true` in `shutdown`. | **REAL** for the listed shape. See §4c for out-of-shape evasions. |
| 5 | `deploy.md` and the code agree | `docs/operations/deploy.md` lines 91–95 describe the allowlist {development, dev, test, local}, the any-of rule, the RELEASE_SHA rule and the production refusal. | **REAL** |
| 6 | Prior BUG/NEW closures, jobs E2E and advisory lock | The 15-file API run, `jobs.run.http` (NEW-05 403), `jobs.db`, `executionLock` and the E2E run are all green. I did not re-mutate these this round. | **REAL** for what I exercised |

## 3. Gates

| Gate | Result |
|---|---|
| api `npm run lint` | exit 0 |
| api `npm run build` | exit 0 |
| `runWithP1Isolation --test-concurrency=1` on the 15 requested files | exit 0. **86 tests, 18 suites, 86 pass, 0 fail, 0 cancelled, 0 skipped.** This is up from 77 because of the new env and AST tests. |
| web `npm run lint` | exit 0 |
| web `npm run build` | exit 0 |
| web `npm test` | **295 tests, 73 suites, 295 pass, 0 fail** |
| e2e `CI=1 playwright test jobRun.spec audit-page-smoke audit-page-live-refresh` | **7/7 pass** (17.7s). The API log shows `job_scheduler_disabled`, so the flag was honoured. |

I did not run the full `src/**` API suite or the full E2E suite.

## 4. Mutations

SHA-256 hashes of `env.ts`, `schedulerBoot.ts` and `index.ts` were taken before the run and compared after. All 3 matched. Each mutation ran through a restore-in-`finally` harness.

### 4a. Direct probe

`assertEnv()` with `NODE_ENV=development`, `DISABLE_JOB_SCHEDULER=1` and a long JWT secret:

| Case | Result |
|---|---|
| `APP_ENV=live`, `qa`, `prd`, `production-eu`, `staging-1` | **REJECT** |
| `ENVIRONMENT=live`, `APP_ENV=" LIVE "` | REJECT |
| `APP_ENV=development` + `DEPLOY_ENV=staging` | REJECT |
| `RELEASE_SHA=abc` | REJECT |
| no labels, `development`, `dev`, `Test`, `local`, `" Development "` | ALLOWED |

### 4b. Required mutations

| ID | Mutation | Result |
|---|---|---|
| **M-allow** (staging in allowlist) | `LOCAL_DEPLOY_LABELS` gains `staging` | **CAUGHT** (`env.test` fail 5) |
| **M-allow** (live in allowlist) | `LOCAL_DEPLOY_LABELS` gains `live` | **CAUGHT** (fail 1) |
| **M-allow** (denylist revert) | `some(label => [staging,stage,stg,production,prod,preprod,uat].includes(label))`. This misses live. | **CAUGHT** (fail 5, including the live/qa/prd/production-eu/staging-1 cases) |
| **M-wire** (early return) | `return;` before the call in `wire` | **CAUGHT** (boot 7/8) |
| **M-wire** (const start) | `const start = () => {}; …, closing, start` in `wire` | **CAUGHT** |
| M-wire (closing reassign) | `closing = false;` in `wire` | CAUGHT |
| M-wire (spread order) | `{ closing, ...bindings() }` | CAUGHT |
| M-bindings-start-noop | `start: (() => {}) as typeof startJobScheduler` | CAUGHT |
| **M-dead** | `if (false as boolean) { wire(closing); }` in `index.ts` | **CAUGHT** |
| **M-param** | `((closing: boolean) => wire(closing))(true);` | **CAUGHT** |
| **M-shutdown** | Remove `closing = true` in `shutdown` | **CAUGHT** |
| **M-delete-flag** | `delete process.env.DISABLE_JOB_SCHEDULER;` before the call | **CAUGHT** |
| X-assign-flag | `process.env.DISABLE_JOB_SCHEDULER = ""` before the call | CAUGHT |
| X-binding-shadow | `const { closing } = { closing: true }` | CAUGHT |
| X-never-invoked | The call is wrapped in an arrow that is never invoked | CAUGHT |
| M-allow-drop-DEPLOY_ENV | Remove DEPLOY_ENV from the label array | CAUGHT (fail 3) |
| M-allow-no-trim / M-allow-no-lower | Remove `.trim()` or `.toLowerCase()` | SURVIVES (fail 0). **Benign: it fails closed.** With an allowlist, an un-normalised label such as `" Staging "` does not match and is still rejected. Only the allow side gets stricter (`" Development "` would be refused). It does not weaken the guard. |

### 4c. Former SURVIVES vs. now

All former survivors from the previous report are now CAUGHT: param shadow, binding shadow, dead code, never-invoked arrow, delete flag, remove shutdown assign, wire const start, wire early return, wire closing reassign, live/qa/prd/production-eu/staging-1, remove production label. The two normalisation mutations (trim and lowercase) still pass the tests. Under the allowlist they are fail-closed (see §4b), so they no longer matter.

New evasions that I tried and that still pass all 8 tests in `schedulerBoot.test.ts`:

| ID | Mutation | Effect | Severity |
|---|---|---|---|
| X-extra-closing-true | An extra `closing = true;` right after the `let closing` declaration (the check is `>= 1` assigns anywhere) | The scheduler never starts. | Low (needs a deliberate edit) |
| X-func-shadow | `function closing() {…}` in the listen callback. The contract counts only variables, parameters and binding elements. | The scheduler never starts (the function is truthy). | Low |
| X-assign-in-dead-fn | `closing = true` moved into a never-called arrow | The shutdown-race guard is lost. The contract does not check that the assign is inside `shutdown`. | Low |
| X-shutdown-guard-removed | `if (closing) return;` removed from `shutdown` | A double SIGTERM would re-run shutdown. No test pins it. | Low |
| X-never-resolves | `initializeRequiredDefaults()` replaced by a never-resolving promise | Bootstrap and the scheduler never run. | Low (the shape is not a plausible regression) |
| X-optional-call | `wire?.(closing)` | None. Behaviour is unchanged. | Benign |

## 5. Remaining risks (non-blocking)

- **R1 (low): the index AST contract is static.** The six evasions above need a deliberate, purpose-built edit. Optional hardening, if you want it, in `schedulerBoot.test.ts`:
  - require `closing = true` to be inside the `shutdown` arrow and not inside any nested arrow;
  - also count `FunctionDeclaration`, `ClassDeclaration` and `EnumDeclaration` named `closing`;
  - require `startupTask = initializeRequiredDefaults().then(...)`.
  A runtime test of a real bootstrap function with a spy would catch them all without a regex or AST.
- **R2 (low): `shutdown` re-entrancy guard (`if (closing) return;`) is unpinned.**
- **R3 (process, accepted): all of the Audit work is uncommitted** (172 paths).
- **R4 (low): retry cap.** `jobRun.ts` removal of the attempt cap was found earlier to show up as a hang, not an assertion failure. I did not re-check it this round.
- **R5 (scope):** I did not run the full `src/**` API suite, the full E2E suite or each BUG/NEW item.

## 6. READY?

**Yes.** The allowlist rejects every label outside {development, dev, test, local}. Live, qa, prd, production-eu and staging-1 are rejected (probe plus tests). The wire body and the `index.ts` `.then`/shutdown/shadow/flag contracts catch every mutation you listed. All gates are green. The residuals are out-of-shape edits that need deliberate effort, and I do not count them as PASS blockers.

## 7. Housekeeping

- DB used: `maintenance_p1_test` only.
- All mutated files were restored. SHA-256 hashes were verified, with 0 mismatches. The temp probe file in `api` was deleted.
- Scratch under `%TEMP%\aud-final` (backups, mutation script, logs) was deleted at the end.
- No `.bak`, `.orig` or `.rej` files in the repo. Ports 4000 and 5173 have no listeners (TIME_WAIT only).
- This report is new. No prior document was overwritten.
