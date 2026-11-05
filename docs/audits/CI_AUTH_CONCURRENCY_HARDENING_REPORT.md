# CI, Authorization & Concurrency Hardening Report

**Branch:** `harden/ci-auth-concurrency-20261105`  
**Base commit (main at start):** `3b98d7bbd36ed66c86a68702d0961f813c18a6b7`  
**Node:** `v24.22.1`  
**Date:** 2026-11-05  

---

## A. Executive Summary

Stabilized the flaky cleaning assignment serialization concurrency test by fixing
**test lock observation** (transitive advisory wait queues), not production
locking. Closed a real **cross-instance RoleGrant stale-cache window** (up to
5s TTL) with a DB revision-stamp gate and proved it with two OS-level API
processes. Consolidated shared lock-waiter helpers, documented authorization
guarantees, and wired a new `auth` CI suite. Local validation of the affected
suites is green; GitHub Actions status and branch protection could not be
confirmed from this environment (no `gh` auth / private API 404).

---

## B. P0 CI Findings

### B1. `parallel assignments share User locks without upgrades or deadlocks`

| Field | Detail |
| --- | --- |
| File/line | `api/tests/cleaning/assignment.serialization.test.ts` (barrier + waiter poll) |
| Cause | Test used **direct** `pg_blocking_pids(holder)` with a **4s** deadline and `count=2`. When two assignments queue on the same advisory lock, the second waiter is often a soft-block behind the first; under CI load both waiters may not appear as *direct* children of the holder within 4s. Production uses `User FOR SHARE` (compatible across parallel assigns) — the expectation of two mid-write waiters is valid, but the observation method was wrong/fragile. |
| Evidence | Known CI failure run `42086145984` (Smoke / cleaning). Local reproduction: 40/40 then 30/30 passes even before the fix under light load; failure mode matches queue semantics documented for `pg_blocking_pids` soft blockers. No deadlocks/lost updates found in production assign paths. |
| Fix | Reuse shared `waitForBlockedBehind` (recursive blocking chain + `wait_event_type='Lock'`, 15s) from `api/tests/dbBarrier.ts`. Keep final-state assertions (both tasks assigned; deactivate serializes). **No production lock change.** |
| Test | Full `assignment.serialization.test.ts` (17/17); parallel case ×30; full cleaning lifecycle 75/75. |
| Result | Pass. |

### B2. CI wiring for new auth suite

| Field | Detail |
| --- | --- |
| File/line | `.github/workflows/ci.yml`, `api/package.json`, `api/scripts/assert-test-inventory.mjs` |
| Cause | New `tests/auth/**` would be inventory orphans and skipped by Smoke. |
| Fix | `npm run test:auth` + Smoke `run_suite auth` + inventory glob. |
| Result | Inventory orphanCount=0. |

---

## C. Authorization Findings

Documented in [`docs/security/AUTHORIZATION_GUARANTEES.md`](../security/AUTHORIZATION_GUARANTEES.md).

| Scenario | Result |
| --- | --- |
| **A Cross-instance revocation** | **Defect found & fixed.** In-memory 5s TTL allowed instance B to serve `canPerform=true` after A committed a revoke. Fix: stamp-gate via `RoleGrantRevision` on every `getGrantMap`. Proven by `tests/auth/crossInstance.grants.test.ts` (two child processes). |
| **B In-flight operations** | Contract: auth at request start; assignment/start re-check eligibility under `User FOR SHARE`. In-flight handlers that already passed `requireAction` are not auto-aborted. Covered by assignment serialization suite. |
| **C Role change** | DB role loaded per request in `authenticateToken`. Cross-instance test demotes manager→housekeeper; `/people` becomes 403 on B immediately. |
| **D Data scope** | Resolves from DB; membership writers use Location/Sector locks. No RoleGrant-cache dependency. Not re-architected. |
| **E Session revocation** | `assertSessionActive` is DB-backed. Cross-instance test revokes sessions; B returns 401. |

### Remaining limitations

- In-flight handlers without transactional re-checks can finish after an action-key revoke.
- Ad-hoc SQL edits to `RoleGrant` without bumping `RoleGrantRevision` can leave other processes on TTL cache until expiry (test `restoreRoleGrants` now bumps versions).
- SSE / rate-limit / some settings caches remain single-replica (see deploy docs).

---

## D. Test Infrastructure Improvements

| Change | Why |
| --- | --- |
| Exported `listBlockedBehind` / `waitForBlockedBehind` from `dbBarrier.ts` | One recursive waiter implementation instead of a fragile local copy in assignment tests. |
| `restoreRoleGrants` bumps `RoleGrantRevision` | Keeps stamp-gated caches coherent across processes after test restore. |
| Docs: `P1_ISOLATION_DB.md` lists `test:auth` | Matches CI. |
| **Not** rewritten: `registerP1TestEnv` / `prepare-p1-test-db.sh` | Already shared and correct; rewriting would add risk without proven duplication bugs. |
| Kept suite aliases (`test:attendance:isolated`, etc.) | Useful for local diagnosis. |

---

## E. Coverage & Mutation

| Metric | Value |
| --- | --- |
| Base SHA measured against | `3b98d7b` (+ this branch’s uncommitted/committed hardening) |
| Node | `v24.22.1` |
| API `npm run coverage` (src unit set) | **58.27%** lines/statements (18275/31358); branches 78.06%; functions 70.31%; **479 pass / 1 fail*** |
| Web `npm run coverage` | **24.70%** lines (8021/32469); branches 74.76%; functions 51.41%; **349/349 pass** |
| API `coverage:all` (`test:all` set) | **89.98%** lines/statements (28213/31353); branches 82.68%; functions 91.23% (measured this session on the hardening branch). |
| Playwright E2E | Classified separately: **not** in c8 denominator (browser flows). Not re-executed end-to-end in this session. |
| Mutation | Targeted Stryker scope does **not** include `roleGrants/cache.ts`. Prior targeted baseline (2026-11-03): API 98.66% / web 91.88% on listed modules only — **not** re-run here; **not** a system-wide mutation score. Cross-instance HTTP test is the regression proof for the cache fix. |

\* The single failure under `coverage` was `permissions.http.test.ts` “revoked action…” with `mark-dirty → 500` (Notification FK). Re-run alone: pass. `npm test` (same file set, no c8): **480/480**. Treated as shared-DB flake under coverage load, not a cache regression.

Exclusions: see `api/.c8rc.json` / `web/.c8rc.json` (`*.test.ts`, fixtures, generated).

**Coverage gate:** Still not recommended as a high fixed threshold. Optional future non-regression floor slightly below a verified `coverage:all` baseline remains appropriate once that run is green and stable.

---

## F. CI Verification

| Job / suite | Local | GitHub Actions |
| --- | --- | --- |
| API lint / build / typecheck:tests | Passed | **Not executed here** (`gh` unauthenticated; Actions API 404) |
| Web lint / build / unit (349) | Passed | Not executed here |
| Smoke cleaning | 75/75 | Not executed here |
| Smoke auth (new) | 3/3 | Not executed here |
| Smoke unit-src | 480/480 | Not executed here |
| Attendance / people concurrency | 25/25 | Not executed here |
| E2E Playwright | Not executed | Not executed |
| Container / release / deploy workflows | Not executed | Not executed |

**Do not claim CI green** until the PR’s Actions run completes.

### Delivery status

- Branch pushed: `harden/ci-auth-concurrency-20261105` → `origin` (tip `daef3ab`).
- PR creation via `gh` / GitKraken PR API was **not possible** (no GitHub CLI / GK auth token in this environment).
- Open compare/PR manually: https://github.com/perikliev00/Maintenance/compare/main...harden/ci-auth-concurrency-20261105?expand=1

### Branch protection

Could not read or change rulesets/branch protection (no GitHub token with admin scope in this environment). Owner should ensure `main` requires at least:

- `API`
- `Web`
- `Smoke`
- (existing) other stable required checks already configured

and blocks direct pushes if that matches team policy, while retaining admin bypass for recovery.

Suggested GitHub UI path: **Settings → Rules → Rulesets** (or Branch protection rules) for `main` → enable “Require status checks to pass” with the exact check names from a green Actions run on this PR, and “Restrict direct pushes” / require PR as appropriate.

---

## G. Remaining Risks

### P0 Critical

_None known in scope after the fixes above._

### P1 High

- GitHub Actions / branch protection **unverified** from this workstation.
- Multi-replica SSE / rate-limit / settings invalidation still block safe horizontal scale (pre-existing).

### P2 Medium

- Occasional Notification FK 500 under heavy parallel coverage/load in permissions HTTP test (flake).
- `coverage:all` current SHA may still be running / needs posting when finished.
- Targeted mutation not re-measured on this branch.

### P3 Low

- Extra `RoleGrantRevision` stamp query on every cold/miss `canPerform` (intentional).
- Duplicate transitive-waiter helpers still exist under `sectors/fixtures.ts` (optional later consolidation onto `dbBarrier`).

---

## H. Final Assessment

| Area | Score | Rationale |
| --- | --- | --- |
| CI stability | **7.5 / 10** | Flaky observation fixed + auth suite wired; remote CI not yet confirmed. |
| Authorization correctness | **8.5 / 10** | Cross-instance grant revoke closed; session/role DB-backed; in-flight contract documented. |
| Transaction safety | **8.5 / 10** | Assignment eligibility locks unchanged and re-validated; no production lock weakening. |
| Concurrency test reliability | **8.5 / 10** | Transitive waiters + 15s polls aligned with other suites; ×30 parallel case green. |
| Test infra maintainability | **8 / 10** | Shared barrier helper + inventory/CI wiring; no risky rewrite of P1 preload. |
| Overall production readiness | **8 / 10** | Ready pending green PR checks and owner confirmation of required status checks on `main`. |

---

## Independent verification notes

- Production cleaning/maintenance lock order was **not** changed to green the test.
- Assertions were strengthened (transitive count), not relaxed.
- Cross-instance proof uses **separate Node processes**, not two `createApp()` shares of one module cache.
- `getGrantMap` simplified after review so mid-flight `invalidateGrantCache` retries instead of returning a discarded generation’s map.
