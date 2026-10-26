# Meridian Maintenance — Regression Prevention Strategy

**Audit date:** 2026-10-25  
**Baseline:** `737cf36`  
**Cross-refs:** [Roadmap](./MAINTENANCE_DEVELOPMENT_ROADMAP.md) · [Production readiness](./MAINTENANCE_PRODUCTION_READINESS.md) · `api/tests/scenarios/README.md`

---

## Principles

1. A green compile is **not** done.  
2. Concurrency fixes require **ordered-race** or barrier tests, not only happy-path HTTP.  
3. AuthZ changes require HTTP deny assertions **and** unchanged DB side effects.  
4. Offline/sync changes require identity binding (P0-10 class) + assignee/scope gates.  
5. Infra/Caddy changes require public vs internal path smoke.  
6. Migrations must be expand/contract; never rely on auto-downgrade.

---

## Critical end-to-end regression scenarios

| ID | Scenario | Layers |
| --- | --- | --- |
| R-AUTH-01 | Login → CSRF mutate → refresh → logout-all | API + E2E |
| R-CLN-01 | Cleaning create → start → complete → inspect approve | API lifecycle + E2E |
| R-CLN-02 | Concurrent start × reassign (T-CLN-29) | API ordered race |
| R-TKT-01 | Report → assign → start → wait → resume → resolve → close → reopen | API tickets lifecycle |
| R-TKT-02 | Concurrent assign × start (**BUG-001 / B0**) — `assign.start.concurrency.test.ts` **2/2 pass** (2026-10-25) | API ordered race |
| R-SYNC-01 | Offline ticket start as foreign tech denied; manager bypass | `sync.assignee.http.test.ts` |
| R-SYNC-03 | Offline ticket assign/close/reopen allow+deny + invalid_state (**FEAT-002 / B4**) | `sync.ticket.assign-close-reopen.http.test.ts` |
| R-SYNC-02 | Mid-drain identity switch (P0-10) | web unit + E2E |
| R-SSE-01 | Live event delivery respects data-scope; role change mid-stream | scenarios / live E2E |
| R-SCOPE-01 | Out-of-sector ticket access → 403 | scenario suites |
| R-JOBS-01 | Concurrent `/jobs/run` → 409 then success | `jobs.run.http.test.ts` |
| R-READY-01 | Blocking ticket + dirty room → not_ready reasons | readiness tests |
| R-UI-01 | Live domain refresh + busy deferral (P1-117) | E2E remaining-ui |
| R-OFF-01 | Offline cleaning start+complete reconcile (P1-110) | E2E remaining-workflows |

---

## Minimum automated expectations by change type

| Change type | Minimum tests |
| --- | --- |
| Ticket/cleaning lifecycle | Domain suite + at least one concurrency test if locks touched |
| Auth / RoleGrant / scope | Deny path HTTP + DB unchanged; `/auth/me` capabilities |
| Sync command | HTTP sync push success/deny + outbox unit if client payload shape changes |
| SSE | Authorization unit/scenario; no delivery after revoke |
| Env / security middleware | `env.test.ts` matrix; rate-limit skip list review |
| Caddy / Compose | `docker compose config` with sample env; metrics path assertion |
| Prisma migration | Migrate on empty DB + upgrade-from-legacy smoke (CI already has audit upgrade) |
| UI action gates | `canPerformAction` unit + page permission mapping tests |

---

## API contract validation

- Prefer existing scenario HTTP tests over ad-hoc curl.  
- When adding endpoints: Zod request schema + typed error codes (`AppError` codes stable).  
- Sync: extend `applyCommand` switch + schema together; never client-only.  
- Document breaking status enum changes in README **and** clients.

---

## Database migration validation

1. Apply on disposable DB (`assertTestDatabase` / CI Postgres).  
2. Run `scripts`/`assert-sql-invariants` where present.  
3. No destructive column drops without expand period.  
4. Rollback plan = previous app SHA + forward fix; not `migrate down`.

---

## Security regression checks

- CSRF required on cookie mutating routes.  
- `requireAction` present on new routers (or documented controller-level grant).  
- Metrics / health / debug routes: review public exposure after every Caddy change.  
- Gitleaks + Trivy remain CI-blocking for HIGH/CRITICAL images.  
- Do not reintroduce direct legacy role helper UI gates.

---

## CI quality gates (keep / tighten)

**Keep blocking:** Smoke (migrate + scenarios + domain), E2E, container Trivy, Gitleaks.  
**Tighten (P2):** OSV on main pushes; optional lint; deploy verifies GHCR manifest.  
**Non-blocking signal:** Mutation weekly — investigate score drops on critical modules.

**False-green warnings:**

- API CI job builds without running `npm test` (Smoke holds the real API suites — do not remove Smoke).  
- Mutation not on PR — do not treat merge as mutation-proof.  
- Local ticket suites need isolation DB (`:55439`); missing DB ≠ product failure.

---

## Deployment smoke tests

After every staging/prod deploy:

1. `GET /api/health/live` and `/api/health/ready`  
2. Login + CSRF-protected mutation  
3. SSE connection alive > 2× heartbeat  
4. One cleaning start/complete and one ticket assign/start  
5. Offline outbox drain once  
6. Confirm `/api/metrics` **not** anonymously public (after P0-T02)  
7. Spot-check Alertmanager silence/firing if monitoring profile enabled  

Rollback: previous `RELEASE_SHA` images with `--no-build`; schema stays forward.

---

## Post-deployment verification

- Job runs appear in `/jobs` or metrics without elevated failure rate.  
- No spike in 5xx alerts for 30–60 minutes.  
- Backup heartbeat fresh within threshold.  
- Owner/admin can open Permissions + Live + Repairs.

---

## Recommended test isolation

- Use `runWithP1Isolation.mjs` / dedicated test DB — never production.  
- `--test-concurrency=1` for DB suites.  
- Prefer `orderedDatabaseRace` / barriers for lock-order bugs.  
- E2E against ephemeral stack matching CI services.

---

## Mandatory implementation phase checklist

Every future Codex/implementation batch must include:

1. **Pre-change baseline** — HEAD SHA; list suites green (or note env limits).  
2. **Explicit scope** — files/findings in/out.  
3. **Implementation**  
4. **Relevant automated tests** added/updated  
5. **Regression testing** — at least R-* scenarios touching the domain  
6. **Build/config verification** — `tsc`/Vite build; Compose/Caddy if infra  
7. **Security impact evaluation** — authz, exposure, secrets  
8. **Final verification report** — pass/fail table; residual risks  

Incomplete if only “it compiles.”
