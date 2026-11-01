# Housekeeping / Sectors Remediation — Implementation Audit Pass

**Date:** 31 October 2026 (updated 1 November 2026)  
**Project:** `C:\Users\Admin\Desktop\maintenance`  
**Scope:** BUG-01…BUG-12 for Cleaning → Catalog / Sectors / membership (not the Audit Log BUG ids in `docs/audit-remediation-report.md`)  
**Isolation DB:** `maintenance_p1_test` @ `127.0.0.1:5433`  
**Git push / deploy:** not performed  
**Independent verification:**
- Morning: [`housekeeping-sectors-independent-verification-2026-11-01.md`](./housekeeping-sectors-independent-verification-2026-11-01.md) → **PASS_WITH_RISKS**
- Post-follow-up: [`housekeeping-sectors-independent-reverification-2026-11-01.md`](./housekeeping-sectors-independent-reverification-2026-11-01.md) → **PASS_WITH_RISKS**
- Post close-out (helpers/EXPLAIN/100k): [`housekeeping-sectors-independent-audit-2026-11-01-post-closeout.md`](./housekeeping-sectors-independent-audit-2026-11-01-post-closeout.md) → **PASS_WITH_RISKS**
- Assurance close-out (BUG-12 probe, busyRef, trgm assert, missing tests, E2E): [`housekeeping-sectors-independent-audit-2026-11-01-assurance-closeout.md`](./housekeeping-sectors-independent-audit-2026-11-01-assurance-closeout.md) → **PASS_WITH_RISKS** (narrow; prior assurance gaps **CLOSED**)

---

## A. Bug Resolution Matrix

| ID | Initial | Current code | Root cause | Fix | Files | Existing tests | New/extended tests | Types | Result | Residual risk |
|---|---|---|---|---|---|---|---|---|---|---|
| **BUG-01** | Confirmed | Present | Two HTTP commits | Single `PATCH /sectors/:id` with optional `locationIds` via `saveSector` one TX | `commands.ts`, `controllers/sectors.ts`, `sectorsApi.ts`, `HousekeepingPage.tsx` | membership atomic HTTP | `save.atomic.http.test.ts` + E2E PATCH payload | HTTP+E2E | PASS | Legacy PUT `/locations` retained for membership-only callers |
| **BUG-02** | Confirmed | Present | Wrong list + no archived UX | Picker uses `fetchLocationsCatalogPage(includeArchived)` + archived tags; DTO `catalogStatus` | `format.ts`, `SectorPanel.tsx` | catalog pagination HTTP | E2E archived tag in picker | HTTP+E2E | PASS | — |
| **BUG-03** | Confirmed | Present | Create≠edit in UI | `canCreateSector(role, manage)` helper; hide add button | `housekeepingLogic.ts`, `HousekeepingPage.tsx`, `SectorPanel.tsx` | `auth.http.test.ts` T-SEC-58 | `housekeepingSaveLogic.test.ts` (imports production helpers) + E2E | HTTP+unit+E2E | PASS | Role-grant without supervisor role still uses role check |
| **BUG-04** | Confirmed | Present | Coupled load | Independent loads + `mergeIndependentLoadErrors` | `HousekeepingPage.tsx`, `housekeepingLogic.ts` | — | `housekeepingSaveLogic.test.ts` | Unit | PASS | No DOM mount test |
| **BUG-05** | Confirmed | Present | Whitespace passed schema | Normalize then validate; Zod transforms trim | `validation.ts`, controller schemas | — | `validation.test.ts`, atomic HTTP whitespace | Unit+HTTP | PASS | DB check constraints not added (app-layer) |
| **BUG-06** | Confirmed | Present | Existence-only supervisor | Require active user + supervisory role | `commands.ts` | — | atomic HTTP housekeeper reject | HTTP | PASS | Pre-existing invalid supervisors not auto-cleared |
| **BUG-07** | Confirmed | Present | Lost update | `Sector.version` CAS; **public PATCH/PUT require `expectedVersion`** | schema migration, controllers, UI | — | atomic HTTP conflict + auth/membership fixtures | HTTP+DB | PASS | Internal service callers may omit version by design |
| **BUG-08** | Confirmed | Present | Async identity loss | `savingSectorIdRef` + `shouldApplySectorSaveResult`; modal dirty/busy | `HousekeepingPage.tsx`, `FormModal.tsx`, `housekeepingLogic.ts` | — | unit identity + E2E dirty Escape | Unit+E2E | PASS | — |
| **BUG-09** | Confirmed | Present | Refresh error looked like save fail | Separate refresh catch + `classifySaveRefreshOutcome` | `HousekeepingPage.tsx`, `housekeepingLogic.ts` | — | `housekeepingSaveLogic.test.ts` | Unit | PASS | Message copy only BG/EN |
| **BUG-10** | Confirmed | Present | Catalog isolated from sectors cache | `HOUSEKEEPING_CATALOG_CHANGED` event → `refreshSectors` | both panels, `housekeepingLogic.ts` | — | `housekeepingSaveLogic.test.ts` event identity | Unit | PASS | Event is in-page only |
| **BUG-11** | Probable | Fixed | Auth outside TX | Re-resolve scope + ownership under sector lock; test hooks | `commands.ts`, `testHooks.ts` | — | `access.revoke.concurrency.test.ts` — **403-only same-version (no CAS mask)** | **Real PG concurrency** | **CONFIRMED + FIXED** | See §D |
| **BUG-12** | Probable | Fixed | Membership `before` read outside TX | Read membership after sector lock; lock held proven via `NOWAIT` | `saveSector` | — | same file — lock snapshot + external `NOWAIT` fail | **Real PG concurrency** | **CONFIRMED + FIXED** | — |

---

## B. New functionality

### Server pagination
- `GET /locations?paged=true&page=&pageSize=&q=&kind=&includeArchived=`
- Response: `{ items, page, pageSize, total, totalPages }`
- Default page size 25; max 100 (server clamped)
- Legacy unpaged array response retained when `paged`/`page`/`pageSize` omitted
- Index: `Location(number)` + `pg_trgm` GIN on `Location.number` + existing `(kind, catalogStatus)`
- **Number-first search:** when `q` is set, filter by number ILIKE first (trgm-friendly); broaden to building/floor only if number hits are empty
- UI: catalog table + sector membership picker use paginated API with debounce + abort
- Selected membership IDs preserved across pages/search; full `locationIds` sent on save
- `fetchRooms()` drain helper **unchanged** for operational boards

### Performance notes
- `locations.catalog.perf.db.test.ts`: 1k + 10k + EXPLAIN; 100k via `LOCATIONS_PERF_100K=1`
- Nightly CI: `.github/workflows/nightly-perf.yml` (schedule + `workflow_dispatch`)

### Add / Edit UX
- Separate buttons: “+ Добави сектор/стая/обща част/смяна”
- Edit opens centered `FormModal` (portal, Escape, X, dirty confirm, busy lock, focus restore)
- Create vs edit titles and state not mixed

### Conflicts / failures
- `version_conflict` → clear reload message in sector modal
- Save success + refresh failure → explicit banner without re-running mutation
- Public sector writes reject missing `expectedVersion` (400)

---

## C. Test report

### Commands

```powershell
cd api
npx prisma migrate deploy
npx prisma generate
npm run test:sectors
node ./tests/runWithP1Isolation.mjs --test-concurrency=1 tests/scenarios/locations.catalog.pagination.http.test.ts
node ./tests/runWithP1Isolation.mjs --test-concurrency=1 tests/scenarios/locations.catalog.perf.db.test.ts
node ./tests/runWithP1Isolation.mjs --test-concurrency=1 src/services/sectors/validation.test.ts
npm run lint
npm run build

cd ../web
npm test
npm run lint

cd ../e2e
npx playwright test tests/housekeeping-modals.spec.ts
```

### Counts (follow-up pass 2026-11-01)

| Category | Count |
|---|---:|
| Sector suite (`npm run test:sectors`) | **34/34** (strengthened BUG-11/12) |
| Catalog pagination HTTP | **1/1** |
| Catalog perf 1k/10k | pass (100k nightly / opt-in) |
| Web helpers (`housekeepingSaveLogic.test.ts`) | **5/5** production imports — BUG-03/04/08/09/10 |
| Web unit suite | **295/295** |
| Playwright housekeeping-modals | **7/7** — dirty Escape, atomic PATCH, archived tag, create/edit, supervisor gate, catalog, shifts |

### Why some checks are opt-in
- 100k volume: slow seed; `LOCATIONS_PERF_100K=1` + nightly workflow
- Mutation probe of removing assert: not run against production (code-review + 403-only same-version case covers access path)

---

## D. BUG-11 evidence (required)

### Scenario
1. Supervisor A owns active sector S (`sectorA1`).
2. Supervisor B has no access to S.
3. A starts `saveSector` after preliminary scope (stale `sectorIds` includes S).
4. Test hook `afterPreTxAuth` parks A **before** opening the mutation transaction / sector lock.
5. Manager/raw reassign primary A→B **without bumping `version`** (CAS cannot mask).
6. DB assert: `primarySupervisorEmployeeId === B` and `version` unchanged.
7. Release A.
8. A must get **403 `forbidden` only** — not 409 — and must not apply metadata/membership changes.

### Additional cases
- Without `expectedVersion`: still **403** after manager `updateSector` (version may bump).
- With stale `expectedVersion` after manager bump: **409 `version_conflict`** (CAS path).

### BUG-12 evidence
- Park B on `afterAccessRechecked` (sector locked, before `beforeLocations` read).
- External connection `FOR NO KEY UPDATE NOWAIT` fails → proves lock held.
- Snapshot under lock matches membership at lock time; audit `before` is not a pre-TX stale read.

### File
`api/tests/sectors/access.revoke.concurrency.test.ts`

---

## E. Independent follow-up audit checklist

See [`housekeeping-sectors-independent-verification-2026-11-01.md`](./housekeeping-sectors-independent-verification-2026-11-01.md) and post-follow-up [`housekeeping-sectors-independent-reverification-2026-11-01.md`](./housekeeping-sectors-independent-reverification-2026-11-01.md).

Closed after independent **PASS_WITH_RISKS** (re-verified):

1. ~~BUG-11 masked by CAS~~ → same-version raw reassign → **403-only**
2. ~~BUG-12 weak lock proof~~ → `NOWAIT` under `afterAccessRechecked`
3. ~~Unit tests cloned helpers~~ → `housekeepingLogic.ts` + production imports
4. ~~expectedVersion optional on public API~~ → required on PATCH/PUT
5. ~~Number-first search~~ → `crud.ts` number-first then broaden
6. ~~Playwright gaps~~ → dirty Escape, atomic PATCH, archived tag
7. ~~Nightly 100k~~ → `.github/workflows/nightly-perf.yml`

### Remaining limitations
- Broad building/floor search may still Seq Scan (number-first path asserts `Location_number_trgm_idx` in EXPLAIN)
- 100k not in default PR CI (nightly workflow present; local opt-in verified)
- Internal `saveSector` service API still allows omit `expectedVersion` (public HTTP requires it; PUT missing-version → 400 tested)

### Assurance close-outs (same day)
- BUG-12: concurrent SectorLocation mutate under lock; audit.before must see post-mutation set
- BUG-08: `busyRef` + `closeForm({ force })` + live `editingTargetRef` for save identity
- Helpers: CustomEvent catalog detail; people errors on sectors tab; classify used in finally
- Perf: EXPLAIN asserts `Location_number_trgm_idx`; number-first → broad fallback HTTP tested
- E2E: 409 UI message; catalog create waits for table/hierarchy; **8/8**

---

## Completion criteria mapping

1. BUG-01…10 fixed + validated — **yes**
2. BUG-11/12 real PG concurrency — **yes, confirmed + fixed** (strengthened probes)
3. Server+UI pagination without full-table drain — **yes** (+ perf + nightly)
4. Separate add vs edit — **yes**
5. Centered edit modal with X — **yes**
6. Invariants preserved — sector suite + E2E modals
7. Required tests executed — listed above
8. This report — `docs/audits/housekeeping-sectors-remediation-2026-10-31.md`
9. Independent verification linked — **yes**
