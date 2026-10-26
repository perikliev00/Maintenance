# Meridian Maintenance — Security, DevOps & Operations Audit

**Audit date:** 2026-10-25  
**Baseline:** `737cf36`  
**Cross-refs:** [Bugs](./MAINTENANCE_BUG_REPORT.md) (SEC-001, BUG-001) · [Production readiness](./MAINTENANCE_PRODUCTION_READINESS.md) · prior `project-audit-review-2026-10-22.md`

---

## 1. Security posture (application)

### Strengths (verified)

- Helmet on API; CORS allowlist + credentials; production fail-closed env (`api/src/env.ts`).
- httpOnly session/refresh cookies; `sameSite: lax`; Secure in production; CSRF double-submit for cookie mutating requests.
- Authorization: `requireAuth` + `requireAction` (RoleGrant); data-scope on tickets/cleaning; notifications filtered by recipient.
- SSE: ticket TTL, purpose-bound JWT rejection as access tokens, per-delivery re-auth with User/Sector FOR SHARE (P1-115 class).
- Sync ticket assignee bypass aligned with HTTP (**AUDIT-003** remediиран; regression passed this session).
- No production `$executeRawUnsafe` in app paths reviewed; no file-upload stack; no `dangerouslySetInnerHTML` in `web/src`.
- Secrets: placeholders in examples only; Gitleaks in CI; Dependabot weekly.

### Confirmed issues

| ID | Sev | Summary | Evidence |
| --- | --- | --- | --- |
| **SEC-001** | HIGH | Public `/api/metrics` — **REMEDIATED (B0)** | Caddy `@apiMetrics` → 404; scrape `api:4000` (see Bug report) |
| **SEC-002** | LOW–MED | Cleaning bypass ≠ ticket bypass — **REMEDIATED (B1)** | `canBypassCleaningAssignee` HTTP+sync |
| **SEC-003** | P3 / prior | Legacy role helpers still exported — **REMEDIATED (B3)** | helpers privatized; barrel no longer exports |
| **SEC-004** | P2 ops | In-memory rate limits | Safe only with `replicas: 1` |
| **SEC-005** | P3 | Web Caddy root + no SPA security headers — **REMEDIATED (B1)** | non-root + headers + healthcheck; rebuild to apply |

### Suspected

| ID | Summary |
| --- | --- |
| SUS-002 | Pin JWT `algorithms: ["HS256"]` — **REMEDIATED (B3)** |
| SUS-003 | Constant-time CSRF compare |
| SUS-004 | SSE ticket query-string leakage |

### Disproved this session

CSRF bypass, hardcoded prod secrets, SQLi in prod paths, XSS sinks, ticket/notification IDOR without scope, AUDIT-001/002/003 as still open code defects.

---

## 2. Docker & Compose

### API (`api/Dockerfile` + `compose.prod.yml`)

- Multi-stage; runtime `USER node`; `read_only` + tmpfs; `cap_drop: ALL`; `no-new-privileges`; mem/cpu/pids; `/health/ready` healthcheck; `replicas: 1`.
- Separate migrate / bootstrap / owner image targets; demo seed / owner not on normal path.

### Web

- Multi-stage Vite + custom Caddy; **no non-root USER**; **no healthcheck**; **no read_only**; SPA lacks CSP/frame headers.
- Proxies `/api/*` except `/api/metrics` (blocked at edge for SEC-001 / B0).

### Dev vs prod

- Dev: Postgres only on `127.0.0.1:5433`, weak fixed creds — acceptable for local.
- Prod: DB not published; required env secrets; monitoring behind Compose profile.
- Bundled Postgres volume always defined — managed DB preferred for hotel prod (OPS-004).

### Secrets handling

- Env-file based (`.env.production`); no Docker secrets mounts — acceptable at current scale with host ACL; prefer secret mounts later.

---

## 3. CI/CD

| Workflow | Role | Assessment |
| --- | --- | --- |
| `ci.yml` | Build, typecheck, smoke (migrate+suites), E2E, Trivy, Gitleaks, OSV on PRs | **Strong real gates**; API job itself does not run unit tests (Smoke does) |
| `release.yml` | SHA-tagged GHCR images + SBOM after CI on main | Real design; **remote success NOT VERIFIED** (`gh` unauthenticated) |
| `deploy.yml` | Manual SSH, `--no-build`, curl ready | Real; no auto-rollback; no GHCR digest existence check |
| `mutation.yml` | Weekly / manual Stryker | Signal, not merge gate |
| Dependabot | Weekly npm + actions | Present |

**Gaps:** OSV only on PRs (push-to-main skips); no lint script; deploy docs say digest promote while tooling uses tags + Compose still has `build:`.

---

## 4. Monitoring

- Prometheus scrapes API metrics, postgres-exporter, node-exporter; Alertmanager webhook; Grafana overview; alerts for API down, 5xx, DB, jobs, SSE, sync, backup stale.
- Monitoring profile optional → easy to ship without alerts.
- Default webhook non-routable (OPS-006) — fail-visible; **B2**: go-live checklist blocks honest “monitoring ready” without real URL + external uptime (`incident-response.md`).
- Backup stale alert depends on host textfile (defeated if host down); **25h threshold documented** as “missed ~day of hourly dumps”; pair with `BACKUP_HEARTBEAT_URL`.

---

## 5. Backup & recovery

| Asset | Status |
| --- | --- |
| `scripts/backup-db.sh` (pg_dump → age → S3 **or** `BACKUP_LOCAL_DIR`) | Implemented (B2 local mode) |
| `restore-db.sh` / `verify-restore.sh` | Implemented; refuse production NODE_ENV / live-ish names; local file mode |
| systemd timer examples + install doc | **Operator-ready** (`backup-install.md`) — still not installed by Compose |
| Measured restore drill | **Partial (RISK-03)** — local disposable Docker drill **pass** (~2s restore); S3/prod-sized **NOT VERIFIED** |
| RPO ≤15 min | **Not met** by hourly dumps; docs note PITR needed |
| RTO ≤60 min | Local tiny-DB evidence only; staging-sized re-measure required |

---

## 6. Prior OPS/RISK status vs current main

| ID | Prior | Now |
| --- | --- | --- |
| OPS-001 Compose `build:` | Open | **Mitigated (B2)** — docs + deploy `--no-build` + header comments; `build:` remains for staging/local |
| OPS-002/003 single replica / process lock | By design | **Still true** |
| OPS-004 bundled Postgres | Open | **Still open** |
| OPS-005 hardening uncommitted | Open | **Code committed** (`eb7786e`+); remote CI proof residual |
| OPS-006 alert webhook | Open | **Docs/checklist DONE (B2)**; live webhook still operator |
| RISK-01 uncommitted packaging | Open | **Mostly resolved** (code); remote residual |
| RISK-02 secrets/DNS/GH env | Open | **Still open** (operator) |
| RISK-03 restore drill | Open | **Partial (B2)** — local disposable measured; S3 staging-sized open |
| DEP-01 / GHCR gate | Open | **Improved (B2)** — imagetools inspect before SSH; SHA-tag ≠ digest pin |
| MON-02 external uptime | Open | **Documented required (B2)** |
| DOC-001 / OPS-DOC-001 | Open | **DONE (B2)** |

---

## 7. Single points of failure

1. Single API process (SSE bus, job lock, rate limits, grant/settings caches).  
2. Single Caddy edge.  
3. Bundled Postgres on same host (if used).  
4. Monitoring on same Compose project (same failure domain).  
5. Deploy SSH key + host.

Horizontal scale without shared bus/limits/job lease remains a **correctness** hazard — keep hard gate at 1 replica until redesigned.

---

## 8. Recommendations (priority order)

1. ~~Close SEC-001 (metrics exposure).~~ **DONE (B0)** — redeploy web/Caddy to apply.  
2. ~~Harden Caddy/web container.~~ **DONE (B1 / SEC-005)** — rebuild/redeploy web image.  
3. ~~Install backup timer + restore drill.~~ **DONE docs + local drill (B2)** — operator: install timer + S3 staging-sized re-measure.  
4. ~~Configure Alertmanager + external uptime guidance.~~ **DONE checklist (B2)** — wire real webhook/uptime.  
5. ~~Deploy GHCR gate / no-build.~~ **DONE (B2)** — digest pin residual.  
6. ~~Pin JWT algorithms (B3).~~ **DONE (B3 / SUS-002)**. ~~Cleaning bypass.~~ **DONE (B1 / SEC-002)**. ~~Legacy helpers.~~ **DONE (B3 / SEC-003)**. ~~oxlint CI.~~ **DONE (B3 / P3-T05)**.
7. Only if scaling: Redis/shared store + out-of-process job lease + SSE fan-out redesign (**P3-T06 deferred**).

## B2 remediation evidence (2026-10-25)

- Local restore drill: `scripts/run-local-restore-drill.ps1` → **pass**, restore ~**2s**, users=1, migrations=35; evidence `docs/operations/backup-restore-drill-2026-10-25.md`.
- S3 off-host backup path: **not exercised** (no drill credentials).
- Remote GHCR imagetools / Actions for this HEAD: **NOT VERIFIED** locally.

## B3 remediation evidence (2026-10-26)

- SEC-003: legacy helpers unexported; `canPerformAction` remains the UI path.
- SUS-002: access + SSE JWT `HS256` pin; unit reject `none` / `HS384`.
- P3-T05: `oxlint --quiet` wired as `npm run lint` in api/web CI jobs.
- DB-backed auth/sync concurrency smoke for this HEAD: **NOT RUN** (local Postgres unavailable).
