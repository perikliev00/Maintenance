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
| Mark dirty | ✅ | Rooms / API |
| Create cleaning task + assign HK | ✅ | Rooms, Control |
| Start / Complete cleaning session | ✅ | Rooms |
| Inspect approve / reject (+ findings) | ✅ | Rooms |
| Reassign task | ✅ | Rooms / API |
| Overdue sessions (> 4h running) | ✅ | Rooms (supervisor+), API |
| Report maintenance issue (blocking / not) | ✅ | Rooms |
| Resolve issue | ✅ | Home, Rooms |
| Home feed — open issues | ✅ | Home |
| Team — people list / filters | ✅ | Team |
| Control — role changes | ✅ | Control |
| Owner = superuser (all panels + actions) | ✅ | permissions |
| Dark / light theme | ✅ | whole UI |
| My Work / personal queue | ❌ | roadmap |
| Dedicated Repairs panel | ❌ | roadmap |
| Sectors / zones / shifts | ❌ | roadmap |
| Attendance | ❌ | roadmap |
| Analytics / cards / badges | ❌ | roadmap |
| Audit log | ❌ | roadmap |
| DB-driven permissions | ❌ | roadmap |

---

## Stack and setup

| Part | Tech |
|---|---|
| `api/` | Node.js, Express, TypeScript, Prisma, JWT, Zod, bcrypt |
| `web/` | Vite, React, TypeScript |
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
              └── Location (room / unit)
```

**Location** is the operational unit. Cleaning tasks and maintenance tickets hang off it.

### Location dimensions (independent)

| Field | Enum / meaning |
|---|---|
| `catalogStatus` | `active` \| `archived` — in catalog or not |
| `occupancy` | `vacant` \| `occupied` \| `unknown` |
| `cleaningStatus` | `dirty` → `in_progress` → `pending_inspection` → `verified_clean` |
| `serviceStatus` | `in_service` \| `out_of_service` \| `unknown` |

These fields are **not collapsed** into one “room status”. UI and readiness expose them separately.

### People

| Entity | Role |
|---|---|
| `Employee` | Hotel person (number, name, department) — does work, inspections, reports |
| `User` | Login account, 1:1 with Employee; holds `role` and `isActive` |

### Cleaning aggregates

| Entity | Meaning |
|---|---|
| `CleaningTask` | Cleaning job for a `hotelDate`, priority, assignee, `status`, `version` |
| `CleaningSession` | Concrete work session (start→complete), idempotency keys; optional `notes` on complete |
| `Inspection` | Approve/reject by inspector + `findings` (required on reject) |

**TaskStatus:** `assigned` → `in_progress` → `awaiting_inspection` → `completed` (or `cancelled`).

**SessionStatus:** `running` \| `completed` \| `cancelled`.

### Maintenance

| Entity | Meaning |
|---|---|
| `MaintenanceTicket` | Repair issue on a location; `blocksRoom` affects readiness; on resolve: `resolvedBy`, `resolvedAt`, `resolutionNotes` |

**TicketStatus:** `new` \| `in_progress` \| `resolved` \| `closed`.  
**Category:** climate, electrical, furniture, plumbing, other.  
**Priority:** low, normal, high, urgent.

---

## Room readiness

Computed in `api/src/services/readiness.ts` → `computeReadiness`.

Result: `ready` | `not_ready` | `needs_check` plus a `reasons` list.

### Rules (in order)

1. `catalogStatus !== active` → **not_ready** (`archived`)
2. `occupancy` or `serviceStatus` = `unknown` → **needs_check**
3. Otherwise collect reasons:
   - `blocking_issue` — open ticket with `blocksRoom`
   - `not_vacant` — occupancy ≠ vacant
   - `cleaning_*` — cleaningStatus ≠ verified_clean
   - `out_of_service` — serviceStatus ≠ in_service
4. No reasons → **ready**, else **not_ready**

**Important:** completing cleaning does **not** make a room ready. Only an **approved inspection** sets `verified_clean`.

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
 verified   rework / findings
 clean      (room is NOT verified_clean)
```

### Who does what (API actions)

| Step | Action | Typical roles (+ owner always) |
|---|---|---|
| Mark dirty | `rooms.mark_dirty` | reception, supervisor, manager |
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

From Rooms UI / `POST /maintenance/tickets`:

- `title`, `category`, `priority`, `blocksRoom`
- `reportedBy` = current employee
- optional `commandId` for idempotency

Any authenticated user can report.

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

Central registry: **`api/src/permissions.ts`**.

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

### Panels

| Panel | Roles |
|---|---|
| `home` | everyone |
| `rooms` | everyone |
| `team` | supervisor, manager, admin, owner |
| `control` | manager, owner |

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
```

Login and `GET /auth/me` return `panels[]`, `actions[]`, `landing`.  
Middleware: `requireAction(action)` uses `canPerform` (owner → allow).  
`requireRoles(...)` also always lets owner through.

### Panel × role matrix

| | HK | Tech | Reception | Supervisor | Manager | Admin | Owner |
|---|---|---|---|---|---|---|---|
| Home | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Rooms | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Team | | | | ✓ | ✓ | ✓ | ✓ |
| Control | | | | | ✓ | | ✓ |

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
Auth header: `Authorization: Bearer <token>`

### Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | `{ email, password }` → `{ token, user }` with capabilities |
| GET | `/auth/me` | current user + `panels`, `actions`, `landing` |

### Rooms

| Method | Path | Permission |
|---|---|---|
| GET | `/rooms` | auth |
| GET | `/rooms/:id` | auth |
| POST | `/rooms/:id/mark-dirty` | `rooms.mark_dirty` |

### Cleaning

| Method | Path | Permission |
|---|---|---|
| GET | `/cleaning/tasks?hotelDate=` | auth |
| POST | `/cleaning/tasks` | `cleaning.create` |
| POST | `/cleaning/tasks/:id/start` | `cleaning.start` + `{ commandId, expectedVersion? }` |
| POST | `/cleaning/tasks/:id/inspect` | `cleaning.inspect` + `{ commandId, result, findings? }` (findings required on reject) |
| POST | `/cleaning/tasks/:id/reassign` | `cleaning.reassign` |
| POST | `/cleaning/sessions/:id/complete` | `cleaning.complete` + `{ commandId, notes? }` |
| GET | `/cleaning/sessions/review` | `cleaning.review_overdue` |
| GET | `/cleaning/employees/housekeepers` | auth |

### Maintenance

| Method | Path | Permission |
|---|---|---|
| GET | `/maintenance/tickets` | auth (`status=open\|all\|resolved`, `locationId`, `limit`) |
| POST | `/maintenance/tickets` | auth (report) |
| POST | `/maintenance/tickets/:id/resolve` | `tickets.resolve` + `{ resolutionNotes? }` |

### People

| Method | Path | Permission |
|---|---|---|
| GET | `/people` | `people.view` (`q`, `role`, `includeInactive`) |
| PATCH | `/people/:id/role` | `people.change_role` + `{ role }` |

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
5. JWT ~12h; missing token → 401.
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
│       ├── routes/ (auth, rooms, cleaning, maintenance, people)
│       └── services/ (cleaning, readiness, maintenance)
└── web/src/
    ├── App.tsx            # nav + landing from capabilities
    ├── api/client.ts
    ├── theme.ts
    └── pages/ (Login, Home, Rooms, Team, Control)
```

---

## Roadmap

After the current P0 foundation (not built yet):

- **My Work** — personal queues for HK / technician
- **Repairs** as a dedicated panel
- **Sectors / zones / shifts**
- **Attendance**
- **Cards / badges**, **Analytics**
- New roles (e.g. `hk_lead`)
- DB permission tables + audit log
- Drive all UI buttons from `actions[]` (no ad-hoc role ifs)

---

## Git

Remote (if configured): `git@github.com:perikliev00/Maintenance.git`
