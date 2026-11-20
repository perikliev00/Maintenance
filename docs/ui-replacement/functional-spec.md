# Maintenance functional specification

Extracted on 2026-11-20 from contracts, API clients, Prisma enums, services and page event handlers. This document describes capabilities and invariants, not screen compositions. No existing screenshot, branding asset or stylesheet was used as a design reference. Source baseline: branch `feat/independent-maintenance-experience`, created from the existing checkout; pre-existing uncommitted work is retained.

## Contract boundaries

The replacement is a frontend change. Preserve REST endpoint paths, HTTP methods, request/response shapes, cookie/CSRF authentication, PostgreSQL schema, Prisma schema and migrations, production integrations, calculations, scheduled jobs, data scopes and server authorization. Never infer a mutation succeeded solely from a UI state change. Keep command IDs, expected versions, conflict recovery, stale-response guards, list cursor semantics and mutation busy guards.

The authoritative capability catalog is `api/src/contracts/permissionsCatalog.ts`: 18 panel identifiers and 41 action identifiers. `web/src/api/capabilities.ts` applies server grants and module switches. Explicit server `panels` and `actions` arrays, including empty arrays, are authoritative. Owner action bypass and server scope restrictions remain unchanged. A feature's visibility does not grant mutation permission. Role defaults are fallbacks, not a replacement for server grants.

## Roles and default entry points

| Role | Default landing | Default scope of capabilities |
| --- | --- | --- |
| Housekeeper | My work | Assigned cleaning, room/common-area visibility, notifications |
| Technician | My work | Assigned repairs, repair board, location visibility, notifications |
| Reception | Rooms | Occupancy, plan, cards and issue reporting according to actions |
| Supervisor | Rooms | Scoped operational oversight, inspections, staff, live work, plan, attendance, cards, results, analytics, housekeeping and repairs |
| Manager | Control | Operational and administrative panels, settings, permissions, audit and jobs according to grants |
| Admin | Team | Broad administration; live/control are not granted by default |
| Owner | Control | All catalog panels/actions; privileged target management |

Default panel sets live in the shared catalog. Preserve server `landing` overrides. Non-owners cannot assign owner/admin roles or manage privileged targets even when they have a general people capability. Supervisors may edit their allowed sectors but must not create hotel-wide sectors. Preserve panel revocation, live role changes, session kickout and module-disable behavior.

## Capability inventory by panel

| Panel contract | Required capabilities and interactions |
| --- | --- |
| `home` | Read current location/ticket information; report an issue using a catalog option or custom title/category; description, priority and room-blocking flag; show issue defaults, unusual-priority and readiness warnings; handle active/probable duplicates, reasoned override and reopen suggestion; permitted ticket lifecycle actions and refresh |
| `mywork` | Date/shift scoped personal cleaning and ticket queues; roster shift awareness; active-session context; task start/complete and notes; ticket lifecycle actions; ticket pagination; connection state; per-user offline cache, pending-sync markers and outbox recovery |
| `rooms` | Room inventory, location identity/building/floor/sector filters, status and text filters, pagination, room details, occupancy and service status, mark dirty, create/start/complete/reassign/inspect cleaning, overdue session review/cancel, maintenance reporting/list/lifecycle/history; scoped capabilities and readiness blockers |
| `common` | Same legitimate location operations as applicable to common areas, maintaining kind-specific rules and labels; no invented guest-room semantics |
| `repairs` | Cursor-based ticket list; status (open/all/resolved and lifecycle states), assignee/mine, SLA breach and blocking filters; report, inspect details and event history; assign/start/wait/resume/resolve/close/reopen; duplicate handling, notes/reasons, queue sync and deep-link focus |
| `live` | Live operation snapshot, active and recent sessions, elapsed time, overdue/anomaly flags, inspection/past-due/blocking attention queues with independent pagination, audit feed, freshness/error state; navigate to exact location/task/session or ticket without losing target identity |
| `plan` | Hotel-date plan; departure/arrival/priority categories; manual entries with notes, housekeeper and shift; delete; structured import and batch result; explicit departure-effects application and occupied-room confirmation; preserve linked task/occupancy side effects and hotel timezone |
| `cleaning` | Location catalog create/edit/archive/restore; sector metadata, supervisor, location membership and housekeepers; active/inactive records; scoped sector rules and atomic versioned saves; shift definitions and dated roster assignments with stale-load guards |
| `team` | Server-side debounced directory search; role, inactive, archived and not-onboarded filters; cursor pagination; employee detail; block/unblock/archive/restore using status/accessVersion; devices and revoke; invitations for existing/new employees, employee number, name, email, role/department; one-time code and expiry; invite history/revoke; protected-role rules |
| `attendance` | Today/week/month/review scopes; month, department and employee search; cursor pagination, interval start/end/break/worked totals and anomaly/review state; clock-skew warning; CSV with truncation warning; reasoned correction request with proposed end/break and pending correction approve/reject according to independent actions |
| `cards` | Guest/housekeeper/maintenance/manager/master card types; contextual employee/location assignment, valid-from/until and optional label; issue with stable command ID; staff card search and status/type filters; grant details and revoke; system access record capability must not be presented as hardware encoding |
| `results` | Date presets/range and cleaning service-type filters; paginated employee results; completed sessions/tasks, accepted tasks, rework, anomalous sessions, distinct rooms, on-time %, valid/excluded minutes and productivity; service-type summary and hourly completion series; preserve null/unknown semantics |
| `analytics` | Maintenance/housekeeping domains, date presets/range; KPI values and period comparisons, time series, category distributions, risk/forecast explanations and risk CSV; category labels and unknown values; refresh/error handling without stale data misrepresentation |
| `control` | Operational cleaning tasks and overdue running sessions, ticket supervision and assignment/lifecycle, staff role changes; independently authorized sections and actions; allowed assignee/role lists, reasoned decisions, scoped data and mutation refresh |
| `audit` | Event filters, date/entity/actor/context information, structured detail/history; live refresh; job run history and permitted manual jobs; read/fetch failures distinguished from empty data |
| `settings` | Versioned settings drafts for modules, flags, interface, operations, access, notification channels; explicit save/reason, undo/reset/reload and conflict handling; SLA policy editor; maintenance categories/issue options create/edit/archive/reorder and defaults; settings history and system/API/database status; unsaved drafts preserved across refresh |
| `permissions` | Full role-to-panel and role-to-action matrix, read-only owner reference, server-editable role restrictions, per-role draft/base version, reason on save, dirty/conflict feedback, accept remote version, self-permission refresh; history loading/error/empty states; preserve coupled permissions panel/action rules |
| `notifications` | Unread/all inbox, cursor pagination, unread count, mark one/all read, dismiss, refresh/live updates and authorized target navigation |

## Domain states and rules

Locations have independent dimensions: occupancy `vacant / occupied / unknown`, cleanliness `dirty / in_progress / pending_inspection / verified_clean`, service `in_service / out_of_service / unknown`, catalog `active / archived`. Readiness is composed from these dimensions and blocking tickets. Never collapse them into an editable single status. Archived locations remain available in historical records; they are not hard-deleted.

Cleaning tasks use `assigned / in_progress / awaiting_inspection / rework / completed / cancelled`; sessions use `running / completed / cancelled`. Service types are `stayover / departure / arrival / common_area`; rework is orthogonal to service type. Start/complete transitions use idempotent commands and task versions. Retain one-running-session/task and configured employee-concurrency rules, assignee and scope checks. Completion follows the inspection policy. Approval/rejection is a supervisor decision; rejection requires findings. Reassignment requires a reason and expected version; availability lists expose available/busy/on-break/off-shift/absent/unknown reasons, current shift/running task and task count. Preserve explicit force-despite-availability behavior and permissions. Cancelling a running session does not assert that its location is clean.

Tickets use `new / assigned / in_progress / waiting / resolved / closed`. Preserve each allowed lifecycle edge, assignee restrictions and privileged bypass, wait/resolution/reopen reasons/notes, event history, paused SLA timing, deadlines and breach flags. A room-blocking issue affects readiness until the backend releases that blocker. Reporting supports option defaults or custom issue metadata. Duplicate-active and probable-duplicate responses require their distinct confirmation/override flows. Idempotency replay must retain the same operation fingerprint.

Attendance intervals use `open / closed / needs_review / adjusted`; correction requests use `pending / approved / rejected`. Corrections remain proposals until reviewed. Preserve server validation and resulting interval rebuild behavior, anomaly flags, timezone interpretation and CSV headers/caps.

Cards use active/revoked state and validity-bound access grants. Keep contextual requirements, valid date ordering, role/type restrictions and command deduplication. Invitations use issued/consumed/expired/revoked; activation redeems the code, registers device context and establishes the normal authenticated session.

## Settings scope

Public interface settings include light/dark default, Bulgarian/English locale and comfortable/compact density. Operational settings include overdue minutes, task due hours, ticket SLA hours, risk threshold/window and hotel timezone, plus the full administrative operational draft/SLA policies. Flags include inspection requirement, session concurrency, reception reassignment and overdue banner. Access settings include invitation TTL, idle-days information and inactive-user policy. Notification settings include in-app/email channels; device push stays disabled where no adapter exists. Preserve server validation ranges and sensitive settings access. Settings history records before/after, reason, actor and timestamp.

## Cross-cutting behavior

- Bootstrap waits for authentication before rendering a private panel; handle transient refresh separately from rejected credentials. Support login, invite activation, logout and logout-all with local private-data purge and honest global-revocation error feedback.
- Keep cookie credentials, CSRF headers, authenticated retry and session revocation. Never place secrets in UI or test reports.
- Keep per-user IndexedDB queues and My Work caches, insertion ordering, idempotency keys, reconnect draining, orphan recovery, conflict/failed states, retry/discard/reconcile controls and account-switch protections.
- Live updates and polling must reconcile permission/module changes while preserving dirty drafts and preventing stale responses or double submissions from replacing newer state.
- Preserve Bulgarian/English support where currently supplied. Do not replace business terms/identifiers with incompatible enum values.
- Maintain loading, empty, error, stale, queued, conflict and success states; focus management, keyboard access, labelled controls, status announcements and responsive access to every action.

## Verification boundary and regression entry points

This inventory is a source-derived preservation checklist; it is not proof that all flows work in a browser. Validate each panel, role and transition against isolated data and record actual coverage.

At extraction time: Node v24.22.1, Docker engine 29.9.2, and existing API/web/E2E dependencies are available. `npm run ci:local -- --skip-install` is the repository's comprehensive local CI command. It serializes mutation using a lock and uses disposable `maintenance_ci_local`, `maintenance_p1_test`, and audit-upgrade test databases. It generates Prisma Client before migrations/seeds, runs API/web build and tests, smoke/invariant tests, main and scenario Playwright suites and optional container checks. It seeds isolated test databases; it must not be run concurrently with another mutating test suite.

For targeted work use `npm run build --prefix web`, `npm run test --prefix web`, `npm run typecheck:tests --prefix web`, and the existing isolated API test runner. Main/scenario Playwright must use the P1 loader and dedicated loopback origins. Do not reuse a running ambient server: set `CI=1` for main E2E or otherwise enforce fresh isolated servers. Never run API seeding, migrate, db push or E2E against ambient `api/.env` or production data. Do not deploy.

Location board pagination is drained by the existing API client into the complete client-filtered scope. The replacement does not introduce user-facing pagination or truncate that scope.
