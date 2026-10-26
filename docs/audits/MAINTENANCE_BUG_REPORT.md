# Meridian Maintenance — Bug Report

**Audit date:** 2026-10-25  
**Baseline:** `737cf36`  
**Cross-refs:** [Master](./MAINTENANCE_MASTER_AUDIT.md) · [Security/DevOps](./MAINTENANCE_SECURITY_DEVOPS_AUDIT.md) · [Roadmap](./MAINTENANCE_DEVELOPMENT_ROADMAP.md)

**Legend:** CONFIRMED = code evidence sufficient to treat as defect; SUSPECTED = plausible risk, not runtime-proven; PRIOR = from earlier audits with current status.

---

## Summary counts

| Class | CRITICAL | HIGH | MEDIUM | LOW | Info |
| --- | ---: | ---: | ---: | ---: | ---: |
| Confirmed bugs / security defects (open) | 0 | 0 | 0 | 1 (UI-001) | 0 (FEAT-002 remediated B4) |
| Remediated B0 | — | 2 (BUG-001, SEC-001) | — | — | — |
| Remediated B1 | — | — | FEAT-001, SEC-002 (+ SEC-005) | — | — |
| Remediated B2 | — | — | DOC-001 | OPS-DOC-001 | — |
| Suspected | 0 | 0 | 2 | 3 | 0 |
| Prior remediations re-verified OK | — | — | — | — | AUDIT-001/002/003, P1-115 |

---

## Confirmed findings

### BUG-001 — Ticket assign × start opposite lock order (deadlock risk)

| Field | Value |
| --- | --- |
| **Severity** | HIGH |
| **Status** | **REMEDIATED** (2026-10-25, Batch B0 / P0-T01) |
| **Files (original)** | `api/src/services/maintenance/assign.ts:29–42`; `api/src/services/maintenance/progress.ts:54–82`; `api/src/services/assignees.ts:79–82`, `121–131`; `api/src/services/liveAccessLocks.ts:22–37` |
| **Description** | `assignMaintenanceTicket` takes User `FOR UPDATE` (via `lockEmployeesForLiveAccess`) **then** ticket lock. `startMaintenanceTicket` takes ticket lock via `loadLockedTicket` **then** User `FOR SHARE` via `assertActiveWorkStarter`. Concurrent assign/reassign + start on the same ticket can deadlock (PostgreSQL `40P01` / Prisma `P2010` → client 500). |
| **Reproduction (expected)** | Two concurrent HTTP calls: supervisor `POST .../assign` while assignee `POST .../start` on the same `assigned`/`new` ticket under load; or ordered barrier race mirroring `T-CLN-29`. |
| **Evidence** | Cleaning path was fixed User→Task (`sessions.ts:76–81`) specifically for this class (**AUDIT-001**). Ticket start was not reordered. No ticket assign×start `orderedDatabaseRace` test found (cleaning has `T-CLN-29` in `lifecycle.concurrency.test.ts` / `reassign.http.test.ts`). |
| **Root cause** | Incomplete propagation of deadlock-safe lock ordering from cleaning remediation to maintenance start. |
| **Impact** | Intermittent failed dispatch/start under concurrent ops; possible transaction timeouts; operator distrust during peak housekeeping. |
| **Recommended fix** | In `startMaintenanceTicket` (and wait/resume/resolve if they lock Ticket before User): preview assignee → lock User(s) → lock Ticket → proceed. Keep comments documenting order. |
| **Regression tests** | Deterministic ordered race: start-first and assign-first; assert never 500; loser gets 409 conflict / invalid_state. |
| **Effort** | S (0.5–1 day) |
| **Dependencies** | None |

**Remediation (2026-10-25):**

| Field | Value |
| --- | --- |
| **Date** | 2026-10-25 |
| **HEAD / tree** | uncommitted working tree (baseline `737cf36` + B0 changes) |
| **Files changed** | `api/src/services/maintenance/progress.ts` (User→Ticket on start); comments on wait/resume + `resolveClose.ts`; `assign.ts` cross-ref comment; `api/tests/tickets/assign.start.concurrency.test.ts` (R-TKT-02) |
| **Fix** | `startMaintenanceTicket` previews assignee → `lockEmployeesForLiveAccess` → `assertActiveWorkStarter` → `loadLockedTicket` → checks/claim. wait/resume/resolve reviewed: no User locks (assign already disallowed mid-lifecycle). |
| **Tests run** | `assign.start.concurrency.test.ts` **2/2 pass**; `idempotency.concurrency.test.ts` + `transitions.matrix.test.ts` **11/11 pass**; `sync.assignee.http.test.ts` **3/3 pass**; `jobs.run.http.test.ts` **2/2 pass**. DB via `P1_TEST_DATABASE_URL` → `127.0.0.1:5433/maintenance_p1_test` (`.env.p1_test` `:55439` unreachable). Full `test:tickets-lifecycle` **not claimed** as a single suite run. |
| **Residual risk** | More legitimate 409 under contention (acceptable). HTTP-layer assign×start race not separately run (service-layer ordered race covers lock order). |

---

### SEC-001 — Unauthenticated public Prometheus metrics via `/api/metrics`

| Field | Value |
| --- | --- |
| **Severity** | HIGH (info disclosure / recon) |
| **Status** | **REMEDIATED** (2026-10-25, Batch B0 / P0-T02) |
| **Files (original)** | `api/src/app.ts:124–126`; `api/src/middleware/security.ts:79` (metrics skipped from rate limit); `web/Caddyfile:3–9`; `api/src/observability.ts` |
| **Description** | `GET /metrics` has no auth. Prod Caddy strips `/api` and reverse-proxies all `/api/*` to the API, so `https://<APP_DOMAIN>/api/metrics` is world-reachable. |
| **Impact** | Exposes HTTP route traffic, status codes, sync/SSE/job gauges, process memory — useful for attackers mapping load and failure modes. Not credential leakage. |
| **Recommended fix** | Prefer Caddy match that blocks `/api/metrics` from public; scrape API on internal network (or localhost sidecars). Alternative: basic auth / mTLS / IP allowlist for metrics only. |
| **Regression tests** | Compose/Caddy config test or smoke asserting public `/api/metrics` → 404/401 while internal scrape still works. |
| **Effort** | XS–S |
| **Dependencies** | None |

**Remediation (2026-10-25):**

| Field | Value |
| --- | --- |
| **Date** | 2026-10-25 |
| **HEAD / tree** | uncommitted working tree (baseline `737cf36` + B0 changes) |
| **Files changed** | `web/Caddyfile` (`@apiMetrics` → `respond 404` before `/api/*` proxy); `infra/monitoring/prometheus.yml` scrape comment |
| **Fix** | Public edge no longer reverse-proxies `/api/metrics`. Prometheus continues to scrape `api:4000/metrics` on the backend network. API `/metrics` itself remains unauthenticated on the internal listener (by design for in-network scrape). |
| **Tests run** | Config review of Caddyfile matcher order. Live Caddy/public curl **not** executed in this session (no compose edge brought up). |
| **Residual risk** | Direct exposure of API port outside the backend network would still serve metrics; rely on Compose network isolation. Redeploy web image required for edge change to take effect. |

---

### DOC-001 — README TicketStatus incomplete

| Field | Value |
| --- | --- |
| **Severity** | MEDIUM (documentation correctness) |
| **Status** | **REMEDIATED** (2026-10-25, Batch B2 / P2-T04) |
| **Files** | `README.md`; `README.en.md`; `api/prisma/schema.prisma` TicketStatus enum |
| **Impact** | Onboarding and ops docs mis-teach the state machine; risk of incorrect client integrations. |
| **Fix** | Document `new \| assigned \| in_progress \| waiting \| resolved \| closed`. |
| **Effort** | XS |
| **Evidence** | Both READMEs now list `assigned` and `waiting`. |

---

### FEAT-001 / BUG-FE-001 — Notifications panel forced client-side; absent from server catalog

| Field | Value |
| --- | --- |
| **Severity** | MEDIUM |
| **Status** | **REMEDIATED** (2026-10-25, Batch B1 / P1-T03, **Option A**) |
| **Files (original)** | `api/src/permissions.ts:11–29` (`ALL_PANELS` has no `notifications`); `web/src/api/capabilities.ts:350–364` (always injects `"notifications"`) |
| **Impact** | Permissions matrix cannot grant/revoke notifications panel; RoleGrant and UI diverge; future “hide inbox” policy impossible without code change. |
| **Fix** | Either add `notifications` to `ALL_PANELS` + seed grants, or document as always-on and stop treating it as a panel capability. |
| **Effort** | S |

**Remediation (2026-10-25) — Option A:**

| Field | Value |
| --- | --- |
| **Date** | 2026-10-25 |
| **HEAD / tree** | uncommitted working tree (baseline `737cf36` + B0/B1) |
| **Policy** | `notifications` is a real RoleGrant panel; defaults grant it to all matrix roles; client no longer force-injects |
| **Files changed** | `api/src/permissions.ts`; `api/src/app.ts` catalog seed `grants.panels.notifications.v1`; `web/src/api/capabilities.ts` + `capabilities.test.ts` |
| **Tests** | `web` `capabilities.test.ts` (incl. empty panels / explicit grant) within `npm test` **117/117 pass** |
| **Residual** | Existing DBs need API boot to apply catalog seed once; admins can now revoke inbox via Permissions UI |

---

### FEAT-002 — Offline sync lacks ticket assign / close / reopen

| Field | Value |
| --- | --- |
| **Severity** | MEDIUM (functional gap, not crash bug) |
| **Status** | **REMEDIATED** (2026-10-26, Batch B4 / P4-T01) |
| **Files (original)** | `api/src/services/sync/applyCommand.ts` (command switch); online routes in `api/src/routes/maintenance/tickets.ts` |
| **Impact** | Dispatchers/supervisors offline cannot assign/close/reopen; mid-lifecycle only. |
| **Fix** | Product decision: extend sync schema + handlers with same auth/idempotency as HTTP, or keep online-only and document. |
| **Effort** | M if implementing |

**Remediation (2026-10-26):**
| Field | Value |
| --- | --- |
| **Policy** | Sync `ticket.assign` / `ticket.close` / `ticket.reopen` reuse domain services; grants match HTTP (`tickets.assign` / `tickets.close` / `tickets.resolve`) |
| **Files changed** | `api/src/services/sync/commands/tickets.ts`, `applyCommand.ts`, `assign.ts`, `resolveClose.ts`, HTTP ticket controllers; web `offline/*`, Repairs/Control pages |
| **Tests** | Web builders + drain enrichment **pass**; API `sync.ticket.assign-close-reopen.http.test.ts` authored — **DB smoke NOT RUN** (Postgres unavailable this session) |
| **Residual** | Re-run isolation sync suites when `:5433/maintenance_p1_test` is up |

---

### SEC-002 — Cleaning assignee bypass narrower than tickets

| Field | Value |
| --- | --- |
| **Severity** | LOW–MEDIUM (consistency / ops UX; not confirmed privilege escalation) |
| **Status** | **REMEDIATED** (2026-10-25, Batch B1 / P1-T01) |
| **Files (original)** | Cleaning HTTP: `controllers/cleaning/tasks.ts`, `sessions.ts` (`isOwner` bypass); tickets: `services/maintenance/authorization.ts` `canBypassTicketAssignee`; sync cleaning omits bypass |
| **Impact** | Supervisors can progress others’ tickets but not others’ cleaning (except owner online). Offline owner also loses cleaning bypass. |
| **Fix** | Domain policy decision + shared helper applied to HTTP and sync. |
| **Effort** | S–M |

**Remediation (2026-10-25):**

| Field | Value |
| --- | --- |
| **Date** | 2026-10-25 |
| **HEAD / tree** | uncommitted working tree (baseline `737cf36` + B0/B1) |
| **Policy** | Align cleaning with tickets: `canBypassCleaningAssignee` uses the same role set as `canBypassTicketAssignee`. Applied on HTTP start/complete **and** sync cleaning.start/complete. Manager/admin also receive default `cleaning.start`/`cleaning.complete` grants so bypass is reachable. |
| **Files changed** | `api/src/services/cleaning/authorization.ts`; controllers `tasks.ts`/`sessions.ts`; `sync/commands/cleaning.ts`; `permissions.ts` + catalog seed `grants.actions.cleaning.start_complete.manager_admin.v1`; tests `complete.http.test.ts`, `sync.cleaning.assignee.http.test.ts` |
| **Tests** | complete.http **1/1**; sync.cleaning.assignee **3/3**; B0 race **2/2**; sync.assignee AUDIT-003 **3/3** (all pass via `:5433` override) |
| **Residual** | Bypass still requires the matching action grant (reception in bypass set without start/complete remains gated by RBAC). Cleaning start still pins assignee to the starter when bypass starts. |

---

### OPS-DOC-001 — Stale ops status document

| Field | Value |
| --- | --- |
| **Severity** | LOW |
| **Status** | **REMEDIATED** (2026-10-25, Batch B2 / P2-T04) |
| **Files** | `docs/operations/status-2026-10-21.md` |
| **Fix** | Marked **HISTORICAL** with pointer to current readiness/ops docs. |

---

### UI-001 — Ticket reopen only on Control panel lifecycle UX

| Field | Value |
| --- | --- |
| **Severity** | LOW |
| **Status** | CONFIRMED partial UX |
| **Files** | `TicketLifecycleActions.tsx` (start/wait/resume/resolve); `ControlPage.tsx` reopen; API `reopenIssue` exists |
| **Impact** | Operators on Repairs may not discover reopen without Control access. |

---

## Suspected findings

| ID | Severity | Summary | How to confirm |
| --- | --- | --- | --- |
| SUS-001 | MEDIUM | Unbounded `GET /rooms` with rich includes — **MITIGATED (B3)** default cap 500 / max 2000 + `X-Result-Truncated`; full cursor pagination residual | Load test with 5k+ locations |
| SUS-002 | MEDIUM | JWT alg pin missing — **REMEDIATED (B3)** `algorithms: ["HS256"]` on access + SSE tickets | Forge attempt + pin algorithms |
| SUS-003 | LOW | CSRF compare uses `!==` not `timingSafeEqual` (`session.ts`) | Threat-model review |
| SUS-004 | LOW | SSE `?ticket=` query may leak via Referer/logs | Proxy log review |
| SUS-005 | LOW | Notifications silent mark-read/dismiss — **IMPROVED (B3)** inbox surfaces errors + cursor load-more | UI error-path test |

---

## Prior audit findings — re-verification

| Prior ID | Was | Now (2026-10-25) | Evidence |
| --- | --- | --- | --- |
| AUDIT-001 | P1 cleaning deadlock | **REMEDIATED** | `sessions.ts` User before Task; reassign User→Task |
| AUDIT-002 | UI ignores `actions[]` | **REMEDIATED** | Pages use `canPerformAction`; helpers only fallback |
| AUDIT-003 | Sync drops ticket bypass | **REMEDIATED** | Sync handlers + `sync.assignee.http.test.ts` **3/3 pass** this session |
| P1-115 SSE races | Open historically | **HARDENED / VERIFIED in prior tracker** | `liveAuthorization.ts` + User FOR SHARE through delivery |
| Gaps 3.1–3.4 | Missing tests | **Tests present**; sync/jobs/env suites **passed** this session | See test execution in Master audit |
| P0-10, P1-110, P1-117 | “Final regression running” | **VERIFIED / DONE (B1)** | See `remaining-gaps-progress.md` |

---

## Findings explicitly not invented

No confirmed: SQL injection in production paths, XSS sinks (`dangerouslySetInnerHTML`), CSRF bypass, hardcoded production secrets, file-upload RCE surface, IDOR on notifications/tickets beyond scope checks, auth bypass via JWT `none` (**REMEDIATED B3** — alg allowlist).

---

## B0 remediation note (2026-10-25)

Batch **B0** closed **BUG-001** and **SEC-001** in the working tree (uncommitted relative to `737cf36`). Evidence: User→Ticket lock order on ticket start + R-TKT-02 ordered-race tests green; Caddy blocks public `/api/metrics` while Prometheus scrapes `api:4000` internally.

## B1 remediation note (2026-10-25)

Batch **B1** closed **P0-T03** (gap tracker P0-10/P1-110/P1-117 VERIFIED), **SEC-002** (cleaning bypass aligned), **SEC-005** (web/Caddy harden), **FEAT-001** (notifications Option A).

## B2 remediation note (2026-10-25)

Batch **B2** closed ops tooling/docs: backup install + **local disposable restore drill** (~2s; see `docs/operations/backup-restore-drill-2026-10-25.md`), alert/uptime go-live checklist, deploy GHCR imagetools + `--no-build`, DOC-001/OPS-DOC-001, post-deploy smoke helper, OSV on push-to-main. **S3/prod-sized restore**, **live webhook wiring**, and **remote GHCR/Actions** for this HEAD remain operator/NOT VERIFIED. Project remains **not** unsupervised production-ready.

## B4 remediation note (2026-10-26)

Batch **B4 PARTIAL**: **FEAT-002 / P4-T01** offline `ticket.assign` / `ticket.close` / `ticket.reopen` (sync + web outbox; HTTP grant parity). **P4-T02…T07 deferred.** DB-backed sync suites **NOT RUN** (Postgres down). Next: operator B2 residuals; no automatic B5. Still **not** unsupervised production-ready.

## B3 remediation note (2026-10-26)

Batch **B3** closed maintainability items:

| Finding / task | Status |
| --- | --- |
| **SEC-003** / P3-T01 | **REMEDIATED** — legacy `canResolve/Assign/CloseIssues` no longer exported; UI path is `canPerformAction` only |
| **SUS-002** / P3-T02 | **REMEDIATED** — access + SSE JWT pin `HS256`; unit rejects `none` / `HS384` |
| Notifications pagination / P3-T03 | **DONE** — inbox cursor load-more; mark-read/dismiss errors surfaced |
| **SUS-001** / P3-T04 | **MITIGATED** — default limit 500, max 2000, `X-Result-Truncated`; **no** full cursor pagination yet |
| Lint / P3-T05 | **DONE** — `oxlint` + `npm run lint` in api/web CI jobs |
| **P3-T06** | **DEFERRED** (multi-replica / Redis / shared SSE / job lease) |

Next batch: **B4**. Project remains **not** unsupervised production-ready.
