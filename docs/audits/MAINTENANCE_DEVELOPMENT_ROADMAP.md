# Meridian Maintenance — Development Roadmap

**Audit date:** 2026-10-25  
**Baseline:** `737cf36`  
**Priority formula:** Severity + Business Impact + Failure Probability + Dependencies + Effort  
**Finding IDs:** [Bug report](./MAINTENANCE_BUG_REPORT.md) · [Security/DevOps](./MAINTENANCE_SECURITY_DEVOPS_AUDIT.md)

---

## Execution order (batches for Codex agents)

| Batch | Priority | Scope | Risk |
| --- | --- | --- | --- |
| **B0** | P0 | Ticket lock order + metrics exposure | **DONE** (2026-10-25) |
| **B1** | P1 | Gap-tracker close + cleaning bypass + Caddy harden + notifications | **DONE** (2026-10-25) |
| **B2** | P2 | Ops DR/alerts/deploy gates + docs sync | **DONE** (2026-10-25) |
| **B3** | P3 | Maintainability (legacy helpers, pagination, JWT pin) | Low — **next** |
| **B4** | P4 | Product enhancements (offline assign, PMS, encoder, …) | Product |

Do **not** combine B0 with B4. Do **not** attempt multi-replica redesign in B0–B2.

---

## P0 — Critical stabilization

### P0-T01 — Fix ticket assign × start lock order — **DONE**

| Field | Value |
| --- | --- |
| **Related** | BUG-001 |
| **Status** | **DONE** (2026-10-25) |
| **Components** | `api/src/services/maintenance/progress.ts` (start; review wait/resume/resolve); possibly shared helper with assign |
| **Steps** | 1) Mirror cleaning: preview assignee → `lockEmployeesForLiveAccess` / starter User lock → `loadLockedTicket` → status checks → claim. 2) Document order in comments. 3) Add `orderedDatabaseRace` test (assign-first & start-first) asserting no 500. 4) Run tickets lifecycle + concurrency suites on isolation DB. |
| **Dependencies** | None |
| **Acceptance** | Concurrent assign+start never deadlocks; loser gets structured 409; T-CLN-29-equivalent test green |
| **Evidence** | `progress.ts` User→Ticket; `api/tests/tickets/assign.start.concurrency.test.ts` **2/2 pass**; `idempotency.concurrency` + `transitions.matrix` **11/11 pass** |
| **Tests** | New ticket ordered-race; existing `transitions.matrix`, idempotency concurrency |
| **Regression risk** | Medium — lock timing may change conflict codes; keep asserts on status outcomes |
| **Effort** | S (0.5–1d) |
| **Outcome** | Removes highest remaining domain correctness risk |

### P0-T02 — Restrict public `/api/metrics` — **DONE**

| Field | Value |
| --- | --- |
| **Related** | SEC-001 |
| **Status** | **DONE** (2026-10-25) |
| **Components** | `web/Caddyfile`; optionally `compose.prod.yml` / Prometheus scrape path; optionally API bind |
| **Steps** | 1) Exclude `/api/metrics` from public reverse_proxy **or** require auth. 2) Point Prometheus at internal API:4000/metrics (already on backend network). 3) Document scrape path. |
| **Acceptance** | Public HTTPS `/api/metrics` not world-readable; Prometheus still scrapes |
| **Evidence** | `web/Caddyfile` `@apiMetrics` → 404; `infra/monitoring/prometheus.yml` documents internal `api:4000` scrape |
| **Tests** | Config review (live edge curl not run this session) |
| **Effort** | XS–S |

### P0-T03 — Close gap-tracker unfinished rows — **DONE**

| Field | Value |
| --- | --- |
| **Related** | P0-10, P1-110, P1-117 |
| **Status** | **DONE** (2026-10-25) |
| **Evidence** | `remaining-gaps-progress.md` VERIFIED; web P0-10 units; API sync.http P0-10; E2E remaining-ui + remaining-workflows **20/20** |
| **Effort** | S (execution + doc) |

---

## P1 — Reliability & correctness

### P1-T01 — Cleaning assignee bypass policy — **DONE**

| Field | Value |
| --- | --- |
| **Related** | SEC-002 |
| **Status** | **DONE** (2026-10-25) — aligned with tickets via `canBypassCleaningAssignee` |
| **Evidence** | HTTP + sync tests green; manager/admin start/complete grants seeded |
| **Effort** | S–M |

### P1-T02 — Harden web/Caddy container — **DONE**

| Field | Value |
| --- | --- |
| **Related** | SEC-005 |
| **Status** | **DONE** (2026-10-25) |
| **Evidence** | `web/Dockerfile` USER caddy; `compose.prod.yml` cap_drop/NET_BIND_SERVICE/healthcheck; Caddyfile SPA headers; B0 `@apiMetrics` preserved |
| **Effort** | S–M |

### P1-T03 — Notifications panel catalog alignment — **DONE**

| Field | Value |
| --- | --- |
| **Related** | FEAT-001 |
| **Status** | **DONE** (2026-10-25) — **Option A** |
| **Evidence** | `notifications` in `ALL_PANELS` + defaults + catalog seed; client force-inject removed; capabilities tests updated |
| **Effort** | S |

### P1-T04 — Isolation DB documentation for local ticket suites — **DONE**

| Field | Value |
| --- | --- |
| **Related** | Test env gap (`:55439`) |
| **Status** | **DONE** (2026-10-25) |
| **Evidence** | `docs/testing/P1_ISOLATION_DB.md` + scenarios README pointer |
| **Effort** | XS |

---

## P2 — Production hardening — **DONE** (2026-10-25)

| ID | Title | Related | Status |
| --- | --- | --- | --- |
| P2-T01 | Install backup systemd timer + measured restore drill | BAK-01, RISK-03 | **DONE** — install docs + local disposable drill (restore ~2s); S3 prod-sized drill residual |
| P2-T02 | Real Alertmanager webhook + external uptime/dead-man | OPS-006, MON-02 | **DONE** — checklist/docs; webhook still operator-provisioned |
| P2-T03 | Deploy: GHCR existence check; digest pin; discourage host `build:` | OPS-001, DEP-01 | **DONE** — GHCR imagetools gate + `--no-build` path; SHA-tag ≠ digest pin (documented) |
| P2-T04 | README TicketStatus + refresh/archive `status-2026-10-21.md` | DOC-001, OPS-DOC-001 | **DONE** |
| P2-T05 | Staging smoke checklist automation beyond `/health/ready` | DEP-05 | **DONE** — `post-deploy-smoke.sh` + deploy workflow metrics check |
| P2-T06 | OSV/dependency gate on push-to-main or required status | CI OSV gap | **DONE** — `osv-main` job on push to main |

---

## P3 — Maintainability & scalability — **B3 DONE** (2026-10-26); P3-T06 deferred

| ID | Title | Notes | Status |
| --- | --- | --- | --- |
| P3-T01 | Unexport/deprecate legacy role helpers | SEC-003 | **DONE** |
| P3-T02 | Pin JWT algorithms | SUS-002 | **DONE** |
| P3-T03 | Notifications inbox cursor pagination UI | load-more via `nextCursor` | **DONE** |
| P3-T04 | Rooms list pagination/cursor | default cap 500 / max 2000; cursor residual | **PARTIAL (cap)** |
| P3-T05 | Lint gate (oxlint) in CI | `npm run lint` api+web | **DONE** |
| P3-T06 | Shared rate-limit / SSE / job lease **only when** multi-replica required | Out of B3 scope | **DEFERRED** |

---

## P4 — Product enhancements — **B4 PARTIAL** (2026-10-26)

| ID | Title | Status |
| --- | --- | --- |
| P4-T01 | Offline sync: ticket assign/close/reopen | **DONE** (FEAT-002) |
| P4-T02 | Email/push notification adapters | **DEFERRED** (no in-repo provider path this session) |
| P4-T03 | Ticket attachments | **DEFERRED** |
| P4-T04 | Live PMS / Clock adapters | **DEFERRED** |
| P4-T05 | Card encoder adapter | **DEFERRED** |
| P4-T06 | QR confirm start/complete | **DEFERRED** |
| P4-T07 | Role `hk_lead` | **DEFERRED** |

---

## Batch B0 — Critical stabilization — **DONE** (2026-10-25)

**Status:** **DONE**. See prior B0 evidence (BUG-001 / SEC-001).

---

## Batch B1 — Reliability & correctness — **DONE** (2026-10-25)

**Status:** **DONE**. See B1 evidence.

---

## Batch B2 — Production hardening — **DONE** (2026-10-25)

**Status:** **DONE** in working tree (uncommitted vs `737cf36`).

1. ~~P2-T01 backup timer + measured restore drill~~ **DONE** (local disposable; see `backup-restore-drill-2026-10-25.md`)  
2. ~~P2-T02 alert webhook + uptime guidance~~ **DONE**  
3. ~~P2-T03 deploy/GHCR gates~~ **DONE**  
4. ~~P2-T04 docs sync~~ **DONE**  
5. ~~P2-T05 post-deploy smoke~~ **DONE**  
6. ~~P2-T06 OSV on main~~ **DONE**  

### Residual (honest)

- B0–B2 still **not** unsupervised production-ready: operator must install timer, wire real webhook + external uptime, provision secrets/TLS/GHCR, re-measure restore on production-sized S3 dump.  
- Digest pinning not implemented (SHA-tag contract documented).  
- Remote GHCR/Actions green for this HEAD: **NOT VERIFIED** in this session.

---

## Batch B3 — Maintainability — **DONE** (2026-10-26)

**Status:** **DONE** (P3-T01…T05; P3-T04 cap-only; P3-T06 deferred).

1. ~~P3-T01 unexport legacy role helpers~~ **DONE** (SEC-003)  
2. ~~P3-T02 pin JWT HS256~~ **DONE** (SUS-002)  
3. ~~P3-T03 notifications cursor UI~~ **DONE**  
4. ~~P3-T04 rooms list cap~~ **PARTIAL** — default 500 / max 2000 + `X-Result-Truncated`; full cursor still residual  
5. ~~P3-T05 oxlint CI gate~~ **DONE**  
6. P3-T06 multi-replica — **DEFERRED**

### Residual

- Rooms/common-areas **cursor** pagination still open above the interim cap.  
- P3-T06 still out of scope.  
- Still **not** unsupervised production-ready (B2 operator residuals remain).

---

## Batch B4 — Product enhancements — **PARTIAL** (2026-10-26)

**Status:** **PARTIAL** — P4-T01 DONE; P4-T02…T07 deferred. No automatic B5.

1. ~~P4-T01 offline ticket assign/close/reopen~~ **DONE** (FEAT-002)  
2. P4-T02 email/push — **DEFERRED**  
3. P4-T03 attachments — **DEFERRED**  
4. P4-T04 PMS/Clock — **DEFERRED**  
5. P4-T05 card encoder — **DEFERRED**  
6. P4-T06 QR confirm — **DEFERRED**  
7. P4-T07 `hk_lead` — **DEFERRED**

### B4 evidence (2026-10-26)

| Area | Notes |
| --- | --- |
| Sync API | `ticket.assign` / `ticket.close` / `ticket.reopen` in `applyCommand` + handlers; domain `commandId` idempotency |
| Web outbox | `assignTicketQueued` / `closeTicketQueued` / `reopenTicketQueued`; Repairs + Control wired |
| Web tests (ran) | `ticketParityCommands.test.ts` **3/3**; drain enrichment for assign/close/reopen; lint+tsc **exit 0** |
| API unit/lint (ran) | `tsc --noEmit` + `npm run lint` **exit 0** |
| DB smoke (NOT RUN) | Postgres/Docker still unavailable; new `sync.ticket.assign-close-reopen.http.test.ts` + B0/B1 sync suites pending |

### Residual / next recommendation

- Operator **B2 checklist** (S3-sized restore, live webhook, uptime, secrets/TLS/GHCR).  
- Deferred product: P4-T02…T07 as prioritized.  
- Re-run isolation DB smoke when Postgres is up.  
- **No B5** unless scoped; roadmap P4 remainder is enough backlog.

---

## Suggested calendar (indicative)

| Week | Focus |
| --- | --- |
| 1 | ~~B0~~ / ~~B1~~ / ~~B2~~ complete |
| 2 | ~~B3~~ / ~~B4 (P4-T01)~~ |
| 3+ | Operator B2 residuals + deferred P4 as prioritized |
