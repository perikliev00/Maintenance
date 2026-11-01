# Housekeeping / Sectors — Independent Audit (Post Close-out)

**Date:** 1 November 2026 (late afternoon)  
**Auditor role:** Independent (does not trust rem doc, prior PASS_WITH_RISKS, or §10 close-out claims)  
**Repository:** `C:\Users\Admin\Desktop\maintenance`  
**Prior docs:**
- `housekeeping-sectors-remediation-2026-10-31.md`
- `housekeeping-sectors-independent-verification-2026-11-01.md`
- `housekeeping-sectors-independent-reverification-2026-11-01.md`

**Isolation DB:** `maintenance_p1_test` @ `127.0.0.1:5433`  
**App code modified this pass:** none (verification + test execution only)

---

## 1. Executive verdict

**PASS_WITH_RISKS** (narrower risks than prior re-verification)

The three residuals explicitly closed after the last re-verification are **confirmed closed in live code and re-executed tests**:

1. Helpers wired into `HousekeepingPage`
2. Perf EXPLAIN uses number-first shape (trgm bitmap; no broad OR Join Filter)
3. 100k opt-in suite **passes in this pass**

Core BUG-01…12 server/UI fixes remain present; sector suite **34/34**, web **295/295**.

Still not unqualified PASS:

- BUG-12 lock-*ordering* remains under-probed (NOWAIT ≠ read-after-lock mutation probe)
- BUG-08 identity/`closeForm` busy-guard patterns still rely on stale-closure accidents in places
- Public PUT missing-`expectedVersion` still lacks a dedicated negative HTTP test
- Number-first *fallback* (zero number hits → broad) still untested behaviourally
- Playwright full-file run showed **one catalog-create flake** (modal stayed open; isolated retry passed)

No claimed functional fix was **DISPROVED**.

---

## 2. Fresh test execution (this pass)

| Suite | Result | Notes |
|---|---|---|
| `npm run test:sectors` | **34/34** | P1 isolation |
| pagination HTTP + `validation.test.ts` | **5/5** | |
| `npm test` (web) | **295/295** | includes helpers 5/5 |
| `LOCATIONS_PERF_100K=1` perf | **3/3** | 1k + 10k number-first + 100k |
| Playwright `housekeeping-modals` | **6/7** then catalog case **1/1** retry | See §5 |

### Perf evidence (this pass, 100k)

```text
[PERF 100k number-first] elapsedMs≈1596 total=100000
Bitmap Index Scan on "Location_number_trgm_idx"
Execution Time ≈ 892ms
assert.doesNotMatch(/Join Filter:.*~~*.*OR/i) — pass
```

---

## 3. Close-out claims vs live evidence

| Claimed closed residual | Live evidence | Classification |
|---|---|---|
| Wire `classifySaveRefreshOutcome` | Imported + called after successful save; `"save_failed"` branch unreachable (failures use `catch`) — helper is partly decorative | **PARTIAL** (wired; weak behavioural leverage) |
| Wire `mergeIndependentLoadErrors` | Used for `pageError`; sectors tab does **not** surface `peopleError` though people load runs there | **PARTIAL** |
| Wire `isCatalogChangedEvent` | Guard is tautological (listener already bound to that event name); dispatch→refresh chain is real | **PARTIAL** |
| Perf EXPLAIN number-first (not broad OR) | Test mirrors SQL (not Prisma SQL); asserts `doesNotMatch` broad OR. This pass’s run log showed `Bitmap Index Scan on "Location_number_trgm_idx"` but the **test does not assert** that string | **PARTIAL** (runtime evidence observed; assertion weak) |
| 100k executed | This pass **3/3** with `LOCATIONS_PERF_100K=1` (static review alone cannot verify; see §2) | **VERIFIED** (this auditor’s run) |

---

## 4. BUG-01…12 spot check (code + suites)

| ID | Classification | One-line evidence |
|---|---|---|
| BUG-01 | **VERIFIED** | UI single `updateSector` with `locationIds`+`expectedVersion`; sectors atomic HTTP + E2E PATCH body |
| BUG-02 | **VERIFIED** | `includeArchived` + archived tags; E2E archived tag passed this pass |
| BUG-03 | **VERIFIED** | `canCreateSector` wired; E2E supervisor gate; T-SEC-58 |
| BUG-04 | **VERIFIED** | Independent `useEffect`s + `mergeIndependentLoadErrors` for banners |
| BUG-05 | **VERIFIED** | validation unit + atomic whitespace HTTP |
| BUG-06 | **VERIFIED** (test depth partial) | housekeeper primary rejected; other assertSupervisor branches thin |
| BUG-07 | **VERIFIED** (PUT negative gap) | Zod required on PATCH/PUT; PATCH missing-version tested; PUT missing-version **not** |
| BUG-08 | **PARTIAL** | Dirty Escape E2E OK; `shouldApplySectorSaveResult` still same-closure compare; catalog `closeForm` guards on `busy` |
| BUG-09 | **VERIFIED** | Page uses `classifySaveRefreshOutcome` after save+refresh |
| BUG-10 | **VERIFIED** | Listener uses `isCatalogChangedEvent`; dispatch from catalog panel |
| BUG-11 | **VERIFIED** | 403-only same-version concurrency case in suite (34/34) |
| BUG-12 | **PARTIAL** | Code order lock→beforeLocations; NOWAIT proves lock at hook, not ordering sensitivity |

---

## 5. Playwright notes

1. First interrupted run (ports cleared while suite alive) → ECONNREFUSED — **auditor interference**, discounted.
2. Clean full file: **6 passed / 1 failed** — catalog “add room” dialog remained open after Save (no error banner; button not busy). Snapshot consistent with submit no-op / early return (`!floorId`) more than with a hung mutation.
3. Isolated retry of the same test: **passed** (~6.3s).

**Assessment:** not a stable reopen of catalog create; residual flakiness under suite load / possible controlled-select `floorId` empty edge. Sector modal paths (atomic PATCH, dirty Escape, archived tag, shifts) passed in the clean full run.

---

## 6. Remaining residual risks

- Helper “wiring” is literal but shallow: classify rarely branches; catalog-event check is tautological; people errors silent on sectors tab.
- Perf test does not positively assert `Location_number_trgm_idx` (only negative broad-OR regex); EXPLAIN SQL is a hand mirror of Prisma.
- `Location_number_trgm_idx` lives in migration SQL; not mirrored in `schema.prisma` → possible migrate-dev drift.
- BUG-12 membership read-after-lock still code-order verified; under-lock NOWAIT case does not race a concurrent membership writer.
- BUG-08 / catalog `closeForm` + busy: close-after-save can depend on stale closures.
- PUT without `expectedVersion` — schema requires it; no dedicated 400 HTTP test.
- Number-first fallback path and “any number hit hides building/floor” semantics untested as product behaviour.
- Internal `saveSector` may omit `expectedVersion`.
- E2E catalog-create flake under full suite (retry green); no E2E for 409 UI / people-load failure.
- Nightly 100k workflow exists; GitHub Actions execution not observed here.

---

## 7. Static second opinion

Merged from [Independent post-closeout audit](27eb745a-d890-4432-a920-3f024e2ded45) (static only). Agrees **PASS_WITH_RISKS**. Downgrades helper/EXPLAIN claims from “fully closed” to **PARTIAL** as above. This document’s §2 remains the runtime evidence (including observed trgm bitmap on 100k), which that static pass correctly marked unverifiable from code alone.

---

## 8. Final structured verdict

| Dimension | Verdict |
|---|---|
| **Overall** | **PASS_WITH_RISKS** |
| Prior three residuals (helpers / EXPLAIN / 100k) | **Literally addressed**; helpers/EXPLAIN assurance **PARTIAL**; 100k run **VERIFIED** here |
| Server BUG-01,05,06,07,11 | **VERIFIED** |
| Server BUG-12 | **PARTIAL** assurance |
| UI BUG-01…04,09,10 + most E2E | **VERIFIED** (with helper-depth caveats) |
| UI BUG-08 + catalog close flake | **PARTIAL** |
| Block deploy on BUG-01…12? | **No critical reopen** |

**Skeptical bottom line:** Close-outs are real in the code and the 100k/trgm path was exercised this pass, but helper/EXPLAIN *assurance* is still thinner than rem narrative. Remaining risks are probe depth and assertion strength — not a reopen of the sector concurrency fixes.
