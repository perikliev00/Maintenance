# Meridian Maintenance — Master Technical Audit

**Audit date:** 2026-10-25  
**Baseline commit:** `737cf36e6424af385f1e82338280b2881680e925` (`main`, clean tree)  
**Method:** Repository discovery, static verification of prior audits, targeted code review, selective safe test execution. **No application source, schema, or infra config was modified** (audit Markdown only).  
**Related reports:** [Executive](./MAINTENANCE_EXECUTIVE_SUMMARY.md) · [Bugs](./MAINTENANCE_BUG_REPORT.md) · [Features](./MAINTENANCE_MISSING_FEATURES.md) · [Security/DevOps](./MAINTENANCE_SECURITY_DEVOPS_AUDIT.md) · [Production readiness](./MAINTENANCE_PRODUCTION_READINESS.md) · [Roadmap](./MAINTENANCE_DEVELOPMENT_ROADMAP.md) · [Regression plan](./MAINTENANCE_REGRESSION_TEST_PLAN.md)

---

## 1. Phase 1 — Architectural overview

### 1.1 Technology stack (detected only)

| Layer | Technology |
| --- | --- |
| Language | TypeScript (api, web, e2e) |
| Runtime | Node.js 22 (CI/Docker); local audit ran Node 24 |
| API | Express 4, Zod, Helmet, express-rate-limit, cookie-parser |
| ORM/DB | Prisma 6 + PostgreSQL 16 |
| Auth | JWT (jsonwebtoken) + bcryptjs; DB AuthSession; CSRF double-submit |
| Web | React 19, Vite 6, vite-plugin-pwa; hash/panel routing (no react-router) |
| E2E | Playwright |
| Edge | Caddy 2 (custom build in `web/Dockerfile`) |
| Jobs | In-process scheduler (`setInterval`) — **no Redis/queue** |
| Monitoring | Prometheus, Grafana, Alertmanager, exporters (Compose profile) |
| CI | GitHub Actions (ci, release, deploy, mutation) + Dependabot |

### 1.2 Repository layout

```
api/          Express API, Prisma, domain services, scenario tests
web/          React PWA + Caddyfile
e2e/          Playwright
infra/        monitoring + backup examples
scripts/      backup/restore/verify
docs/         audits, operations, testing, refactoring
.github/      CI/CD workflows
compose.prod.yml, docker-compose.yml
```

### 1.3 Component responsibilities & data flow

```
Browser (React PWA + IndexedDB outbox)
   │  /api  (Vite proxy dev | Caddy strip_prefix prod)
   ▼
Express API (single replica)
   ├── AuthSession + JWT cookies/CSRF
   ├── RoleGrant + dataScope
   ├── Domain services (cleaning, maintenance, attendance, …)
   ├── In-process job scheduler + EventEmitter SSE bus
   └── Prisma ──► PostgreSQL 16
```

**External integrations (real):** PostgreSQL, Caddy/ACME, GHCR, optional Prometheus stack, optional S3+age backups (scripts), simulated attendance terminal API, daily-plan JSON import.  
**Not present:** Redis, live PMS SDK, card encoder, email/SMS/push providers, OAuth IdP, Kubernetes manifests.

### 1.4 Deployment architecture

- Dev: local Node + Compose Postgres `:5433`.  
- Prod: `compose.prod.yml` — db, migrate, bootstrap, api, web; optional monitoring; create-owner profile.  
- Release: immutable SHA tags to GHCR; deploy workflow SSH + `pull` + `up --no-build` + ready probe.

### 1.5 Architectural strengths

1. Clear controller → service → sync-command separation.  
2. Idempotent offline commands (`commandId`).  
3. Strong concurrency culture (row locks, ordered races for cleaning).  
4. Capability model (panels/actions) + data-scope.  
5. Production packaging: fail-closed env, demo-seed guards, API container hardening, health/ready.

### 1.6 Architectural weaknesses

1. Single API process owns SSE, jobs, rate limits, caches — scale-out unsafe.  
2. ~~Ticket start lock order incomplete vs cleaning remediation (**BUG-001**).~~ **REMEDIATED (B0)** — User→Ticket on start + R-TKT-02.  
3. ~~Public metrics via Caddy (**SEC-001**).~~ **REMEDIATED (B0)** — Caddy blocks `/api/metrics`.  
4. ~~Web container less hardened than API.~~ **Hardened (B1 / SEC-005)** — residual: rebuild/redeploy required.  
5. Backup/DR: install docs + local measured drill (B2); S3/staging-sized still operator.  
6. ~~Documentation drift (TicketStatus, stale ops status)~~ **fixed (B2)**; ~~notifications panel~~ **aligned (B1)**.

### 1.7 Documentation vs implementation mismatches

| Claim | Reality |
| --- | --- |
| README TicketStatus `new\|in_progress\|resolved\|closed` | Schema also has `assigned`, `waiting` |
| README short panel/action tables | Broader `ALL_PANELS` / `ALL_ACTIONS` in `permissions.ts` |
| Notifications as normal panel | Forced client-side; absent from server `ALL_PANELS` |
| `status-2026-10-21.md` “not committed” | Production stack committed (`eb7786e`+) |
| Gap tracker “Final regression running” for P0-10/P1-110/P1-117 | **VERIFIED / DONE (B1)** with executed evidence |
| Deploy digest promote | Tooling uses SHA tags; Compose retains `build:` |

### 1.8 Prior audits reviewed

| Document | Role | Treatment |
| --- | --- | --- |
| `maintenance-independent-bug-audit.md` | AUDIT-001..003 | Re-verified remediations |
| `remaining-gaps-progress.md` | Concurrency tracker | Many VERIFIED; 3 unfinished rows |
| `project-audit-review-2026-10-22.md` | Full review at `8d4f146` + uncommitted tree | Updated: packaging now on main |
| `test-coverage-gaps-audit` + remediation | Gaps 3.1–3.4 | Tests present; samples passed |
| Root `_audit_*.txt` | Oct 17–18 notes | Truncated A/F; G APPROVED scoped |
| `референция` | Product reconstruction | Spec, not verified mock-by-mock |

---

## 2. Phase 2 — Functionality summary

See [MAINTENANCE_MISSING_FEATURES.md](./MAINTENANCE_MISSING_FEATURES.md) for the full matrix.

**Headline:** Core housekeeping + maintenance workflows are **COMPLETE** at API level with solid UI coverage. Gaps are mainly offline ticket dispatch/close, notification delivery/catalog, and intentional roadmap items (encoder, PMS, QR confirm).

---

## 3. Phase 3 — Bug audit summary

See [MAINTENANCE_BUG_REPORT.md](./MAINTENANCE_BUG_REPORT.md).

| Confirmed HIGH (open) | Confirmed MEDIUM (open) | Confirmed LOW | Suspected |
| ---: | ---: | ---: | ---: |
| 0 (BUG-001, SEC-001 **REMEDIATED** B0) | 2 open (FEAT-001/SEC-002 **REMEDIATED** B1) | 2 | 5 |

No CRITICAL (RCE / auth bypass / confirmed mass data loss) verified.

---

## 4. Phase 4–5 — Security & DevOps summary

See [MAINTENANCE_SECURITY_DEVOPS_AUDIT.md](./MAINTENANCE_SECURITY_DEVOPS_AUDIT.md).

AuthZ/SSE/CSRF posture is strong. Residual: public metrics, cleaning bypass consistency, web hardening, ops DR/alerts, 1-replica constraints.

---

## 5. Phase 6 — Code quality & maintainability

| Observation | Assessment |
| --- | --- |
| Domain modularization | Good (controllers/services/sync) |
| Lock-order discipline | Strong in cleaning/SSE; **gap in ticket start** |
| Typing | TypeScript throughout |
| Dead TODO/FIXME in src | None material found |
| Legacy role helpers | Still exported — regression risk |
| Testability | High for API scenarios; TSX mutation coverage weak historically |
| Lint | No package lint scripts |
| Complexity hotspots | Cleaning sessions, maintenance progress, offline drain, notifications fan-out |

**Recommendation:** incremental fixes (roadmap B0–B3); **no rewrite**.

---

## 6. Phase 7 — Test execution (this session)

| Command | Result |
| --- | --- |
| `web` `typecheck:tests` + `npm test` | **116 pass / 0 fail** (audit baseline) |
| `api` `typecheck:tests` | **pass** (audit baseline) |
| `api` `npm run build` | **pass** (audit baseline) |
| `web` `npm run build` | **pass** (static/dynamic import warnings; audit baseline) |
| `api` `src/env.test.ts` | **11 pass** (audit baseline) |
| `sync.assignee.http.test.ts` + `jobs.run.http.test.ts` | **5 pass** (audit); **re-run B0: 3+2 pass** |
| `assign.start.concurrency.test.ts` (R-TKT-02 / B0) | **2/2 pass** via `P1_TEST_DATABASE_URL` → `:5433/maintenance_p1_test` |
| `idempotency.concurrency` + `transitions.matrix` (B0) | **11/11 pass** (same DB override) |
| B1 cleaning bypass HTTP + sync | **1 + 3 pass**; AUDIT-003 sync.assignee **3/3** re-run |
| B1 web `npm test` (capabilities + P0-10 units) | **117/117 pass** |
| B1 E2E remaining-ui + remaining-workflows | **20/20 pass** (P0-10, P1-110, P1-117) |
| B1 API `sync.http.test.ts` | **7/7 pass** (incl. P0-10) |
| `api`/`web` `tsc --noEmit` (B1) | **pass** |
| `npm run test:tickets-lifecycle` (full glob) | **NOT RUN as one command** — `.env.p1_test` `:55439` unreachable; focused suites used `:5433` override |
| Full `test:scenarios` / mutation / remote CI | **NOT RUN** |
| `compose.prod.yml config` without env | Fails as expected (required vars) |
| Live Caddy `/api/metrics` curl | **NOT RUN** (config review only) |

**Interpretation:** B0+B1 focused evidence supports remediation of BUG-001, SEC-001, SEC-002, SEC-005, FEAT-001 and gap-tracker close. Does **not** prove full production readiness.

---

## 7. Phase 8 — Production readiness

See [MAINTENANCE_PRODUCTION_READINESS.md](./MAINTENANCE_PRODUCTION_READINESS.md).

**Verdict:** **NOT READY** for unsupervised production; **PARTIALLY READY** for controlled staging after operator checklist. Code P0 (BUG-001 / SEC-001) remediated in B0.

---

## 8. Phase 9–10 — Roadmap & regression

See [MAINTENANCE_DEVELOPMENT_ROADMAP.md](./MAINTENANCE_DEVELOPMENT_ROADMAP.md) and [MAINTENANCE_REGRESSION_TEST_PLAN.md](./MAINTENANCE_REGRESSION_TEST_PLAN.md).

**Next:** Operator **B2 residuals** + deferred P4 (T02–T07) as prioritized. (**B0–B3 DONE;** **B4 PARTIAL** = P4-T01/FEAT-002; P3-T06 deferred.)

---

## 9. Finding index (this audit)

| ID | Sev | Type | One-line |
| --- | --- | --- | --- |
| BUG-001 | HIGH | **REMEDIATED (B0)** | User→Ticket on start; `assign.start.concurrency.test.ts` 2/2 |
| SEC-001 | HIGH | **REMEDIATED (B0)** | Caddy `@apiMetrics` → 404; scrape `api:4000` |
| DOC-001 | MEDIUM | **REMEDIATED (B2)** | TicketStatus includes `assigned`/`waiting` |
| FEAT-001 | MEDIUM | **REMEDIATED (B1 Option A)** | `notifications` in ALL_PANELS + RoleGrant |
| FEAT-002 | MEDIUM | **REMEDIATED (B4)** | Offline ticket assign/close/reopen via sync + outbox |
| SEC-002 | LOW–MED | **REMEDIATED (B1)** | `canBypassCleaningAssignee` HTTP+sync |
| UI-001 | LOW | Confirmed | Reopen UX Control-only |
| OPS-DOC-001 | LOW | **REMEDIATED (B2)** | status-2026-10-21 marked HISTORICAL |
| SUS-001…005 | LOW–MED | Mixed | SUS-001 mitigated (cap); SUS-002 remediated (JWT pin); SUS-003/004 open; SUS-005 improved (B3) |

Prior remediations still good: **AUDIT-001, AUDIT-002, AUDIT-003, P1-115** (code evidence).

---

## 10. What should not be casually changed

- Cleaning User→Task lock order and T-CLN-29 races  
- Ticket User→Ticket start order and R-TKT-02 assign×start races (B0)  
- Cookie JWT + CSRF + RoleGrant + data-scope  
- Sync ticket assignee bypass wiring  
- Production env fail-closed / demo-seed guards  
- Single-replica hard gate until shared infra exists  
- Expand/contract migration policy  
- Caddy public metrics block (SEC-001 / B0)  

---

## 11. Audit limitations

- No penetration test, load test, or multi-device field offline trial.  
- No remote GitHub Actions / GHCR inspection (unauthenticated).  
- No live staging/prod deploy.  
- Full `test:tickets-lifecycle` not run as one command; `:55439` unreachable (B0 used `:5433` override for focused suites).  
- Live Caddy edge metrics assertion not executed (config-only for SEC-001).

These limits are stated as **NOT VERIFIED**, not as green assumptions.
