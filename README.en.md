# Meridian Maintenance

> Българска версия: [README.md](./README.md)

Hotel operations system for **housekeeping** and **maintenance**: room readiness, cleaning tasks with inspection, repair tickets, team directory, and role control.

This is a live domain model plus a working demo (API + web), built incrementally. Below is the **full domain and everything you can do today**.

---

## Contents

1. [Product goal](#product-goal)
2. [What works today (capability matrix)](#what-works-today-capability-matrix)
3. [Stack and setup](#stack-and-setup)
4. [Domain model](#domain-model)
5. [Room readiness](#room-readiness)
6. [Cleaning](#cleaning)
7. [Maintenance](#maintenance)
8. [People, roles, and permissions](#people-roles-and-permissions)
9. [UI panels and actions](#ui-panels-and-actions)
10. [API](#api)
11. [Seed / demo data](#seed--demo-data)
12. [Technical rules](#technical-rules)
13. [Code layout](#code-layout)
14. [Roadmap](#roadmap)

---

## Product goal

The system answers: **“Can this room be given to a guest?”** and the related operational questions:

- Who is cleaning the room, and at what stage is cleaning?
- Has inspection passed?
- Is there a blocking repair?
- What can each role see and do?

Readiness is **not a single status** — it is composed from several independent dimensions plus blocking tickets.

---

## What works today (capability matrix)

| Capability | Status | Where |
|---|---|---|
| Login / logout (JWT) | ✅ | Login |
| Capabilities (`panels`, `actions`, `landing`) | ✅ | `/auth/me`, login |
| Room list + readiness reasons | ✅ | Rooms |
| Common areas (catalog + cleaning/tickets) | ✅ | Common / `/common-areas` |
| Location catalog (CRUD + archive) | ✅ | Housekeeping → Catalog / `/locations` |
| Occupancy / service status | ✅ | Rooms detail / `/locations/:id/occupancy`, `…/service-status` |
| Mark dirty | ✅ | Rooms, Common / API |
| Create cleaning task + assign HK | ✅ | Rooms, Control |
| Start / Complete cleaning session | ✅ | Rooms |
| Inspect approve / reject (+ findings) | ✅ | Rooms |
| Reassign task | ✅ | Rooms / API |
| Overdue sessions (> 4h running) | ✅ | Rooms (supervisor+), API |
| Live board (S09) | ✅ | Live / `/operations/live` |
| Report maintenance issue (blocking / not) | ✅ | Rooms, Home |
| Issue catalog — categories + options (S10) | ✅ | Settings → Issue options |
| Resolve issue | ✅ | Home, Rooms |
| Home feed — open issues | ✅ | Home |
| Team — people list / filters | ✅ | Team |
| Control — role changes | ✅ | Control |
| Settings (modules, flags, operations, timeline) | ✅ | Settings / `/settings` |
| Permissions — DB-driven role × panel/action matrix | ✅ | Permissions / `/permissions` |
| Owner = superuser (all panels + actions) | ✅ | permissions |
| Dark / light theme | ✅ | whole UI |
| Live updates (SSE) | ✅ | `/events/stream` |
| Daily plan Clock (S12) | ✅ | Plan / `/daily-plan` (+ JSON import; no live PMS) |
| My Work / personal queue | ✅ | My Work / `/my-work` + PWA |
| Dedicated Repairs panel | ✅ | Repairs panel / maintenance lifecycle UI |
| Sectors / shifts (Housekeeping panel) | ✅ | Housekeeping / `/sectors`, `/shifts`; roster `GET/PUT /shifts/roster`; `CleaningTask.shiftId` |
| Task sector + supervisor snapshot | ✅ | `CleaningTask.sectorId` / `sectorSupervisorEmployeeId` |
| Supervisor “my sectors” data scope | ✅ | `dataScope` + Live/Plan/Rooms/Results/Analytics + ticket create, sync push, sectors (own), live audit/SSE |
| Room QR codes | ✅ | QR tab + `#/room-qr/:token` (identify only) |
| Attendance (S13) | ✅ | Attendance / `/attendance` |
| Analytics — housekeeper results | ✅ | Results / `/cleaning/results` |
| Smart analytics (S14, §9) | ✅ | Analytics / `/analytics/summary` |
| Cards (S11) — UI + DB, no hardware encoder | ✅ | Cards / `/cards` |
| Audit log | ✅ | Audit / `/audit`; Settings chronology; Live Board |
| Offline sync | ✅ | IndexedDB outbox + My Work cache (per `userId`; purge/lock on account switch); `/sync/push` + `/sync/pull`; SW precache only (no authenticated `/api` GET cache) |
| Background jobs | ✅ | in-process scheduler (lock / overdue / SLA) |

---

## Stack and setup

| Part | Tech |
|---|---|
| `api/` | Node.js, Express, TypeScript, Prisma, JWT, Zod, bcrypt |
| `web/` | Vite, React, TypeScript, PWA (vite-plugin-pwa) |
| DB | PostgreSQL 16 (Docker), host port **5433** |

```bash
docker compose up -d

cd api
npm install
npx prisma migrate dev
npm run db:seed
npm run dev

cd web
npm install
npm run dev
```

- API: http://localhost:4000 (`/health`)
- Web: http://localhost:5173
- `DATABASE_URL=postgresql://maintenance:maintenance@localhost:5433/maintenance`
- Demo password for all users: **`demo1234`**

---

## Domain model

### Location hierarchy

```
Property (Meridian Resort)
  └── Building (MAIN | ANNEX | ROYAL)
        └── Floor
              └── Location (kind: room | common_area)
```

**Location** is the operational unit. Cleaning tasks and maintenance tickets hang off it.  
`kind` separates guest rooms from common areas; Rooms UI / `/rooms` lists only `room`, Common panel / `/common-areas` lists only `common_area`.

### Location dimensions (independent)

| Field | Enum / meaning |
|---|---|
| `kind` | `room` \| `common_area` |
| `catalogStatus` | `active` \| `archived` — in catalog or not |
| `occupancy` | `vacant` \| `occupied` \| `unknown` (**rooms only** in readiness) |
| `cleaningStatus` | `dirty` → `in_progress` → `pending_inspection` → `verified_clean` |
| `cleaningCycle` | Monotonic generation; only the current cycle may write `cleaningStatus` |
| `serviceStatus` | `in_service` \| `out_of_service` \| `unknown` |

These fields are **not collapsed** into one status. UI and readiness expose them separately.

### People

| Entity | Role |
|---|---|
| `Employee` | Hotel person (number, name, department) — does work, inspections, reports |
| `User` | Login account, 1:1 with Employee; holds `role` and `isActive` |

### Cleaning aggregates

| Entity | Meaning |
|---|---|
| `CleaningTask` | Cleaning job for a `hotelDate`, `serviceType` (`stayover` \| `departure` \| `arrival` \| `common_area`), priority, assignee, `status`, `completedAt` (when completed), `version` |
| `CleaningSession` | Concrete work session (start→complete|cancel), idempotency keys; optional `notes`; `anomalyFlags`; no pause / adjustment |
| `Inspection` | Approve/reject by inspector + `findings` (required on reject) |

**TaskStatus:** `assigned` → `in_progress` → `awaiting_inspection` → `completed` (or `cancelled`). On reject → `rework` (same task; new session on next Start). `completedAt` is set on approve or auto-complete (when `require_inspection=false`).

**SessionStatus:** `running` \| `completed` \| `cancelled`.

**Analytics counters (§9):** sessions ≠ tasks ≠ distinct rooms. Rework is rejected-inspection events (not a `serviceType`). Anomalous session: non-empty `anomalyFlags` or duration ≥ `2 × overdueSessionMinutes` — minutes go to `totalExcludedSessionMinutes` and are excluded from valid time / P50 / P90 / productivity. On session complete, if duration ≥ `overdueSessionMinutes`, an `overdue` flag is stamped (same semantics as the overdue job) so metrics do not depend on the job having run while the session was still running.

Results (`GET /cleaning/results`) and housekeeping analytics use `completedAt` for task KPIs, separate session/accepted/rework/anomaly/room counters plus `totalValidSessionMinutes` / `totalExcludedSessionMinutes`, and optional `serviceType` filter/breakdown.

### Maintenance

| Entity | Meaning |
|---|---|
| `MaintenanceCategory` | Configurable categories (key, BG/EN labels, sort, active/archived) |
| `IssueOption` | Preset issue types (kind, category, optional defaults) |
| `MaintenanceTicket` | Repair issue on a location; category snapshot on create; optional `issueOptionId`; `blocksRoom` affects readiness |

**TicketStatus:** `new` \| `in_progress` \| `resolved` \| `closed`.  
**Ticket category:** snapshot at create time (catalog edits do not rewrite history).  
**Priority:** low, normal, high, urgent.

---

## Room readiness

Computed in `api/src/services/readiness.ts` → `computeReadiness`.

Result: `ready` | `not_ready` | `needs_check` plus a `reasons` list.

### Rules (in order)

1. `catalogStatus !== active` → **not_ready** (`archived`)
2. For **rooms**: `occupancy` or `serviceStatus` = `unknown` → **needs_check**  
   For **common areas**: only `serviceStatus` = `unknown` → **needs_check** (occupancy ignored)
3. Otherwise collect reasons:
   - `blocking_issue` — open ticket with `blocksRoom`
   - `not_vacant` — occupancy ≠ vacant (**rooms only**)
   - `cleaning_*` — cleaningStatus ≠ verified_clean
   - `out_of_service` — serviceStatus ≠ in_service
4. No reasons → **ready**, else **not_ready**

**Important:** completing cleaning does **not** make a location ready. Only an **approved inspection** sets `verified_clean`.

---

## Cleaning

### Lifecycle

```
[Create task]
   status=assigned
        │
        ▼
[Start]  → session running
   task=in_progress, cleaningStatus=in_progress
        │
        ▼
[Complete session]
   task=awaiting_inspection, cleaningStatus=pending_inspection
        │
   ┌────┴────┐
   ▼         ▼
[Approve]  [Reject]
 verified   task → rework + findings
 clean      (room → dirty; prior sessions kept;
             new session on next Start)
```

### Cleaning cycle (generation)

`Location.cleaningCycle` is a monotonic counter. Each new cleaning task is stamped with the current cycle at create (`CleaningTask.cleaningCycle`). Only the task that owns the **current** cycle may change `cleaningStatus` (and thus readiness).

- New task / mark dirty / departure dirty → bumps the cycle
- Stale approve (e.g. yesterday’s inspection while today is already cleaning) → task becomes `completed`, but the location does **not** become `verified_clean`
- Start/complete/cancel on a superseded cycle → `409 stale_cleaning_cycle`

### Who does what (API actions)

| Step | Action | Typical roles (+ owner always) |
|---|---|---|
| Mark dirty | `rooms.mark_dirty` | reception, supervisor, manager |
| Catalog CRUD / archive | `rooms.manage` | supervisor, manager, admin |
| Set occupancy | `rooms.set_occupancy` | reception, supervisor, manager |
| Set service status | `rooms.set_service_status` | supervisor, manager, admin |
| Create task | `cleaning.create` | reception, supervisor, manager |
| Start | `cleaning.start` | housekeeper, supervisor |
| Complete | `cleaning.complete` | housekeeper, supervisor |
| Inspect | `cleaning.inspect` | supervisor, manager |
| Reassign | `cleaning.reassign` | reception, supervisor, manager |
| Overdue review | `cleaning.review_overdue` | supervisor, manager |

### Operational invariants

- One **running** session per task.
- One **running** session per housekeeper at a time.
- Start / complete / inspect are **idempotent** via client `commandId` (UUID).
- Task `version` for optimistic concurrency on start/reassign (`expectedVersion`).
- Overdue = running session longer than **4 hours**.

### Reassign

Changes `assignedEmployeeId`, stores `reassignReason`, bumps `version`. Used when the job must move to another housekeeper.

---

## Maintenance

### Create (Report issue)

From Rooms / Home UI or `POST /maintenance/tickets` (action `tickets.report`):

- **From option:** `issueOptionId`, optional `title` override, `priority`, `blocksRoom`
- **Free text:** `title` + `categoryId` (active category), `priority`, `blocksRoom`
- `reportedBy` = current employee
- optional `commandId` for idempotency

Catalog: `GET /maintenance/categories`, `GET /maintenance/issue-options`. Admin: `issue_options.manage` (manager/admin) under Settings.

### Blocking a room

If `blocksRoom: true` and the ticket is open → readiness reason `blocking_issue` → room is **not ready**, even if verified_clean and vacant.

### Resolve

`POST /maintenance/tickets/:id/resolve` — action `tickets.resolve`.  
Optional body: `{ resolutionNotes?: string }`.  
Stores `resolvedBy` (current employee), `resolvedAt`, and `resolutionNotes`.  
Roles: supervisor, manager, technician, admin, **owner**.

Shown on **Home** (feed) and in Rooms for blocking issues.  
**Control** has a “Recently resolved” section with who / when / notes.

---

## People, roles, and permissions

Central catalog + defaults: **`api/src/permissions.ts`**.  
Runtime grants: **`RoleGrant`** table (edited via Permissions panel).

### Roles

| Role | Meaning |
|---|---|
| `owner` | Superuser — **all** panels and actions |
| `manager` | Control + operations; **cannot** touch owner/admin roles |
| `admin` | Team + resolve; no Control by default |
| `supervisor` | HK lead: create/inspect/reassign/team |
| `reception` | Mark dirty, create/reassign tasks, report |
| `housekeeper` | Start/complete tasks, report |
| `technician` | Report + resolve issues |

### Hard rules

1. **`owner` is a special super-role** — all panels, all API/UI actions (including start/complete of others’ work, inspect, any role change). UI shows a gold badge and a “full access” banner.
2. **`manager`** can use Control and `people.change_role`, but gets **403** when assigning/changing `owner` or `admin`.
3. Cannot demote the **last active owner**.
4. Auth is always required; owner ≠ anonymous.
5. **Capability ≠ data scope.** `RoleGrant` (panel/action) decides *whether* you may perform an action. A separate **`dataScope`** layer (§5) limits *which* rows you can see/change:
   - `owner` / `manager` / `admin` / `reception` → whole property
   - `supervisor` → sectors where `primarySupervisorEmployeeId = me`
   - `housekeeper` → tasks with `assignedEmployeeId = me` (+ related rooms/tickets)
   - `technician` → tickets with `assigneeId = me` (+ those locations)
   - List APIs filter; direct out-of-scope access → **403** (not 404 / “no data”)
   - Covered paths: rooms/tasks/tickets (incl. create), sync push, sectors CRUD (own only), live audit + SSE
   - **Sector location set** (`PUT /sectors/:id/locations`): source + destination are validated **inside the transaction**. Supervisors may only rebalance rooms already in their sectors. Foreign/unassigned rooms require `sectors.transfer_cross` (default: manager/admin).
   - **Audit list** always applies data scope: sector-scoped actors do not see foreign `locationId` / other sectors’ `entityType=sector` rows.

### Panels

| Panel | Roles |
|---|---|
| `home` | everyone |
| `rooms` | everyone |
| `common` | everyone (same as `rooms`) |
| `team` | supervisor, manager, admin, owner |
| `control` | manager, owner |
| `settings` | manager, admin, owner |
| `permissions` | manager, admin, owner |

### Landing after login

| Role | Landing |
|---|---|
| housekeeper, technician | `home` |
| reception, supervisor | `rooms` |
| manager, owner | `control` |
| admin | `team` |

### Actions (full list)

```
rooms.view
rooms.mark_dirty
rooms.manage
rooms.set_occupancy
rooms.set_service_status
cleaning.create
cleaning.start
cleaning.complete
cleaning.inspect
cleaning.reassign
cleaning.review_overdue
tickets.report
tickets.resolve
people.view
people.change_role
control.access
settings.manage
permissions.manage
sectors.manage
sectors.transfer_cross
```

Login and `GET /auth/me` return `panels[]`, `actions[]`, `landing`.  
Middleware: `requireAction(action)` uses `canPerform` (owner → allow).

### Panel × role matrix

| | HK | Tech | Reception | Supervisor | Manager | Admin | Owner |
|---|---|---|---|---|---|---|---|
| Home | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Rooms | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Common | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Team | | | | ✓ | ✓ | ✓ | ✓ |
| Control | | | | | ✓ | | ✓ |
| Settings | | | | | ✓ | ✓ | ✓ |
| Permissions | | | | | ✓ | ✓ | ✓ |

### Key actions × role matrix

| Action | HK | Tech | Rec | Sup | Mgr | Adm | Owner |
|---|---|---|---|---|---|---|---|
| mark_dirty | | | ✓ | ✓ | ✓ | | ✓ |
| cleaning.create | | | ✓ | ✓ | ✓ | | ✓ |
| cleaning.start/complete | ✓ | | | ✓ | | | ✓ |
| cleaning.inspect | | | | ✓ | ✓ | | ✓ |
| cleaning.reassign | | | ✓ | ✓ | ✓ | | ✓ |
| tickets.resolve | | ✓ | | ✓ | ✓ | ✓ | ✓ |
| people.view | | | | ✓ | ✓ | ✓ | ✓ |
| people.change_role | | | | | ✓ | | ✓ |
| control.access | | | | | ✓ | | ✓ |
| settings.manage | | | | | ✓ | ✓ | ✓ |
| permissions.manage | | | | | ✓ | ✓ | ✓ |

*(Owner column is always ✓ for every known action.)*

---

## UI panels and actions

### Login

- Email + password
- Dark/light theme (localStorage)
- On success → role `landing` panel

### Home

- Open maintenance tickets feed
- Resolve button for roles with `tickets.resolve`

### Rooms

- Room table: building, floor, number, dimensions, readiness, reasons, active task
- Role-gated actions (UI still has some role checks; API is source of truth via actions)
- Overdue section for supervisor (API also allows manager/owner)
- Report issue form (title, category, blocks room)
- Resolve blocking issues

### Team

- People list: name, number, email, role, department
- Access: `people.view`

### Control

- Role changes (`assignableRolesFor`)
  - owner → all roles
  - manager → excludes owner/admin
- Shortcuts: create task, resolve issues
- Access: `control.access` / `people.change_role`

### Theme

`data-theme` + CSS variables — dark / light.

---

## API

Base: `http://localhost:4000`  
Auth: httpOnly cookies (`session` access JWT ~15m, `refresh` ~14d) + CSRF double-submit (`csrf` cookie + `X-CSRF-Token`). Scripts may use `Authorization: Bearer <access>`. Browser default API base: `/api` (Vite proxy → API).

### Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | `{ email, password }` → `{ user, expiresIn }` + Set-Cookie (session/refresh/csrf) |
| POST | `/auth/refresh` | refresh cookie → new cookies + `{ ok, expiresIn }` |
| POST | `/auth/logout` | revoke current session + clear cookies |
| POST | `/auth/logout-all` | auth — revoke all sessions for user + clear cookies |
| GET | `/auth/me` | auth → user + capabilities |

### Rooms

| Method | Path | Permission |
|---|---|---|
| GET | `/rooms` | auth (`kind=room`) |
| GET | `/rooms/:id` | auth |
| POST | `/rooms/:id/mark-dirty` | `rooms.mark_dirty` |

### Common areas

| Method | Path | Permission |
|---|---|---|
| GET | `/common-areas` | auth (`kind=common_area`) |
| GET | `/common-areas/:id` | auth |
| POST | `/common-areas/:id/mark-dirty` | `rooms.mark_dirty` |

### Locations (catalog + operational states)

| Method | Path | Permission |
|---|---|---|
| GET | `/locations/hierarchy` | `rooms.manage` — buildings → floors for create/edit |
| GET | `/locations?kind=&includeArchived=` | `rooms.manage` — catalog list |
| POST | `/locations` | `rooms.manage` — `{ floorId, number, kind? }` |
| PATCH | `/locations/:id` | `rooms.manage` — catalog fields |
| POST | `/locations/:id/archive` | `rooms.manage` |
| POST | `/locations/:id/restore` | `rooms.manage` |
| PATCH | `/locations/:id/occupancy` | `rooms.set_occupancy` — rooms only |
| PATCH | `/locations/:id/service-status` | `rooms.set_service_status` |
| GET | `/locations/:id/qr` | `sectors.manage` — payload + scan URL |
| GET | `/locations/by-qr/:token` | auth — identify location (no auto start/complete) |

UI: catalog under Housekeeping → Catalog; occupancy/service in the Rooms / Common areas detail drawer.

### Sectors / shifts / roster

| Method | Path | Permission |
|---|---|---|
| GET | `/sectors` | `sectors.manage` |
| GET | `/sectors/mine` | auth — active sectors where primary supervisor = current employee |
| GET/POST/PATCH | `/sectors`, `…/:id` | `sectors.manage` (supervisors cannot `POST` — would expand scope) |
| PUT | `/sectors/:id/locations` | `sectors.manage` + in-TX source/destination scope; foreign/unassigned → `sectors.transfer_cross` |
| GET/POST/PATCH | `/shifts`, `…/:id` | `shifts.manage` (GET active also: `plan.manage` / cleaning create\|reassign) |
| GET/PUT | `/shifts/roster?hotelDate=` | `shifts.manage` — daily employee↔shift roster |

`CleaningTask.shiftId` links a task to a planned shift (create / reassign / daily plan). `EmployeeShiftRoster` is who works which shift on a hotel date. My Work filters by the user’s roster shift (unshifted tasks stay visible).

### Settings

| Method | Path | Permission |
|---|---|---|
| GET | `/settings/public` | auth (modules, interface, operations subset, flags subset) |
| GET | `/settings` | `settings.manage` |
| GET | `/settings/system` | `settings.manage` |
| GET | `/settings/history` | `settings.manage` (reads `AuditEvent` where entityType=setting) |
| PATCH | `/settings/:key` | `settings.manage` |

### Audit

| Method | Path | Permission |
|---|---|---|
| GET | `/audit-events` | any of `settings.manage` \| `permissions.manage` \| `operations.view_live` |

Query: `entityType`, `entityId`, `locationId`, `actorEmployeeId`, `action`, `from`, `to`, `limit`. Unified who/what log (§7). Settings and permissions history endpoints are filtered views over the same table.

### Live events (SSE)

| Method | Path | Permission |
|---|---|---|
| POST | `/events/ticket` | auth (Bearer) — short-lived ticket (~5 min, `purpose=sse`) for EventSource |
| GET | `/events/stream` | auth: cookie session, Bearer access JWT, or `?ticket=` (short-lived SSE ticket). |

Stream tickets and open SSE connections are bound to an active `AuthSession` (role from DB, not JWT); role changes revoke sessions and drop elevated SSE within one heartbeat (~25s).

Events: `connected`, `location.changed`, `cleaning.changed`, `ticket.changed`, `settings.changed`, `people.changed`, `revoked`. Clients treat them as invalidate signals and refetch.

Delivery: `settings.changed` / `people.changed` — every authenticated subscriber; `location` / `cleaning` / `ticket` — only when IDs fall inside the subscriber’s `resolveDataScope` (no cross-sector / assignment over-sharing).

### Permissions (role matrix)

| Method | Path | Permission |
|---|---|---|
| GET | `/permissions/matrix` | `permissions.manage` |
| PUT | `/permissions/roles/:role` | `permissions.manage` |
| GET | `/permissions/history` | `permissions.manage` |

### Cleaning

| Method | Path | Permission |
|---|---|---|
| GET | `/cleaning/tasks?hotelDate=` | auth |
| POST | `/cleaning/tasks` | `cleaning.create` |
| POST | `/cleaning/tasks/:id/start` | `cleaning.start` + `{ commandId, expectedVersion? }` |
| POST | `/cleaning/tasks/:id/inspect` | `cleaning.inspect` + `{ commandId, result, findings? }` (findings required on reject) |
| POST | `/cleaning/tasks/:id/reassign` | `cleaning.reassign` |
| POST | `/cleaning/sessions/:id/complete` | `cleaning.complete` + `{ commandId, notes? }` |
| POST | `/cleaning/sessions/:id/cancel` | `cleaning.review_overdue` + `{ commandId, notes? }` (running → cancelled; no adjustment) |
| GET | `/cleaning/sessions/review` | `cleaning.review_overdue` |
| GET | `/cleaning/employees/housekeepers` | auth |

### Operations (Live board S09)

| Method | Path | Permission |
|---|---|---|
| GET | `/operations/live` | `operations.view_live` |

Aggregator for supervisor/manager: active sessions (elapsed, overdue, anomaly = 2× overdue threshold), just completed (60 min), needs attention (inspection / past due / blocking tickets), ops audit feed from `AuditEvent` (24h, ops-relevant actions). Client polls ~15s with stale/offline indicator.

### Daily plan (S12 / Clock)

| Method | Path | Permission |
|---|---|---|
| GET | `/daily-plan?hotelDate=` | `plan.view` |
| POST | `/daily-plan` | `plan.manage` — manual entry |
| POST | `/daily-plan/import` | `plan.manage` — agreed JSON (not a live PMS) |
| DELETE | `/daily-plan/:id` | `plan.manage` |

Import resolves rooms by `buildingCode` + `roomNumber`, writes `source=import`, stores a `DailyPlanImportBatch`, and is idempotent on `externalId` / existing rows (manual entries are never overwritten). Example: `api/fixtures/daily-plan-import.example.json`.

### Maintenance

| Method | Path | Permission |
|---|---|---|
| GET | `/maintenance/categories` | `tickets.report` |
| POST/PATCH | `/maintenance/categories`, `…/:id/archive` | `issue_options.manage` |
| GET | `/maintenance/issue-options` | `tickets.report` |
| POST/PATCH | `/maintenance/issue-options`, `…/reorder`, `…/:id/archive` | `issue_options.manage` |
| GET | `/maintenance/tickets` | auth (`status=open\|all\|resolved`, `locationId`, `limit`) |
| POST | `/maintenance/tickets` | `tickets.report` — `issueOptionId` **or** `categoryId`+`title` |
| POST | `/maintenance/tickets/:id/resolve` | `tickets.resolve` + `{ resolutionNotes? }` |

### People

| Method | Path | Permission |
|---|---|---|
| GET | `/people` | `people.view` (`q`, `role`, `includeInactive`) |
| PATCH | `/people/:id/role` | `people.change_role` + `{ role }` |

### Attendance (S13)

| Method | Path | Permission |
|---|---|---|
| GET | `/attendance/intervals` | `attendance.view` (`scope=month\|today\|week\|review`, `month`, `department`, `q`, `limit`, `cursor`) — returns `{ intervals, total, nextCursor, limit, maxClockSkewSeconds }` |
| GET | `/attendance/intervals/:id` | `attendance.view` |
| GET | `/attendance/export.csv` | `attendance.view` (same filters; batched export, ceiling 50 000 rows → 413; `X-Attendance-Total` header) |
| POST | `/attendance/events` | `attendance.ingest` — simulated terminal; idempotent on `(source, externalEventId)`; retries rebuild intervals if the event was stored without an interval (including break events and concurrent `P2002` races) |
| POST | `/attendance/adjustments` | `attendance.request_adjustment` |
| POST | `/attendance/adjustments/:id/review` | `attendance.approve_adjustment` + `{ decision: approved\|rejected }` |

Original `AttendanceEvent` rows are never mutated on approved correction. Overnight shift is one interval; `hotelDate` = start date in `operations.hotelTimezone`. Ingest wraps event + interval rebuild in a transaction and replays the employee’s hotel-day event stream so partial failures self-heal on retry; concurrent duplicate creates are caught as `P2002` and run through the same reconcile path.

### Audit history migration note

`20261002260000_unified_audit_events` copies `PermissionChange` / `SettingChange` into `AuditEvent` then drops them. `20261006220000_backfill_legacy_audit_history` is a safety net for partial/pre-drop states (normally a no-op).

If this migration was already applied with the older DROP-only SQL, Prisma may report a checksum mismatch — update the checksum in `_prisma_migrations` for that migration name after the intentional rewrite; do not edit other applied migrations. Dropped rows are **not** restored by a new migration: restore staging tables from backup and run [`api/prisma/scripts/restore_permission_setting_history.sql`](api/prisma/scripts/restore_permission_setting_history.sql). Without a backup, that history cannot be invented.

### Health

`GET /health` → `{ ok: true }`

Errors: `{ error, message, details? }`.

---

## Seed / demo data

`cd api && npm run db:seed` — **wipes and recreates** data.

| What | Amount / content |
|---|---|
| Property | Meridian Resort |
| Buildings | MAIN (4×10), ANNEX (2×5), ROYAL (10×30) → **~350 rooms** |
| Users | ~26 accounts, password `demo1234` |
| Tickets | ~12 open (some blocking) |
| Tasks | sample assigned / awaiting_inspection |

### Primary demo accounts

| Email | Role |
|---|---|
| `owner@meridian.local` | owner |
| `manager@meridian.local` | manager |
| `admin@meridian.local` | admin |
| `supervisor@meridian.local` | supervisor |
| `reception@meridian.local` | reception |
| `housekeeper@meridian.local` | housekeeper |
| `technician@meridian.local` | technician |

Extra HK / tech / managers are also seeded.

### Recommended demo flow

1. **supervisor** — dirty room → Create task (assign HK).
2. **housekeeper** — Start → Complete → room `pending_inspection`.
3. **supervisor** — Approve (or Reject).
4. Report issue with blocks room → Resolve.
5. **owner** — all tabs; inspect / role change without 403.
6. **manager** — try role=`owner` → **403**.

---

## Technical rules

1. Complete ≠ verified clean — only inspection approve.
2. Owner is never hidden from a panel and never blocked on a known action.
3. Manager does not manage owner/admin identities.
4. Idempotency via `commandId` on critical commands.
5. Access JWT ~15m in httpOnly cookie (+ refresh ~14d); missing/invalid session → 401.
6. Readiness is derived — not stored as a DB column.
7. Postgres on host **5433**, not 5432.

---

## Code layout

```
maintenance/
├── docker-compose.yml
├── README.md              ← Bulgarian
├── README.en.md           ← this file (English)
├── api/
│   ├── prisma/schema.prisma, migrations/, seed.ts
│   └── src/
│       ├── permissions.ts
│       ├── middleware/auth.ts
│       ├── routes/ (auth, rooms, cleaning, maintenance, people, settings, events)
│       ├── events/bus.ts
│       └── services/ (cleaning, readiness, maintenance)
└── web/src/
    ├── App.tsx            # nav + landing from capabilities
    ├── api/client.ts
    ├── hooks/useLiveRefresh.ts
    ├── theme.ts
    ├── offline/           # IndexedDB queue + My Work cache (user-partitioned; cleared on logout/switch)
    ├── pages/ (Login, MyWork, Repairs, Audit, Home, Rooms, Team, Plan, Attendance, Cards, Results, Analytics, Control, Settings, Permissions)
```

---

## Roadmap

After the current foundation (not built yet):

- Physical card encoder adapter (hardware)
- New roles (e.g. `hk_lead`)
- Drive all UI buttons from `actions[]` (no ad-hoc role ifs)
- QR scan → confirm start/complete (identify only today)
- Live PMS/Clock import adapters (`DailyPlanImportBatch` / JobRun skeleton exists)
- QR scan → confirm start/complete (currently identify only)

---

## Git

Remote (if configured): `git@github.com:perikliev00/Maintenance.git`
