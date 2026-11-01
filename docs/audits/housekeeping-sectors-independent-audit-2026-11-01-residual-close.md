# Housekeeping / Sectors — Independent Audit (Residual Close)

**Date:** 1 November 2026 (afternoon)  
**Auditor role:** Independent (does not trust rem doc / prior PASS_WITH_RISKS narratives)  
**Repository:** `C:\Users\Admin\Desktop\maintenance`  
**Prior audits:** morning verification, afternoon re-verification, post-closeout, assurance-closeout  
**Isolation DB:** `maintenance_p1_test`  
**App code modified this pass:** none (verification + test execution only; residuals already landed in prior session)

---

## 1. Executive verdict

**PASS_WITH_RISKS** (narrow — new findings from independent code review)

The thin residuals listed in the assurance-closeout audit are **closed in live code** and **green under this-pass re-test**. No BUG-01…12 reopen found.

A parallel independent code-only review ([Independent sectors code audit](3975505e-e498-41f0-ba0a-83ad89ac40d8)) confirmed those closures and surfaced **new** concurrency residuals (R1–R2 below). Tests this pass did not exercise those paths; they do not reopen the claimed BUG-01…12 fixes.

---

## 2. Fresh test execution (this pass)

| Suite | Result |
|---|---|
| Sectors + SSE + catalog pagination + catalog perf (P1 isolation) | **53/53** |
| — `tests/sectors/**` | **35/35** |
| — catalog pagination HTTP | **3/3** (pageSize + broad fallback + number-first tradeoff) |
| — catalog perf (1k / 10k / 100k) | **3/3** — Prisma-captured EXPLAIN uses `Location_number_trgm_idx` |
| — SSE auth + SSE HTTP | **12/12** |
| Web `npm test` | **295/295** |
| Playwright `housekeeping-modals` | **8/8** (clean API/Vite start; prior flake was stale :4000 reuse / ECONNREFUSED) |

---

## 3. Prior thin residuals — independent status

| Prior residual (assurance-closeout §5) | Live evidence | Status |
|---|---|---|
| EXPLAIN ≠ Prisma SQL (hand mirror) | `explainCatalogPrisma.ts` logs real Prisma `location.findMany` SQL; perf uses `resolveCatalogListWhere` + `catalogOrderBy` + `locationInclude` | **CLOSED** |
| Internal `saveSector` omit `expectedVersion` | `SectorSaveInput.expectedVersion` required; runtime `Number.isInteger` / `< 1` → 400; `updateSector` / `setSectorLocations` require it; callers use `*AtHead` | **CLOSED** |
| Archived-tag E2E pollution | `finally` restores original `nameBg`/`nameEn`/`locationIds` then restore+archive temp room | **CLOSED** |
| Number-first hides building hits | HTTP test `number-first hides building-only hits when any number hit exists` | **CLOSED** |

---

## 4. BUG-01…12 spot check (code + this-pass tests)

| ID | Classification | Note |
|---|---|---|
| BUG-01 | **VERIFIED** | Atomic PATCH + E2E body `locationIds` + `expectedVersion` |
| BUG-02 | **VERIFIED** | Picker `includeArchived: true` + archived tags; E2E archived tag **8/8** |
| BUG-03 | **VERIFIED** | Supervisor create gate (unit + E2E) |
| BUG-04 | **VERIFIED** | Independent load error merge (`housekeepingLogic`) |
| BUG-05…06 | **VERIFIED** | Prior coverage retained |
| BUG-07 | **VERIFIED** | HTTP + service CAS; PATCH/PUT missing version → 400 |
| BUG-08 | **VERIFIED** | `busyRef` + `closeSectorForm({ force })` |
| BUG-09…10 | **VERIFIED** | classify helpers + `catalogChangedEvent` |
| BUG-11 | **VERIFIED** | Access recheck under lock; same-version after revoke → 403 only |
| BUG-12 | **VERIFIED** | Audit `before` after lock; serialized A-then-B now asserts stale CAS 409 then fresh-version audit.before |

---

## 5. Review notes (operational)

1. **E2E server hygiene:** Playwright `reuseExistingServer: !CI` can attach to a dying API on `:4000` (observed mid-suite `ECONNREFUSED`). Clean kill + fresh webServer → **8/8**. Not a product defect.
2. **Nightly Actions:** `.github/workflows/nightly-perf.yml` exists; this session did not observe a GitHub Actions run.
3. **EXPLAIN helper:** Params inlined for `EXPLAIN`; identity is Prisma-emitted SQL. Residual: last-`"Location"`-SELECT heuristic; `count` / numberHits queries not explained.
4. **Number-first product tradeoff:** Intentional — tested both ways.

---

## 5b. New residuals (independent code review — not previously closed)

Source: [Independent sectors code audit](3975505e-e498-41f0-ba0a-83ad89ac40d8) (code-only; no tests run by that reviewer). Ranked:

| ID | Severity | Finding | Status |
|---|---|---|---|
| **R1** | Medium | `saveSector` takes `Sector FOR NO KEY UPDATE` then `lockEmployeesForLiveAccess` (User `FOR UPDATE`) when supervisor/`isActive` changes — **inverts** documented protocol in `liveAccessLocks.ts` / SSE (`User` then `Sector`). Deadlock risk vs live delivery. | **OPEN** — confirmed in live `commands.ts` |
| **R2** | Medium | Cross-sector `deleteMany` of a location from source sector X under destination B's lock does not bump X.`version` / audit X; stale full-replace on X can CAS-succeed and pull the room back. | **OPEN** — confirmed in `membership.ts` |
| R3 | Low–Med | Archived-tag E2E `finally` does not assert PATCH/POST status; setup outside `try` can skip restore. | OPEN (hygiene) |
| R4–R9 | Low | EXPLAIN heuristic; hotel-wide BUG-11 scope; catalog `busyRef` on submit; version-before-access 409 vs 403; permissive `updateSector` defaults; shared-building test pollution | OPEN (accepted / backlog) |

R1/R2 do **not** reopen BUG-01…12 under the exercised probes; they are next-wave concurrency hardening.

---

## 6. Final structured verdict

| Dimension | Verdict |
|---|---|
| **Overall** | **PASS_WITH_RISKS** (narrow: R1 lock-order, R2 cross-sector CAS/audit) |
| Assurance thin residuals (EXPLAIN / internal version / E2E restore / number-first) | **CLOSED** under code + this-pass tests |
| BUG-01…12 | **VERIFIED** |
| Recommended next | Fix R1 (User-before-Sector in `saveSector` when access-changing); design R2 source-sector version bump / audit; harden E2E `finally` asserts |
