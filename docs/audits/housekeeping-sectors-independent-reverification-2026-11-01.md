# Housekeeping / Sectors — Independent Re-Verification (Post Follow-up)

**Date:** 1 November 2026 (afternoon pass)  
**Auditor role:** Independent (does not trust remediation narrative or prior audit closure claims)  
**Repository:** `C:\Users\Admin\Desktop\maintenance`  
**Documents under review:**
- `docs/audits/housekeeping-sectors-remediation-2026-10-31.md` (claims “closed” after PASS_WITH_RISKS)
- `docs/audits/housekeeping-sectors-independent-verification-2026-11-01.md` (prior PASS_WITH_RISKS + §11 follow-up list)

**Isolation DB:** `maintenance_p1_test` @ `127.0.0.1:5433` (asserted by P1 preload)  
**Production / app code modified this pass:** none (verification markdown + test execution only)

---

## 1. Executive verdict

**PASS_WITH_RISKS** (improved vs morning audit; not unqualified PASS)

Functional fixes for BUG-01…12 and the listed follow-ups are present in live code and backed by freshly executed P1 / web / Playwright suites. Prior assurance gaps that blocked a clean PASS (CAS-masked BUG-11 probe, weak BUG-12 lock proof, cloned helpers, optional public `expectedVersion`, missing Playwright depth, missing nightly 100k job) are **largely closed**.

Still not an unqualified PASS because:

1. Two production helpers (`classifySaveRefreshOutcome`, `mergeIndependentLoadErrors`) are unit-tested but **not imported** by `HousekeepingPage` — page implements equivalent behavior inline; rem doc overstates “helpers wired.” (`isCatalogChangedEvent` similarly unused.)
2. Perf EXPLAIN SQL in `locations.catalog.perf.db.test.ts` still mirrors the **broad OR** query, not the number-first path in `listLocationsCatalog` — so EXPLAIN does not prove the new search shape; number-first/fallback paths have **no dedicated behavioural test**.
3. 100k volume was **not executed** in this pass (opt-in / nightly only).
4. Internal `saveSector` still accepts omitted `expectedVersion` (public HTTP correctly requires it); **no HTTP test** asserts PUT `/locations` rejects missing `expectedVersion`.
5. One E2E re-run on a reused API without rate-limit disable failed 3/7 with **429** — environment flake, not a product reopen; clean restart → **7/7**.
6. Independent static review ([Independent sectors code audit](2e7978fd-5da0-442a-be68-5073d63353ea)): BUG-12 tests prove lock-at-hook via NOWAIT, **not** that production `beforeLocations` cannot be moved above the lock; `shouldApplySectorSaveResult` is vacuous in the current page closure; close-after-save works via stale `busy===false`.

No claimed fix was **DISPROVED** as broken. Prefer FAIL over unjustified PASS → **PASS_WITH_RISKS**.

---

## 2. Fresh test execution (this pass)

| Suite | Command | Result |
|---|---|---|
| Sectors (P1) | `cd api && npm run test:sectors` | **34/34 pass** |
| Pagination + validation + perf | `runWithP1Isolation` pagination + `validation.test.ts` + `locations.catalog.perf.db.test.ts` | **7 pass, 1 skip** (100k) |
| Web unit | `cd web && npm test` | **295/295 pass** |
| Playwright housekeeping | `cd e2e && npx playwright test tests/housekeeping-modals.spec.ts` | **7/7 pass** (after fresh API/Vite; prior attempt 4/7 under 429) |

Observed during independent re-run:

- Mid-suite intentional `test-forced-sector-location-insert-failure` (T-SEC-60e) — expected; suite still green.
- Perf EXPLAIN text shows `Join Filter: (... number ILIKE OR building OR floor ...)` — **broad** shape (see §7).

---

## 3. Per-bug / follow-up matrix

| ID / claim | Live evidence | Tests assert | Classification |
|---|---|---|---|
| **BUG-01** atomic save | `saveSector` optional `locationIds` in one TX; UI `updateSector(..., { locationIds, expectedVersion })` only — **no** `setSectorLocations` in `HousekeepingPage` | `save.atomic.http.test.ts`; E2E PATCH body has `locationIds` + `expectedVersion` | **VERIFIED** |
| **BUG-02** archived picker | `SectorPanel` `includeArchived: true`; archived tags on chips + rows | E2E archived-tag case | **VERIFIED** |
| **BUG-03** create gate | `canCreateSector(user.role, canManageSectors)` wired; API T-SEC-58 | unit + E2E supervisor no add + HTTP 403 | **VERIFIED** |
| **BUG-04** independent loads | Separate `useEffect`s per resource with per-resource errors | Helper `mergeIndependentLoadErrors` tested but **unused by page** | **VERIFIED** (impl); **PARTIAL** (helper coupling) |
| **BUG-05** whitespace | Zod trim + `normalizeSectorFields` | validation unit + atomic HTTP whitespace 400 | **VERIFIED** |
| **BUG-06** supervisor quality | `assertSupervisor` active + role | atomic HTTP housekeeper → 400 | **VERIFIED** |
| **BUG-07** CAS + required version | Public PATCH/PUT Zod `expectedVersion: z.number().int().positive()` | missing version → 400; conflict → 409 | **VERIFIED** (public); internal omit still allowed |
| **BUG-08** save identity / dirty | Dirty Escape / busy UI real; `shouldApplySectorSaveResult` compares same-closure ids (vacuous); close-after-save via stale `busy` | unit + E2E dirty Escape | **PARTIAL** |
| **BUG-09** save vs refresh | Page separates refresh `try/catch` with explicit “Saved, but list refresh failed” | `classifySaveRefreshOutcome` tested but **unused by page** — helper-wiring claim **DISPROVED** | **VERIFIED** (impl); helper claim false |
| **BUG-10** catalog invalidation | Page listens; `LocationCatalogPanel` dispatches; `SectorPanel` does neither | event-identity unit only; `isCatalogChangedEvent` unused | **VERIFIED** (behaviour); **PARTIAL** (test) |
| **BUG-11** in-TX access | Lock → CAS → live scope → `assertSectorWriteAccessUnderLock` | **403-only** same-version raw reassign (version unchanged); no-version 403; manager bump 409 | **VERIFIED** (assert probe sensitive; live-scope re-resolve less so) |
| **BUG-12** audit after lock | Code order lock → … → `beforeLocations` correct; dedicated NOWAIT proves lock at hook | Moving production read above lock would still pass current tests | **PARTIAL** (impl OK; ordering under-probed) |
| Number-first search | `listLocationsCatalog` counts number-only hits; broadens only if 0 | No dedicated HTTP assert of path choice; EXPLAIN helper still OR | **VERIFIED** (code); **PARTIAL** (evidence) |
| Nightly 100k CI | `.github/workflows/nightly-perf.yml` sets `LOCATIONS_PERF_100K=1` | Job present; **not executed** here | **VERIFIED** (config); **NOT_TESTED** (run) |
| Production helper imports | `housekeepingSaveLogic.test.ts` imports `./housekeepingLogic` | 5/5 in web suite | **VERIFIED** for import claim |
| Playwright expansion | dirty Escape, atomic PATCH, archived tag present | 7/7 on clean servers | **VERIFIED** |

---

## 4. Mutation-probe sensitivity (code review; production not mutated)

| Probe | Would tests fail if fix removed? |
|---|---|
| Remove `assertSectorWriteAccessUnderLock` | **YES** for “same expectedVersion → 403 only” (version held constant via raw update). Also YES for no-`expectedVersion` case. |
| Move `beforeLocations` above the lock (still inside TX / after barriers used today) | Current suite **likely still passes** (static conclusion): NOWAIT only proves lock at `afterAccessRechecked`; audit assertions compare against seeded / hook-local snapshots, not a forced concurrent membership mutate under lock. |
| Remove only `resolveDataScope(tx)` re-resolve | Tests **likely still pass** — ownership assert uses locked sector row’s `primarySupervisorEmployeeId` vs caller employee id. |

Prior morning caveat (“headline BUG-11 masked by CAS”) is **addressed** by the same-version raw reassign case. BUG-12 lock-*held* is proven; lock-*before-read ordering* remains code-review only.

---

## 5. Checklist from rem doc §E (closed claims)

| # | Claimed closed | This pass |
|---|---|---|
| 1 | BUG-11 CAS mask → 403-only | **PASS** |
| 2 | BUG-12 NOWAIT lock proof | **PASS** (dedicated client; same-client probe is unsafe — rem narrative should note that) |
| 3 | Helpers not clones | **PASS** (imports); **caveat** two helpers unused by page |
| 4 | Public `expectedVersion` required | **PASS** |
| 5 | Number-first search | **PASS** code; **PARTIAL** EXPLAIN evidence |
| 6 | Playwright gaps | **PASS** (7/7 clean) |
| 7 | Nightly 100k workflow | **PASS** file exists; run not observed |

---

## 6. Doc vs code discrepancies / new findings

1. **Rem doc “helpers wired”** — `canCreateSector`, `shouldApplySectorSaveResult`, `HOUSEKEEPING_CATALOG_CHANGED` are wired. `classifySaveRefreshOutcome` and `mergeIndependentLoadErrors` are **not referenced** outside tests/`housekeepingLogic.ts`.
2. **Perf EXPLAIN ≠ production search** — `explainPagedCatalog` hardcodes broad OR ILIKE; production uses number-first then conditional broaden. Rem “perf evidence” does not validate the new path.
3. **BUG-12 probe detail** — NOWAIT from the **same** PrismaClient used by the interactive TX can succeed (session re-entrancy / pool routing). Current test correctly uses `new PrismaClient()`; rem doc should keep that requirement explicit.
4. **E2E rate-limit flake** — Reusing an API started without `E2E_DISABLE_RATE_LIMIT` caused login **429** mid-file. Product rate limiting works; suite is sensitive to ambient servers.
5. **Web count** — rem claims 295/295; this pass confirms **295/295**.
6. **Sector count** — rem claims 34/34; this pass confirms **34/34** (includes 5 concurrency cases).
7. Residual admitted correctly: internal omit of `expectedVersion`; 100k opt-in; broad-search Seq Scan possible.

No NEW critical functional defect reopening BUG-01…12.

---

## 7. Residual risks

- Helper/page drift for BUG-04/09 classifiers (behavior duplicated inline); `isCatalogChangedEvent` unused.
- `shouldApplySectorSaveResult` does not protect cross-edit races in current page wiring; close-after-save relies on stale `busy` closure.
- BUG-12 read-after-lock ordering under-probed by tests (NOWAIT ≠ ordering proof).
- Number-first: any number hit suppresses building/floor broaden — untested behavioural change + extra `count` query.
- EXPLAIN-based perf narrative lags number-first implementation; 100k not proven here.
- Public PUT missing-`expectedVersion` path untested (schema requires it).
- Internal service API can still write without CAS; legacy PUT route remains.
- `assertSupervisor` / create validation outside TX — deactivate-in-window residual.
- Ambient E2E server without rate-limit disable → flaky logins; archived-tag E2E leaves renamed sector pollution.
- Role-based create gate still keys off `user.role === "supervisor"`, not grants alone.
- Pre-existing invalid supervisors not auto-cleared (BUG-06 residual).

---

## 8. Static second opinion (read-only subagent)

Merged from [Independent sectors code audit](2e7978fd-5da0-442a-be68-5073d63353ea) (static only; suites not re-executed by that pass). Agrees on overall **PASS_WITH_RISKS**. Adds/strengthens: vacuous BUG-08 identity helper; DISPROVED helper-wiring claim for BUG-09; BUG-12 ordering not mutation-sensitive; PUT missing-version untested; number-first NOT_TESTED; E2E does not assert absence of follow-up PUT.

This document’s executed suites (§2) remain the runtime evidence; §8 items that conflict with “VERIFIED” above are treated as **assurance** downgrades, not as proof the production fix is absent.

---

## 9. Final structured verdict

| Dimension | Verdict |
|---|---|
| **Overall** | **PASS_WITH_RISKS** |
| Server BUG-01,05,06,07 (+ required version) | **VERIFIED** + tests (PUT missing-version gap) |
| Server BUG-11 | **VERIFIED** + sensitive 403-only probe |
| Server BUG-12 | **PARTIAL** assurance — code order OK; tests prove lock, not read ordering |
| UI BUG-01,02,03 + modals/pagination | **VERIFIED** + E2E |
| UI BUG-08 | **PARTIAL** (dirty Escape real; identity helper vacuous) |
| UI BUG-04,09,10 | Behaviour present; helper-wiring overstated |
| Follow-up closure claims | Mostly held; EXPLAIN / helper / BUG-12 ordering overstated |
| Block deploy on these bugs? | **No critical reopen** |

**Skeptical bottom line:** Follow-ups closed the morning audit’s main *functional* assurance holes (especially BUG-11 CAS mask). Remaining risks are evidence fidelity, unused/vacuous helpers, and under-probed BUG-12 ordering / number-first behaviour — not an unfixed hijack path in the exercised probes. Hence still **PASS_WITH_RISKS**.

---

## 10. Same-day close-out of listed residual risks

| Residual called out after re-verification | Close-out |
|---|---|
| Helpers tested but not wired | `HousekeepingPage` now imports/uses `classifySaveRefreshOutcome`, `mergeIndependentLoadErrors`, `isCatalogChangedEvent` |
| Perf EXPLAIN used broad OR | `explainPagedCatalog(..., "number_first")`; 10k assert no broad `Join Filter` OR; plan uses `Location_number_trgm_idx` |
| 100k not run | `LOCATIONS_PERF_100K=1` → **3/3 pass**; 100k page1 ~511ms, EXPLAIN Execution Time ~282ms |
