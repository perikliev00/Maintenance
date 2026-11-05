# Prisma model groups and SQL constraints

Canonical schema: [`api/prisma/schema.prisma`](../../api/prisma/schema.prisma)
(41 models, 25 enums). Do not move models out of that file — this page is the
maintenance map only. Applied history lives under
[`api/prisma/migrations/`](../../api/prisma/migrations/) (49 folders at the
verified baseline). Product narrative for locations/readiness remains in the
README [Домейн модел](../../README.md#домейн-модел) / [Readiness](../../README.md#readiness-готовност-на-стая) sections.

## Domain groups

### Hotel and locations

`Property` → `Building` → `Floor` → `Location`. Operational work hangs off
**Location** (`cleaningTasks`, `maintenanceTickets`, `dailyPlanEntries`,
`accessGrants`, optional `sectorMembership`). Location also carries independent
dimensions (`kind`, `catalogStatus`, `occupancy`, `cleaningStatus`/`cleaningCycle`,
`serviceStatus`) used by readiness.

### Identity and access

`Employee` is the HR person; `User` is the 1:1 login (`User.employeeId` unique).
Related: `Invitation`, `Device`, `AuthSession`, `RoleGrant` / `RoleGrantRevision`,
`AppliedDataSeed`, `AccessCard`, `AccessGrant`, `Sector` / `SectorLocation`,
`Shift` / `EmployeeShiftRoster`, `AppSetting`.

### Cleaning and inspections

`CleaningTask` → `CleaningSession` → `Inspection`, plus
`CleaningNotificationOutbox`. Tasks and sessions reference **Location** and
**Employee** (assignee / session worker / inspector).

### Maintenance and SLA

`MaintenanceCategory`, `IssueOption`, `SlaPolicy`, `MaintenanceTicket`,
`TicketEvent`, `TicketReopenEvent`, `TicketNotificationOutbox`. Tickets bind to
**Location** and to **Employee** as reporter / assignee / resolver / closer.
`blocksRoom` on open tickets feeds readiness.

### Attendance and daily plans

`AttendanceEvent`, `AttendanceInterval`, `AttendanceAdjustment`,
`AttendanceNotificationOutbox`; `DailyPlanImportBatch`, `DailyPlanEntry`.
Intervals/events attach to **Employee**; plan entries attach to **Location**
and optional assignee **Employee**.

### Audit, notifications, and jobs

`AuditEvent` (optional `employeeId`), `Notification` / `NotificationDelivery`,
`JobRun`, `SyncRun` (sync runs attach to **User**).

## Key hubs

| Hub | Role |
|---|---|
| **Location** | Geography + cleaning/ticket/plan/card-grant/sector membership |
| **Employee** | People side of cleaning, tickets, attendance, cards, sectors, audit, notifications |
| **User** | Auth identity for an Employee; sessions, devices, sync |

## Constraints outside Prisma declarations

Prisma cannot express partial unique indexes or `pg_trgm` GIN ops. Those live
in SQL migrations and are guarded by scripts/tests:

| Constraint | Migration | Guard |
|---|---|---|
| One **running** session per task / per employee | [`20261006210000_cleaning_atomic_invariants`](../../api/prisma/migrations/20261006210000_cleaning_atomic_invariants/migration.sql) (`CleaningSession_one_running_per_task`, `CleaningSession_one_running_per_employee`) | [`api/scripts/assert-sql-invariants.ts`](../../api/scripts/assert-sql-invariants.ts) (CI Smoke after `migrate deploy`) |
| One **active** cleaning task per location+hotelDate | same migration (`CleaningTask_one_active_per_room_date`) | same assert script |
| `TicketEvent.commandId` unique | [`20261009220000_ticket_event_command_id`](../../api/prisma/migrations/20261009220000_ticket_event_command_id/migration.sql) | same assert script |
| `Location_number_trgm_idx` (GIN `gin_trgm_ops` on `Location.number`) | [`20261101120000_location_number_trgm`](../../api/prisma/migrations/20261101120000_location_number_trgm/migration.sql) | PostgreSQL perf scenario [`locations.catalog.perf.db.test.ts`](../../api/tests/scenarios/locations.catalog.perf.db.test.ts) |

## Readiness vs schema

Readiness is application logic (`api/src/services/readiness.ts`), not a Prisma
enum: it composes Location catalog/occupancy/service/cleaning fields with open
tickets where `blocksRoom` is true. See README Readiness rules; SQL does not
materialize a single readiness column.

## Before changing schema or SQL

1. Edit only via Prisma schema + a new migration (keep history intact; do not
   rewrite applied migrations).
2. `npx prisma validate` and `npx prisma generate`.
3. On a temporary clean database: `npx prisma migrate deploy`, then
   `npx tsx scripts/assert-sql-invariants.ts`.
4. Confirm `git diff -- api/prisma/schema.prisma api/prisma/migrations/` is
   empty when the change is documentation-only (expected for this map).
5. Docker/production still migrate through the existing migrate image path;
   keep the Prisma package version aligned with the lockfile.
