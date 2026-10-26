# Meridian Maintenance — Functionality & Missing Features

**Audit date:** 2026-10-25  
**Baseline:** `737cf36`  
**Sources of truth:** README capability matrix + roadmap; root `референция` (domain reconstruction, 2026-10-01); implemented routes/services/UI.  
**Cross-refs:** [Master](./MAINTENANCE_MASTER_AUDIT.md) · [Bugs](./MAINTENANCE_BUG_REPORT.md) · [Roadmap](./MAINTENANCE_DEVELOPMENT_ROADMAP.md)

**Classification:** COMPLETE · PARTIAL · BROKEN · MISSING · NOT VERIFIED · OPTIONAL ENHANCEMENT

---

## 1. Core workflows

| Workflow | Status | Notes |
| --- | --- | --- |
| Auth login / logout / refresh / `/auth/me` capabilities | **COMPLETE** | Cookie JWT + CSRF; RoleGrant panels/actions |
| Rooms / common areas list + readiness | **COMPLETE** | Derived readiness; list **capped** (SUS-001 mitigated B3); cursor pagination residual |
| Cleaning create → assign → start → complete → inspect | **COMPLETE** | Lock-order fix for start/reassign in place |
| Cleaning reassign / overdue review | **COMPLETE** | Jobs + Live board |
| Ticket report → assign → start → wait → resume → resolve → close → reopen | **COMPLETE (API)** / **COMPLETE (offline assign/close/reopen B4)** | Full API SM; offline sync + outbox for assign/close/reopen (FEAT-002); reopen UX mainly Control |
| Attendance ingest / intervals / adjustments / export | **COMPLETE** | Simulated terminal API |
| Daily plan manual + JSON import + departure effects | **COMPLETE (skeleton)** | Live PMS = OPTIONAL MISSING |
| Sectors / membership / shifts / roster | **COMPLETE** | P1-61 membership race previously fixed |
| Access cards issue/revoke (DB+UI) | **COMPLETE** | Hardware encoder = OPTIONAL MISSING |
| QR location identify | **COMPLETE** | Confirm start/complete = OPTIONAL MISSING |
| Notifications inbox (list/read/dismiss) | **PARTIAL** | Works; RoleGrant panel (B1); UI cursor load-more (B3); no email/push |
| Offline outbox → `/sync/push` | **PARTIAL** | Cleaning + ticket mid-lifecycle; identity mid-drain covered by tests |
| Live SSE scoped delivery | **COMPLETE** | P1-115 hardened |
| Permissions RoleGrant matrix UI | **COMPLETE** | Owner bypass |
| Analytics / housekeeping results | **COMPLETE** | Naive forecast documented |
| Invitations / device activation | **COMPLETE** | Used in E2E P1-110 paths |
| Background jobs (SLA, overdue, inactive lock, attendance stale) | **COMPLETE** | In-process; 1-replica constraint |
| Audit event log | **COMPLETE** | `/audit` |
| Admin settings / module toggles | **COMPLETE** | |

---

## 2. README roadmap items (explicitly “not implemented”)

| Item | Classification | Required for current product go-live? |
| --- | --- | --- |
| Physical card encoder adapter | **OPTIONAL ENHANCEMENT / MISSING** | No — DB grants suffice for software MVP |
| New roles (e.g. `hk_lead`) | **OPTIONAL ENHANCEMENT / MISSING** | No — RoleGrant can approximate |
| UI buttons entirely from `actions[]` (no legacy role fallback) | **PARTIAL** | Soft — most gates already `canPerformAction`; fallback remains |
| QR scan → confirm start/complete | **OPTIONAL ENHANCEMENT / MISSING** | No — identify-only by design today |
| Live PMS / Clock import adapters | **OPTIONAL ENHANCEMENT / MISSING** | No — JSON import exists |

---

## 3. Spec (`референция`) proposals vs shipped

| Proposal | Status | Notes |
| --- | --- | --- |
| Ticket photo / attachments | **MISSING** | No attachment model/routes; treat as OPTIONAL unless product mandates |
| Imperial UI reconstruction fidelity | **NOT VERIFIED** | Spec is screenshot-driven; not a compliance audit against every mock |
| Full offline parity for all ticket ops | **COMPLETE (ticket lifecycle)** | FEAT-002 remediated B4; attachments/email still open |

Do **not** treat every `референция` wish as a production blocker without product confirmation.

---

## 4. Incomplete but shipped surfaces

| Area | Gap | Severity for ops |
| --- | --- | --- |
| Offline tickets | No assign/close/reopen sync commands | Medium for offline-first hotels |
| Notifications panel | Not in `ALL_PANELS`; FE always injects | Medium governance |
| Notifications delivery | Email/push stubs; settings flags present | Low until channels required |
| Notifications inbox UI | Loads `limit: 50`, ignores API cursor | Low |
| Cleaning bypass | Owner-only vs ticket supervisor bypass | Low–Medium consistency |
| Repairs reopen UX | Control-only strip | Low |
| Docs TicketStatus | Omits assigned/waiting | Medium docs |

---

## 5. Intentionally out of scope (not defects)

- Redis / multi-replica shared SSE / shared rate-limit store — gated at `replicas: 1`.
- Kubernetes — Compose deploy is the documented path.
- Real hardware attendance terminals — simulated ingest only.
- Payment / SMS / OAuth IdP — not in stack.

---

## 6. Gap-tracker unfinished scenarios (process, not missing features)

| ID | Tests present? | Tracker state |
| --- | --- | --- |
| P0-10 mid-drain identity | Yes (API + web unit + E2E) | **VERIFIED / DONE (B1)** |
| P1-110 offline cleaning start+complete | Yes (E2E remaining-workflows) | **VERIFIED / DONE (B1)** |
| P1-117 live domain refresh + busy deferral | Yes (E2E remaining-ui / live) | **VERIFIED / DONE (B1)** |

**Action:** tracker closed with recorded green runs (2026-10-25 B1).

---

## 7. Recommended product priority (if enhancing after P0/P1)

1. ~~Decide notifications panel policy~~ — **Option A done (B1)**.  
2. ~~Decide offline ticket assign/close scope (FEAT-002)~~ — **done (B4 / P4-T01)**.  
3. ~~Align cleaning bypass with ticket policy~~ — **done (B1 / SEC-002)**.  
4. Only then: PMS adapter, encoder, QR confirm, attachments — as separate product epics.
