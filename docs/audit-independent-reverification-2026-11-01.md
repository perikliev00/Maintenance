# Independent re-verification — Audit module remediation + follow-up

**Date:** 2026-11-01
**Auditor stance:** independent, adversarial; implementer claims (FIXED/DONE/READY) not accepted as evidence.
**Scope:** BUG-01..10, NEW-01..07, residuals (historical `locationId`, multi-process lock, producer⊆filters, E2E).
**Inputs reviewed:** `docs/audit-independent-verification.md`, `docs/audit-remediation-followup.md`, `docs/audit-remediation-report.md`.
`docs/audits/housekeeping-sectors-remediation-2026-10-31.md` is not an Audit-module document and was ignored.
**DB safety:** all mutating tests ran against `maintenance_p1_test` (`127.0.0.1:5433`) through `api/tests/runWithP1Isolation.mjs` / `registerP1TestEnv.mjs`. Ports 4000/5173 were free before the Playwright run, so `reuseExistingServer` could not attach to a seed-DB server. `prisma migrate status` on P1: "Database schema is up to date" (47 migrations). The seed/production DB was not touched.

---

## 1. Executive verdict: **PASS_WITH_RISKS**

- All 10 original defects are addressed in current code. New code paths and tests were reproduced independently.
- The follow-up claim "**READY**, nothing open" is **not fully justified**:
  1. A 01.11 change (advisory lock) **broke an existing CI-gated test** (`tests/scenarios/scheduler.test.ts`, P2-55). The follow-up gate list omitted it. I applied a minimal test-only fix (see §5).
  2. The new **cross-process lock has zero test coverage**. I verified it manually. A mutation that disables the advisory lock is not caught by any committed test.
  3. The Audit **E2E is a smoke test only** and does not cover BUG-06/07 delivery.
  4. **None of the Audit work is committed.** HEAD `2b2aa00` contains none of it; all code, tests, migrations and docs are dirty or untracked.
- Verdict is not FAIL: no original defect reproduces, and builds, lint and every suite are green after the test fix.

---

## 2. Claim → evidence → status

Legend: VERIFIED / PARTIAL / FAILED / NOT_VERIFIED

### Original defects

| Claim | Code evidence | Status |
|---|---|---|
| **BUG-01** SLA/overdue audit rows carry `locationId` + summary | `ticketSlaBreach.ts:97-109` and `overdueSessions.ts:83-96` pass `locationId`/`summary`/`after`. `audit.sla-scope.db.test.ts` and `audit.overdue-scope.db.test.ts` pass. **My mutation:** removing `locationId` from `overdueSessions.ts` made 4 tests fail (overdue-scope + 3 jobs.db tests). Restored, hash-verified. | **VERIFIED** (new rows) |
| **BUG-02** stale refresh cannot overwrite | `AuditPage.tsx` `refreshGen` + `shouldApplyAuditRefresh` guard before apply and in `finally`. Helper tests pass. No DOM test. | **VERIFIED** (logic + code-review wiring); UI **NOT_VERIFIED** |
| **BUG-03** manual refresh clears/sets banner | `load()` does `setError(null)` → settle → `formatAuditLoadErrors`. Helper tests pass. | **VERIFIED** (logic) |
| **BUG-04** events and jobs fail independently | `Promise.all` of two `settleAuditFetch` + `combineAuditLoadResults`. Matrix tests pass. | **VERIFIED** |
| **BUG-05** nested JSON diff | `labels.test.ts` nested/array/null tests pass. | **VERIFIED** (formatter) |
| **BUG-06** `location.changed` refreshes Audit | Producers: `locations/crud.ts` (4×), `locations/status.ts` (2×), `cleaning/ops.ts`. Web allowlist `liveEvents.ts`; `AUDIT_PAGE_LIVE_EVENTS`. Contract test is membership-only; E2E does not exercise SSE. | **PARTIAL** (wiring OK, delivery unproven in browser) |
| **BUG-07** `jobs.changed` start/finish/abandon | `runLifecycle.ts:17,41,73`. `runLifecycle.test.ts` isolates start, finish and abandon. `authorizeLiveEvent.ts:60` delivers it. | **VERIFIED** (bus/API); UI panel **NOT_VERIFIED** |
| **BUG-08** SLA identity | `formatAuditRelated`, `after.title/locationNumber/ticketId`, summary. Unit + DB asserts pass. | **VERIFIED** |
| **BUG-09** filters cover producers | See producer scan below. | **VERIFIED** (currently true; guard is a hand list) |
| **BUG-10** `stale_open_attendance` label | `labels.ts` `JOB_KEY_LABELS` + `labels.test.ts`. | **VERIFIED** |

### NEW items and residuals

| Claim | Code evidence | Status |
|---|---|---|
| **NEW-01** PermissionsPage build | `web npm run build` exit 0, lint exit 0. | **VERIFIED** |
| **NEW-02** API build | `api npm run build` exit 0, lint exit 0. Doc says "DONE / N/A" with no explanation of what changed. | **VERIFIED** (build green); doc vague |
| **NEW-03** `permissions.changed` live | `auditPageLogic.ts:13`; publisher `roleGrants/replace.ts:227`; `authorizeLiveEvent.ts:58`; web allowlist `liveEvents.ts:38`. Membership test passes. | **VERIFIED** (wiring) |
| **NEW-04** stale/clear events UX | `resolveEventsTableAfterLoad` + stale header + banner text (`AuditPage.tsx`); tests at `auditPageLogic.test.ts:107+`. | **VERIFIED** (logic) |
| **NEW-05** `jobs.run` split | `routes/jobs.ts:12` GET `jobs.view`, `:20` POST `jobs.run`. Seeded to manager/admin (`app.ts:87-90`) and in `permissions.ts` owner/admin defaults. `jobs.run.http.test.ts` "view-only 403 / GET 200" passes. No web UI triggers `/jobs/run`, so FE capability is declared but unused. | **VERIFIED** |
| **NEW-06** Playwright smoke | `e2e/tests/audit-page-smoke.spec.ts` passed **1/1** on isolated servers. It only logs in, selects an action filter and clicks refresh. It never asserts rows, SLA data, SSE, errors or stale banner. | **PARTIAL** (exists and passes; shallow) |
| **NEW-07** `sector.save` label/filter | `labels.ts` `ACTION_LABELS`, `AUDIT_ACTION_FILTERS`; producer `sectors/commands.ts:384-389`. | **VERIFIED** |
| **Overdue scope DB test** | `audit.overdue-scope.db.test.ts` passes and is mutation-sensitive (above). | **VERIFIED** |
| **`startJobRun` publish** | Isolated test in `runLifecycle.test.ts` passes. | **VERIFIED** |
| **Historical null `locationId`** | Migration `20261101140000_backfill_audit_location_ids` is applied on P1. SQL matches `backfillAuditLocationIds()`. The DB test covers the **TS function only** (incl. idempotency), not the migration SQL. The function is **not called anywhere in production code** (tests only). Entity/action strings match producers. Rows whose ticket/session no longer exists stay null. | **VERIFIED** (migration logic by inspection and shared SQL); migration SQL itself not directly tested → **PARTIAL** on test evidence |
| **Multi-process job lock** | `executionLock.ts`: `pg_try_advisory_lock` on a dedicated `PrismaClient`. **My 2-process probe on P1:** A holds the lock → B `{acquired:false}` mid-run → B acquires after A ends. **My mutation** (`if (false && !locked)`) → `executionLock.test.ts` + `jobs.run.http.test.ts` still **4/4 pass**: no committed test covers it. | **VERIFIED manually**; **no regression test** → PARTIAL as "closed" |
| **Abandon TTL (30 min)** | `runLifecycle.ts` `abandonStaleRunningJobRuns(30m)`; tests: stale (31 min) closed, fresh kept. The "fresh" test's final assert is partly tautological (`count === 0 \|\| status === "running"`), though the preceding status assert is real. | **VERIFIED**, with the caveat in §4 |
| **Producer ⊆ filters** | `KNOWN_AUDIT_PRODUCER_ACTIONS` (api, 44) and `REQUIRED_AUDIT_PRODUCER_ACTIONS` (web, 44): **identical sets** (diff = 0). Both are hand-maintained. The API test only asserts 6 strings plus no duplicates; the web test checks web list ⊆ web filters. **Nothing scans `recordAudit` call sites**. | **PARTIAL** (true today, not enforced) |

**Independent producer scan:** I enumerated every `recordAudit` action literal in `api/src` (including `ticket.*` derived in `maintenance/events.ts`, and `sector.create`/`sector.save`/`sector.update`). All 44 actions are in `AUDIT_ACTION_FILTERS`. All producer `entityType` values (`location`, `maintenance_ticket`, `ticket`, `cleaning_*`, `inspection`, `sector`, `shift_roster`, `card`, `setting`, `role_grant`, `attendance_adjustment`, `user`, `employee`, `device`, `sla_policy`, `sync_run`) are in `AUDIT_ENTITY_FILTERS`. No drift today.

---

## 3. Commands run and results

| Command | Result |
|---|---|
| `cd web && npm test` | **292 pass / 0 fail** |
| `cd web && npm run lint` / `npm run build` | exit 0 / exit 0 |
| `cd api && npm run lint` / `npm run build` | exit 0 / exit 0 |
| `api runWithP1Isolation.mjs --test-concurrency=1` with the 10 follow-up audit/jobs files | **37 pass / 0 fail** (matches the doc) |
| `cd api && npm test` (all `src/**/*.test.ts`, P1) | **408 pass / 0 fail** |
| `cd api && npm run test:scenarios` (P1), **before** my test fix | 133 tests, **131 pass / 1 FAIL** / 1 skip — `P2-55 stop cancels initial and repeating jobs…` |
| same, **after** test-only fix to `scheduler.test.ts` | **132 pass / 0 fail / 1 skip** (the file passed 3/3 reruns) |
| `cd e2e && npx playwright test tests/audit-page-smoke.spec.ts` | **1 pass / 0 fail** |
| `npx prisma migrate status` against P1 URL | "Database schema is up to date" |
| 2-process advisory-lock probe (temp script, deleted) | PASS (B blocked while A held, then acquired) |
| Mutation: remove `locationId` in `overdueSessions.ts` | 4 failures (sensitive); restored (hash check) |
| Mutation: disable advisory-lock check | 0 failures (**insensitive**); restored (hash check) |
| Mutation: swap in HEAD `executionLock.ts` | `scheduler.test.ts` passes → proves causality of the regression; restored (hash check) |

Not run: full Playwright suite, multi-hour soak, Prisma idle-connection expiry (>5 min jobs), pgbouncer.

---

## 4. Remaining real risks

1. **P1 (gate/CI):** `tests/scenarios/scheduler.test.ts` was red because `runWithJobExecutionLock` now does async DB work (new `PrismaClient` + `pg_try_advisory_lock`). The test's single `setImmediate` tick was too short. CI runs `test:scenarios` (`.github/workflows/ci.yml:124,285`). Follow-up "Gates" list omitted this suite and the full API suite. **Fixed here, test-only** (see §5).
2. **P2:** No regression test for cross-process locking. Disabling the lock goes undetected. A test needs a second connection or process holding `JOB_EXECUTION_ADVISORY_KEY`.
3. **P2: crash-recovery regression.** `abandonStaleRunningJobRuns` runs **only once at `startJobScheduler`**. With the 30 min TTL, a crash followed by a restart in under 30 minutes leaves the orphan `running` row indefinitely, until some later restart. Before 01.11 the restart cleaned it immediately. There is no periodic sweep.
4. **P2:** Lock robustness assumptions are undocumented. The lock client is a pooled `PrismaClient`, not a single dedicated session, despite the code comment. The lock survives only while the connection that acquired it stays open. Prisma's pool idle lifetime (default ~300 s) could drop it during a long job. PgBouncer transaction pooling would break advisory locks. Unlock may hit another connection (harmless here because `$disconnect` follows).
5. **P2:** Audit-page live refresh is incomplete for several producers. `sector.*`, `shift.roster.upsert`, `card.*`, `sla_policy.upsert`, `adjustment.*`, `device.revoke` and `sync.push` publish **no** live event (no `publish(` in those services). Their audit rows appear only on manual refresh or an unrelated event. This does not contradict a doc claim, but "full live audit" should not be asserted.
6. **P2:** E2E smoke does not cover BUG-06/07 SSE delivery, BUG-02/03 race and recovery, or SLA row visibility. There are still no React DOM tests.
7. **P2:** Historical backfill is only a one-shot migration. The TS helper is unused in production. Rows whose entities were deleted stay invisible under sector scope. The migration SQL itself is not covered by a test.
8. **P2:** `jobs.run` is seeded once through a versioned catalog seed. Custom roles that previously triggered jobs through `jobs.view` silently lose the capability (intended by NEW-05, but a behaviour change). `jobs.run` exists in the web capability type, but no FE control uses it.
9. **P3:** Producer⊆filters is guarded by hand-copied lists in two packages that can drift silently. A new `recordAudit` action will not fail any test.
10. **P3:** The "keeps fresh running rows" test has a weak final assertion.
11. **Process risk (high):** the entire Audit remediation (code, tests, migration `20261101140000…`, docs) is **uncommitted/untracked** on top of `2b2aa00`, mixed with many unrelated dirty changes. It cannot be reproduced from git, and a bad checkout or reset would lose it.

---

## 5. Product/test changes made by this audit

- **Test-only:** `api/tests/scenarios/scheduler.test.ts` (P2-55).
  - Added a `settledUntil()` real-time poll for the delayed-first-run and interval-run assertions.
  - Added a 500 ms real-time settle so the first cycle releases the advisory lock and `currentRun` before the next mock tick.
  - No product code changed. The "stop cancels delayed first run", "double start" and `calls` assertions are unchanged.
- Temporary mutations (`executionLock.ts`, `overdueSessions.ts`) were restored and hash-checked. The temporary probe script was removed.

---

## 6. Documentation quality issues

1. **Contradictory readiness in `audit-independent-verification.md`.** Sections 1, 7 and 11 still say "NOT_READY / blocking: web & api build FAIL / PASS_WITH_RISKS because of NEW-01..". Section 12 says "READY". Builds are green now, so sections 1, 4, 7, 9 and 10 are stale. Section 12 was appended without reconciling them. §4 still lists 285 web tests; it is 292 now.
2. **`audit-remediation-followup.md` "Отворено: Няма / READY".** This ignores the red `scheduler.test.ts`, the missing lock regression test, the single-shot abandon (risk 3) and the smoke-only E2E. "Executed commands" omits the full API suite and `test:scenarios`.
3. **Misleading evidence wording.** The follow-up cites "executionLock + runLifecycle тестове PASS" as proof of multi-process safety. Neither test exercises the advisory lock; `executionLock.test.ts` hits the in-process fast path.
4. **Historical backfill evidence.** "DB тест PASS; migrate deploy на p1 + local". The test covers the TS function, not the migration SQL. The "local" deploy cannot be verified from the repo. The helper is dead code in production.
5. **NEW-02 "DONE / N/A".** It never states the root cause or the fix. That is an ambiguous status for a P1 item.
6. **`audit-remediation-report.md` is stale and contradicts later docs.** It marks BUG-06 and BUG-07 "FIXED" while the independent verification says PARTIAL. It says web build FAIL "pre-existing" (disproved later) and "E2E липсва". It was never marked as superseded. Its "Git baseline clean / dirty tree" narrative also predates the 01.11 work.
7. **Git baseline text** in `audit-independent-verification.md` (`2b2aa00`) no longer reflects the claimed state, since the fixes exist only in the working tree.
8. The `producer ⊆ filters` closure is described as "KNOWN/REQUIRED lists + unit asserts". Wording implies stronger enforcement than the code provides.
9. The original audit document is outside the repo (`Documents\Codex\...`). It is still the only definition of BUG-01..10, so the requirements are not reproducible from the repo.

---

## 7. Is "READY" in the follow-up justified?

**Not as written.** The "no open items / READY" statement was **false at the time of the 01.11 gates** because the CI-gated scheduler scenario was red. It is defensible only as **READY_WITH_CONDITIONS** after the test fix:

1. Commit the work (risk 11).
2. Add a cross-process lock test (risk 2).
3. Decide on a periodic or restart-time stale-run policy (risk 3).
4. Accept or schedule browser-level E2E for live refresh, race and recovery (risk 6).
5. State the lock deployment assumptions: direct Postgres connection, no PgBouncer transaction pooling, jobs shorter than the pool idle lifetime (risk 4).

---

## 8. Residual closure (same day, post-reverify)

Engineering follow-up closed items 2–5 above (commit still operator-owned):

| Item | Closure |
|---|---|
| Cross-process lock test | `executionLock.test.ts` holds `pg_try_advisory_lock` on a separate `connection_limit=1` client and asserts `{acquired:false}` |
| Periodic stale policy | `startJobScheduler` sweeps on boot **and** every interval tick; TTL policy documented on `DEFAULT_STALE_JOB_RUN_MS` |
| Browser live E2E | `e2e/tests/audit-page-live-refresh.spec.ts` — jobs panel (`jobs.changed`) + events (`settings.changed`) without reload |
| Lock assumptions | Documented on `executionLock.ts`; lock client forced to `connection_limit=1` |

Gates re-run: executionLock / runLifecycle / scheduler / jobs.run.http / scenarios/scheduler + Playwright smoke+live → PASS.
