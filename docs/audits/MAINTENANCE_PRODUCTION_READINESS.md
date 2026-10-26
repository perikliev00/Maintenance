# Meridian Maintenance — Production Readiness Assessment

**Audit date:** 2026-10-25  
**Baseline:** `737cf36`  
**Scores:** qualitative engineering judgment (0–100), **not** measured reliability.

---

## Category matrix

| Category | Assessment | Score | Notes |
| --- | --- | ---: | --- |
| Architecture | **PARTIALLY READY** | 78 | Clear domain split; 1-replica SPOF by design |
| Backend | **PARTIALLY READY** | 80 | Strong domain + tests; BUG-001/SEC-002 remediated (B0/B1) |
| Frontend | **PARTIALLY READY** | 78 | Solid PWA/offline; FEAT-001 Option A; silent notif errors remain |
| Database | **PARTIALLY READY** | 80 | Prisma migrations mature; bundled PG ops risk |
| Security | **PARTIALLY READY** | 78 | SEC-001/SEC-005 remediated (B0/B1); rebuild web to apply edge harden |
| Testing | **PARTIALLY READY** | 84 | Strong suites; gap tracker VERIFIED (B1); isolation via `P1_TEST_DATABASE_URL`; full E2E not re-run in B2 |
| Docker | **PARTIALLY READY** | 80 | API+web harden (B1); prod promote is `--no-build` (B2) |
| CI/CD | **PARTIALLY READY** | 84 | OSV on main (B2); GHCR gate in deploy.yml; remote green NOT VERIFIED |
| Monitoring | **PARTIALLY READY** | 68 | Checklist requires real webhook + external uptime (B2); not wired here |
| Backup & Recovery | **PARTIALLY READY** | 70 | Install docs + local measured drill (B2); S3/prod-sized + RPO15 still open |
| Documentation | **PARTIALLY READY** | 82 | TicketStatus fixed; status-2026-10-21 archived (B2) |
| Deployment | **PARTIALLY READY** | 80 | GHCR imagetools + smoke metrics check (B2); digest pin residual |
| Operational Reliability | **PARTIALLY READY** | 62 | Tooling/docs ready; live webhook/uptime/S3 drill still operator |

**Overall:** **NOT READY** for unsupervised production. **PARTIALLY READY for controlled staging** after operator checklist (secrets, TLS, owner bootstrap, real webhook, backup timer on S3, staging-sized restore). B0–B2 closed code + ops tooling gaps; live environment proofs remain.

---

## Eight readiness questions

### 1. What prevents safe production deployment?

- ~~**BUG-001** ticket assign×start deadlock~~ — **REMEDIATED (B0)**.  
- ~~**SEC-001** public metrics~~ — **REMEDIATED (B0)** (redeploy web/Caddy required).  
- Unclosed operator items: real secrets, DB roles, DNS/TLS, GHCR/Environments, create-owner one-shot, **live** alert webhook + external uptime, **S3** backup timer install + staging-sized restore re-measure.  
- Unverified remote CI/release for current HEAD in this audit environment.  
- ~~B0–B2 code/tooling items~~ — closed in working tree; operator execution remains.

### 2. What could cause production downtime?

- API process crash (SSE + jobs die with it).  
- Postgres volume/host failure without tested restore.  
- Failed migrate without automated rollback (app rollback ≠ schema rollback).  
- Accidental multi-replica scale → duplicate jobs / broken live / weak rate limits.  
- (Prior assign×start deadlock class closed in B0; residual contention surfaces as structured 409.)

### 3. What could cause data loss?

- Untested backup path / missing S3/age keys.  
- Destructive migrate without expand/contract discipline.  
- Restore script misuse (guards exist but drills absent).  
- Demo seed misuse if env guards bypassed (production guards present).

### 4. What could cause security incidents?

- ~~Metrics recon (SEC-001)~~ — public path blocked at Caddy (B0); residual if API port exposed outside backend network.  
- Weak/placeholder JWT or `COOKIE_SECURE=false` if env validation circumvented.  
- Compromised Caddy root container.  
- Future UI reintroducing role-only gates via exported legacy helpers.  
- Scale-out diluting rate limits (SEC-004).

### 5. Which essential capabilities are incomplete?

- Offline ticket assign/close/reopen.  
- Notification channel delivery (email/push).  
- Ops: monitored alerts + measured DR.  
- Gap-tracker formal VERIFIED for P0-10 / P1-110 / P1-117.

### 6. Single points of failure?

API replica, in-memory SSE bus, in-process job lock, single Caddy, optional same-host Postgres + monitoring.

### 7. Highest business impact issues?

1. Backup/DR unproven (data).  
2. Silent/misconfigured monitoring (MTTD).  
3. Deploy/GHCR discipline + operator secrets/TLS checklist.  
4. Docs/status drift causing wrong operator decisions.  
5. P1 product consistency (cleaning bypass, notifications catalog).

### 8. What is sufficiently implemented and should not be changed casually?

- Cleaning lock-order remediation and T-CLN-29 style races.  
- Ticket User→Ticket start order and R-TKT-02 assign×start races (B0).  
- Cookie auth + CSRF + RoleGrant + data-scope model.  
- Sync ticket assignee bypass alignment.  
- Idempotent `commandId` sync model.  
- Production env fail-closed + demo-seed guards.  
- 1-replica hard gate until shared infrastructure exists.  
- Expand/contract migration policy (no auto reverse).  
- Caddy public `/api/metrics` block (B0).  

---

## Staging go-live minimum checklist

- [x] Fix BUG-001 + ordered-race test green (B0 — `assign.start.concurrency.test.ts` 2/2)  
- [x] Fix SEC-001 metrics exposure (B0 — Caddy `@apiMetrics`; redeploy web to apply)  
- [x] Recorded green: P0-10, P1-110, P1-117 (B1 — see `remaining-gaps-progress.md`)  
- [ ] `.env.production` real secrets; `TRUST_PROXY=1`; HTTPS origins  
- [ ] External or hardened Postgres roles per `deploy.md`  
- [ ] DNS + Caddy TLS; public smoke: login, CSRF, SSE > 50s, offline drain  
- [ ] Alertmanager webhook + external uptime (**live** — docs/checklist ready in B2)  
- [x] Backup/restore tooling + **local** measured drill (B2); [ ] install timer + **S3/staging-sized** re-measure  
- [ ] `create-owner` one-shot completed  
- [x] Deploy path documents `--no-build` + GHCR imagetools gate (B2); [ ] confirm images for the **actual** release SHA on the target registry

---

## Evidence from this audit session (commands)

| Check | Result |
| --- | --- |
| `web` typecheck + `npm test` | **116/116 pass** |
| `api` typecheck:tests | **pass** |
| `api`/`web` build | **pass** (known Vite static/dynamic import warnings) |
| `src/env.test.ts` | **11/11 pass** |
| `sync.assignee.http.test.ts` + `jobs.run.http.test.ts` | **5/5 pass** |
| `npm run test:tickets-lifecycle` | **FAILED env** — isolation DB `127.0.0.1:55439` unreachable |
| `compose.prod.yml config` | **Fails without** required env vars (expected) |
| Remote GH Actions / GHCR | **NOT VERIFIED** |
| Full E2E / mutation | **NOT RUN** this session |
