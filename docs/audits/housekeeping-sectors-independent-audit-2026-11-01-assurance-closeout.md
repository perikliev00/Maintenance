# Housekeeping / Sectors — Independent Audit (Assurance Close-out)

**Date:** 1 November 2026 (evening)  
**Auditor role:** Independent (does not trust rem doc / prior PASS_WITH_RISKS narratives)  
**Repository:** `C:\Users\Admin\Desktop\maintenance`  
**Prior audits:** morning verification, afternoon re-verification, post-closeout audit  
**Isolation DB:** `maintenance_p1_test`  
**App code modified this pass:** none (verification + test execution only)

---

## 1. Executive verdict

**PASS_WITH_RISKS** (thin residuals only)

The assurance gaps that previously justified a strong PASS_WITH_RISKS (weak BUG-12 probe, stale busy close, decorative helpers, trgm not asserted, missing PUT/fallback/409 tests, catalog E2E flake) are **present in code and freshly green under re-test**.

No BUG-01…12 reopen found. Remaining risks are secondary: EXPLAIN SQL is still a hand mirror of Prisma, GitHub Actions nightly was not observed in this session, and a few product/test hygiene items remain.

---

## 2. Fresh test execution (this pass)

| Suite | Result |
|---|---|
| `npm run test:sectors` | **35/35** (includes PUT missing `expectedVersion` → 400; BUG-11/12 concurrency) |
| Catalog pagination HTTP | **2/2** (pageSize clamp + number-first → broad fallback) |
| Web `npm test` | **295/295** |
| Catalog perf (incl. 100k) | **3/3** — EXPLAIN asserts `Location_number_trgm_idx` |
| Playwright `housekeeping-modals` | **8/8** (409 UI, atomic PATCH, dirty Escape, catalog create, archived tag, shifts) |

---

## 3. Previously listed risks — independent status

| Prior risk | Live evidence | Status |
|---|---|---|
| BUG-12 ordering under-probed | During `afterAccessRechecked` park: NOWAIT + concurrent delete of `loc2`; audit `before` must equal `[loc1]`, not hook seed snapshot | **CLOSED** |
| BUG-08 stale busy close | `busyRef` + `closeSectorForm`/`closeForm({ force })`; `editingTargetRef` compared after await | **CLOSED** |
| Helpers decorative / people silent | `catalogChangedEvent` CustomEvent + `isCatalogChangedEvent`; people errors merged on sectors tab; classify in `finally` | **CLOSED** |
| Perf no trgm assert | `assert.match(plan, /Location_number_trgm_idx/i)` on 10k and 100k | **CLOSED** (assert + this-pass run) |
| PUT missing version untested | `PUT locations without expectedVersion → 400` | **CLOSED** |
| Number-first fallback untested | HTTP test with building-only `q` when number hits = 0 | **CLOSED** |
| 409 UI untested | E2E route fulfill 409 + reload message visible | **CLOSED** |
| Catalog E2E flake | Wait for table row + non-empty building/floor before save; **8/8** this pass | **CLOSED** (this run) |

---

## 4. BUG-01…12 spot check

| ID | Classification | Note |
|---|---|---|
| BUG-01 | **VERIFIED** | Single PATCH + E2E body |
| BUG-02…06 | **VERIFIED** | Code + suites as before |
| BUG-07 | **VERIFIED** | PATCH + PUT required version tested |
| BUG-08 | **VERIFIED** | busyRef / force close / live target ref |
| BUG-09…10 | **VERIFIED** | classify + CustomEvent catalog path |
| BUG-11 | **VERIFIED** | 403-only same-version probe |
| BUG-12 | **VERIFIED** | Lock held + concurrent membership mutate → audit.before sensitive to read-after-lock |

---

## 5. Remaining residual risks (thin)

1. Perf EXPLAIN still uses hand-written SQL mirroring Prisma filters — can drift from the real ORM query text (assert catches plan shape / index name, not Prisma SQL identity).
2. `.github/workflows/nightly-perf.yml` exists; **this session did not observe a GitHub Actions run**.
3. Internal `saveSector` may still omit `expectedVersion` (public HTTP cannot).
4. Archived-tag E2E may leave renamed sector / membership side effects.
5. Number-first product tradeoff: any number hit suppresses building/floor broaden (intentional; now tested for the empty-number path only).

None of the above reopen BUG-01…12 functional fixes under the exercised probes.

---

## 6. Final structured verdict

| Dimension | Verdict |
|---|---|
| **Overall** | **PASS_WITH_RISKS** (narrow) |
| Assurance gaps from prior audits | **CLOSED** under code + this-pass tests |
| Server concurrency BUG-11/12 | **VERIFIED** |
| UI busy/helpers/E2E | **VERIFIED** this pass |
| Block deploy on these bugs? | **No** |

**Skeptical bottom line:** Functional and assurance work for housekeeping/sectors now holds against an independent re-run. The leftover “risk” is mostly evidence hygiene (mirrored EXPLAIN, unobserved GA nightly), not an open hijack or lost-update hole.
