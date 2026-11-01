# Housekeeping / Sectors — Independent Forensic Verification

**Date:** 1 November 2026  
**Auditor role:** Independent (does not trust remediation narrative)  
**Repository:** `C:\Users\Admin\Desktop\maintenance`  
**Document under review:** `docs/audits/housekeeping-sectors-remediation-2026-10-31.md`  
**Isolation DB used:** `maintenance_p1_test` @ `127.0.0.1:5433` (asserted by `assertTestDatabase`)  
**Production / app code modified:** none (verification markdown only)

---

## 1. Executive verdict

**PASS_WITH_RISKS**

Core claimed server fixes for BUG-01, BUG-05…07, BUG-11, BUG-12 are present in live code and backed by passing P1 isolation tests (sector suite **30/30**). UI claims for BUG-01…04, BUG-08…10, pagination, and modals are present in current source; Playwright housekeeping modals **4/4** pass.

This is **not** an unqualified PASS because:

1. Several remediation “PASS” rows overstate automated validation (BUG-04/08/10 have no/weak dedicated tests; BUG-03/09 unit tests assert **local clones**, not production modules).
2. BUG-11’s first concurrency case can succeed via **version CAS alone**; only the no-`expectedVersion` case is a true mutation probe for `assertSectorWriteAccessUnderLock`.
3. BUG-12’s concurrency case proves pre-TX audit snapshot is wrong, but **does not fully prove** lock-before-read ordering inside the transaction under the current barrier protocol.
4. Remediation report numbers/copy have measurable inaccuracies (web count, internal “Playwright not executed” vs later “4/4”, stale test-file comment).

No claimed fix was **DISPROVED**. Preferring FAIL over unjustified PASS still yields **PASS_WITH_RISKS**, not FAIL.

---

## 2. Per-bug verification matrix

| ID | Claimed expected behavior (from rem doc + code/tests) | Live evidence | Tests actually assert | Classification |
|---|---|---|---|---|
| **BUG-01** | One HTTP commit for edit: metadata + `locationIds` via `saveSector` one TX; UI must not sequential PATCH+PUT | `saveSector` optional membership in same TX (`commands.ts`); controller PATCH accepts `locationIds`; UI `updateSector(..., { locationIds, expectedVersion })` only — **no** `setSectorLocations` in `HousekeepingPage.tsx` | `save.atomic.http.test.ts`: PATCH updates name + membership + version together | **VERIFIED** |
| **BUG-02** | Membership picker must not use full `fetchRooms()` drain; include archived + archived UX tags; DTO has `catalogStatus` | `SectorPanel` → `fetchLocationsCatalogPage({ includeArchived: true })`; archived tags on picker + selected chips; `format.ts` maps `catalogStatus` | Indirect: catalog pagination HTTP; E2E catalog search uses paged API; **no** dedicated archived-tag assertion | **VERIFIED** (impl); weak archived-tag coverage |
| **BUG-03** | Supervisors with `sectors.manage` may edit, not create; API POST already 403 for sector scope | `canCreateSectors = canManageSectors && !isSupervisorScope`; create button gated by `canCreate`; API `scope.kind === "sectors"` → 403 | T-SEC-58 HTTP 403; E2E supervisor no add button; `housekeepingSaveLogic.test.ts` clones logic locally | **VERIFIED** |
| **BUG-04** | Independent loads per resource; one failure must not blank whole page | Separate `useEffect`s for sectors / shifts / people with per-resource errors | None that mount `HousekeepingPage` | **VERIFIED** (code review only) |
| **BUG-05** | Whitespace must not pass; normalize/trim then validate | Zod `.transform(trim).pipe(min(1))` in controller; `normalizeSectorFields` + `assertValidSectorFields` | `validation.test.ts` (4); atomic HTTP whitespace-only code → 400 | **VERIFIED** |
| **BUG-06** | Primary supervisor must exist, be active, have supervisory role | `assertSupervisor` checks archived / no user / inactive / role set | Atomic HTTP: housekeeper primary → 400 `/supervisory role/` | **VERIFIED** |
| **BUG-07** | Lost-update protection via `Sector.version` CAS + `expectedVersion` | Column on P1; increment on save; UI sends `editingSector.version`; 409 `version_conflict` messaging | Atomic HTTP conflict leaves membership unchanged | **VERIFIED** |
| **BUG-08** | Busy/save must not lose edit identity; block tab/edit switch; modal dirty/busy guards | `savingSectorIdRef`; tab buttons `disabled={busy}`; FormModal Escape/X busy+dirty confirm | No double-click / identity Playwright | **VERIFIED** (impl); **PARTIAL** test depth |
| **BUG-09** | Save success + refresh failure must not look like save failure | Separate refresh `try/catch` → “Saved, but list refresh failed”; same pattern in `LocationCatalogPanel` | Unit test of **duplicated** classifier, not page code | **VERIFIED** (impl); **PARTIAL** test coupling |
| **BUG-10** | Catalog mutation must refresh sector membership options | `housekeeping:catalog-changed` dispatch + listener → `refreshSectors` | None | **VERIFIED** (code review only) |
| **BUG-11** | After revoke of primary ownership mid-flight, supervisor must not mutate | Lock → version CAS → `resolveDataScope` → `assertSectorWriteAccessUnderLock` under `FOR NO KEY UPDATE`; test hooks | Real PG concurrency: 3 cases, all pass (see §4–§6) | **VERIFIED** (with probe caveat) |
| **BUG-12** | Audit `before.locationIds` must reflect membership under lock, not a pre-TX stale read | `beforeLocations` read **after** sector lock, before replace | Same file: concurrent A then B; last audit `before` = A’s set | **VERIFIED** (with probe caveat) |

### Supporting claims (pagination / modals / perf)

| Claim | Classification | Notes |
|---|---|---|
| `GET /locations?paged=true` envelope + pageSize clamp 100 | **VERIFIED** | HTTP test + `CATALOG_PAGE_SIZE_MAX=100` |
| UI catalog + sector picker use paged API + debounce/abort | **VERIFIED** | `fetchLocationsCatalogPage` sets `paged=true`; abort controllers present |
| `fetchRooms()` drain unchanged for boards; not used by sector editor | **VERIFIED** | No `fetchRooms` in `SectorPanel` / housekeeping save path |
| Centered FormModal create/edit (sectors, rooms, shifts) | **VERIFIED** | Code + E2E 4/4 |
| Perf 1k/10k EXPLAIN evidence; 100k opt-in | **VERIFIED** | This run: 1k+10k pass; 100k skipped |
| `Sector.version` + `pg_trgm` on P1 | **VERIFIED** | Live schema probe on `maintenance_p1_test` |

---

## 3. Code citations (claimed fixes exist)

### Atomic save + CAS + in-TX access + audit-after-lock

```105:147:api/src/services/sectors/commands.ts
async function lockSectorNoKeyUpdate(tx: Tx, sectorId: string): Promise<void> {
  await tx.$executeRaw`
    SELECT id FROM "Sector" WHERE id = ${sectorId} FOR NO KEY UPDATE
  `;
}
// ...
function assertSectorWriteAccessUnderLock(input: {
  scope: DataScope;
  sector: {
    id: string;
    isActive: boolean;
    primarySupervisorEmployeeId: string | null;
  };
  nextIsActive?: boolean;
}): void {
  if (input.scope.kind === "all") return;
  // ... ownership via primarySupervisorEmployeeId ...
}
```

```282:349:api/src/services/sectors/commands.ts
await prisma.$transaction(
  async (tx) => {
    await lockSectorNoKeyUpdate(tx, id);
    // ...
    if (
      input.expectedVersion !== undefined &&
      existing.version !== input.expectedVersion
    ) {
      throwVersionConflict(existing.version, input.expectedVersion);
    }
    const liveScope = await resolveDataScope(/* ... */, tx);
    assertSectorWriteAccessUnderLock({ scope: effectiveScope, sector: existing, nextIsActive: input.isActive });
    const beforeLocations =
      locationIds !== undefined
        ? await tx.sectorLocation.findMany({ where: { sectorId: id }, select: { locationId: true } })
        : null;
```

### UI single PATCH (BUG-01) + create gate (BUG-03) + busy identity (BUG-08) + refresh split (BUG-09)

```54:56:web/src/pages/HousekeepingPage.tsx
  const isSupervisorScope = user.role === "supervisor";
  /** Supervisors with manage may edit, but must not create sectors. */
  const canCreateSectors = canManageSectors && !isSupervisorScope;
```

```368:407:web/src/pages/HousekeepingPage.tsx
        await updateSector(editingId, {
          code: sectorCode,
          nameBg: sectorNameBg,
          nameEn: sectorNameEn,
          primarySupervisorEmployeeId: supervisorId,
          isActive: sectorActive,
          locationIds: selectedLocationIds,
          expectedVersion: editingSector.version,
        });
        // ...
      try {
        await refreshSectors();
      } catch (refreshErr) {
        setSectorsError(/* Saved, but list refresh failed */);
      }
```

### Pagination + archived picker (BUG-02)

```106:112:web/src/components/SectorPanel.tsx
        const result = await fetchLocationsCatalogPage({
          includeArchived: true,
          q: debouncedQ,
          page,
          pageSize,
          signal: ac.signal,
        });
```

```188:195:web/src/api/locationsApi.ts
  const search = new URLSearchParams();
  search.set("paged", "true");
  // ...
```

### Supervisor create API still 403

```101:105:api/src/controllers/sectors.ts
    const scope = await resolveDataScope(req.user!);
    // Sector-scoped actors cannot create sectors (would expand their data scope).
    if (scope.kind === "sectors") {
      throw new AppError(403, "forbidden", OUT_OF_SCOPE);
    }
```

### Zod trim-before-min (BUG-05)

```29:37:api/src/controllers/sectors.ts
const optionalTrimmed = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1).max(120));
```

---

## 4. Test execution results (this audit)

All API commands used `runWithP1Isolation` / `registerP1TestEnv` → `maintenance_p1_test` only.

| Command | Result | Counts |
|---|---|---|
| `cd api && npm run test:sectors` | **PASS** | **30 pass / 0 fail** (6 suites); duration ~9.2s |
| `node ./tests/runWithP1Isolation.mjs --test-concurrency=1 tests/sectors/access.revoke.concurrency.test.ts` | Covered inside sector suite | **3/3** (BUG-11×2 + BUG-12×1) |
| `node ./tests/runWithP1Isolation.mjs --test-concurrency=1 tests/scenarios/locations.catalog.pagination.http.test.ts tests/scenarios/locations.catalog.perf.db.test.ts src/services/sectors/validation.test.ts` | **PASS** | **7 pass / 0 fail / 1 skip** (100k opt-in) |
| `cd web && npm test` | **PASS** | **292 pass / 0 fail** (73 suites) |
| `cd e2e && npx playwright test tests/housekeeping-modals.spec.ts` | **PASS** | **4 passed** (~22.8s) |

### Perf numbers observed this run

- **1k:** elapsed ~41ms; EXPLAIN Execution Time ~1.24ms (Seq Scan on Location after catalogStatus filter)
- **10k mid-page:** elapsed ~44ms; EXPLAIN Execution Time ~9.97ms (OR ILIKE search still Seq Scan; GIN trgm present but OR across joins limits use)
- **100k:** skipped (`LOCATIONS_PERF_100K` unset)

### Schema probe (P1)

- DB: `postgresql://…@127.0.0.1:5433/maintenance_p1_test`
- `Sector.version` integer default `1`: present
- Indexes: `Location_number_idx`, `Location_number_trgm_idx`, `Location_kind_catalogStatus_idx`
- Extension: `pg_trgm` present

---

## 5. What tests actually assert (not just that files exist)

| File | Assertions that matter |
|---|---|
| `access.revoke.concurrency.test.ts` | (1) With `expectedVersion`, after manager reassign, supervisor save rejects 403 **or** 409; name≠Hijacked; membership unchanged; B remains primary. (2) BUG-12: last `sector.save` audit `before.locationIds` equals A’s committed set, `after` equals B’s write. (3) Without version: hard **403 forbidden**; name≠NoVersionHijack. |
| `save.atomic.http.test.ts` | Atomic PATCH name+membership+version++; whitespace code 400; housekeeper supervisor 400; stale `expectedVersion` → 409 `version_conflict` and membership unchanged; PUT `/locations` accepts `expectedVersion`. |
| `locations.catalog.pagination.http.test.ts` | Paged envelope fields; `pageSize=2` respected; `pageSize=500` clamped to **100**. |
| `locations.catalog.perf.db.test.ts` | Seeded volume pages return ≤pageSize; prints EXPLAIN; 100k opt-in skip. |
| `validation.test.ts` | Uppercase trim code; whitespace names rejected after normalize; empty code; locationId dedupe order. |
| `housekeepingSaveLogic.test.ts` | **Local** `classifySaveRefreshOutcome` / `canCreateSector` helpers — **does not import** `HousekeepingPage` / `SectorPanel`. |
| `auth.http.test.ts` (sector suite) | T-SEC-58 supervisor POST create → 403; manager create → 201; supervisor cannot reassign primary. |
| `e2e/.../housekeeping-modals.spec.ts` | Manager add/edit modal Escape/X; supervisor no add-sector; catalog create+paged search; shifts add modal. **Does not** assert atomic PATCH payload, version CAS, or archived picker tags. |

---

## 6. Mutation-probe sensitivity (code review; production code not mutated)

### Checklist item: remove `assertSectorWriteAccessUnderLock`

| Case | Would test fail if assert removed? | Why |
|---|---|---|
| “supervisor PATCH after manager reassignment” **with** `expectedVersion` | **Probably NO** | Manager `updateSector` increments `version` first; on resume, CAS at `commands.ts` ~296–300 throws `version_conflict` **before** the access assert. Test explicitly allows 403 **or** 409. |
| “without expectedVersion still forbids write” | **YES** | No CAS guard; only ownership recheck blocks `"NoVersionHijack"`. Removing assert would allow the write → assertion failure. |

**Conclusion:** BUG-11 fix is real, but the **headline** concurrency test is not a pure probe of the in-TX access recheck. The third case is the sensitive probe. Remediation checklist item 4 is only partially satisfied by the suite as written.

### Checklist item: move membership before-read above the lock

| Move | Would BUG-12 test fail? | Why |
|---|---|---|
| Snapshot `beforeLocations` at `afterPreTxAuth` (pre-TX), while B is parked | **YES** | B would capture `[loc1,loc2]` before A commits `[loc1,loc2,loc3]`. |
| Read inside TX but **before** `lockSectorNoKeyUpdate`, under current barrier (A fully commits before B enters TX) | **Likely NO** | After release, B’s new TX under Read Committed already sees A’s rows even without holding the sector lock first. Current barrier does **not** force a concurrent in-TX read-before-lock race. |

**Conclusion:** Code order (lock → then before-read) is correct. The existing BUG-12 test proves “not pre-TX stale,” not the full lock-before-read invariant under contention. A stronger probe would park B on `afterSectorLocked` **after** lock but use a second connection to mutate membership only if that were possible — or park after TX start before lock while A holds the lock.

---

## 7. Doc vs code discrepancies / new findings

1. **Web suite count:** remediation claims **287/287**; this audit **292/292**.
2. **Internal rem-doc inconsistency:** §C says Playwright “not executed”; §E / completion criteria claim E2E 4/4 added. (E2E file exists and passes now.)
3. **`access.revoke.concurrency.test.ts` header** says barrier is “after sector lock + before access recheck”; implementation uses **`afterPreTxAuth`** (before TX/lock). Remediation §D text matches code; the test file comment does not.
4. **`housekeepingSaveLogic.test.ts`** duplicates production rules instead of importing them — false confidence for BUG-03/09 “unit coverage.”
5. **`nextIsActive` parameter** on `assertSectorWriteAccessUnderLock` is unused; comment about deactivating own sector is not implemented via that flag (active-sector path simply returns after ownership check).
6. **BUG-11 first case / version masking** — remediation presents both cases as equivalent evidence for access recheck; they are not.
7. **BUG-12 test strength** — weaker than rem narrative “membership before read after lock” proof under true lock interleaving.
8. **Latent UI fragility:** `closeSectorForm` guards on `busy && savingSectorIdRef`, but `onSaveSector` calls `closeSectorForm()` while `setBusy(true)` has not re-rendered yet — close works via **stale `busy===false` closure**. Accidental correctness; a busy-ref refactor could break form close-after-save.
9. **Clients omitting `expectedVersion`:** residual risk admitted by rem doc remains true — internal/`updateSector` default scope callers can still write without CAS.
10. **Legacy `PUT /sectors/:id/locations`** still exists (documented residual); UI path verified not to use it for edit.

No NEW critical functional defect found that re-opens BUG-01…12 as unfixed. Findings above are accuracy, test-strength, and residual-risk items.

---

## 8. Independent audit checklist results

From remediation §E (another agent, without trusting narrative):

| # | Checklist item | Result |
|---|---|---|
| 1 | Diff `commands.ts` — access recheck under `FOR NO KEY UPDATE`; membership `before` after lock | **PASS** — confirmed at lock → CAS → live scope → assert → beforeLocations |
| 2 | UI no sequential PATCH+PUT; single `updateSector` with `locationIds` + `expectedVersion` | **PASS** |
| 3 | Re-run `npm run test:sectors` on P1 only | **PASS 30/30** on `maintenance_p1_test` |
| 4 | Temporarily remove in-TX assert; confirm BUG-11 fails | **NOT EXECUTED (no prod mutation)**; code review: **only no-version case would fail** |
| 5 | Temporarily move before-read above lock; confirm BUG-12 fails | **NOT EXECUTED**; code review: pre-TX move fails test; intra-TX pre-lock move **may still pass** |
| 6 | Supervisor UI: no “+ Добави сектор”; API POST 403 | **PASS** (E2E + T-SEC-58) |
| 7 | Catalog/picker `paged=true`; editor does not `fetchRooms()` drain | **PASS** |
| 8 | Migration `20261031200000_sector_version` on non-P1 before deploy | **P1 applied** (version column live). Non-P1 working DB **not** re-verified in this pass — treat deploy gate as still required |

---

## 9. Residual risks

- Omitting `expectedVersion` still allows writes (CAS optional).
- BUG-11 with version still depends on manager bumping version; access assert is backup for no-version / same-version paths.
- BUG-12 audit correctness under exotic lock interleaving is code-correct but under-probed.
- UI BUG-04/08/10 lack component-level tests; busy/close stale-state fragility.
- Catalog search EXPLAIN may Seq Scan on OR ILIKE across joins despite `pg_trgm` on `Location.number`.
- 100k volume not run by default.
- Pre-existing invalid supervisors not auto-cleared (BUG-06 residual).
- Role-grant edge: UI create gate keys off `user.role === "supervisor"`, not capability grants alone (rem residual).

---

## 10. Final structured verdict

| Dimension | Verdict |
|---|---|
| **Overall** | **PASS_WITH_RISKS** |
| Server BUG-01,05,06,07 | **VERIFIED** + tests |
| Server BUG-11,12 | **VERIFIED** + real PG tests; probe sensitivity incomplete |
| UI BUG-01,02,03,08,09 + modals/pagination | **VERIFIED** in code; E2E covers modal/create-gate/pagination UX partially |
| UI BUG-04,10 | **VERIFIED** by code review only |
| Remediation report accuracy | **PARTIAL** — fixes largely real; counts/comments/test-strength overstated in places |
| Block deploy on these bugs? | **No critical reopen**, but fix test/docs gaps before claiming audit-complete closure |

**Skeptical bottom line:** The remediation’s *implementation* claims hold against live code and P1 tests. Its *assurance* claims (especially equal weight of all BUG-11 cases, BUG-12 lock proof, and UI unit coverage for 03/04/08/09/10) do not fully hold. Hence **PASS_WITH_RISKS**, not PASS.

---

## 11. Follow-up remediations (same day, post-audit)

Tracked against this audit’s assurance gaps. Implementation lives in rem doc + code; this section records what closed each risk:

| Gap from this audit | Follow-up |
|---|---|
| BUG-11 CAS-masked probe | Same-version raw reassign → **403-only** in `access.revoke.concurrency.test.ts` |
| BUG-12 weak lock interleaving | `afterAccessRechecked` + external `FOR NO KEY UPDATE NOWAIT` must fail |
| Unit tests cloned helpers | `web/src/pages/housekeepingLogic.ts` + `housekeepingSaveLogic.test.ts` imports production |
| `expectedVersion` optional | Public PATCH/PUT require `expectedVersion` (Zod `.positive()`) |
| Number / trgm search | Number-first path in `locations/crud.ts` |
| Playwright gaps | Dirty Escape, atomic PATCH body, archived picker tag in `housekeeping-modals.spec.ts` |
| 100k not in CI | `.github/workflows/nightly-perf.yml` with `LOCATIONS_PERF_100K=1` |
| Rem doc accuracy | Remediation report updated + linked to this verification |

Re-audit of these follow-ups is out of scope for this document’s original pass; treat rem doc §E “closed” list as the claim to verify next.
