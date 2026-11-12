/**
 * Employee "My Work" aggregate: active cleaning tasks for the hotel date plus
 * open tickets assigned to the current employee (used by UI and sync pull).
 */
import { Prisma } from "@prisma/client";
// Import module ../db for this service.
import { prisma } from "../db";
// Import module ../errors for this service.
import { AppError } from "../errors";
// Import module ../constants for this service.
import { ACTIVE_TASK_STATUSES, OPEN_TICKET_STATUSES } from "../constants";
// Import module ./hotelTime for this service.
import { formatHotelDate, hotelDateAsUtcDate } from "./hotelTime";
// Import module ./maintenance for this service.
import { formatMaintenanceTicket } from "./maintenance";
// Import module ./dataScope for this service.
import { resolveDataScope, taskWhere } from "./dataScope";
// Import module ./settings for this service.
import { getOperations } from "./settings";
// Import type(s) AuthUser for typing without runtime cost.
import type { AuthUser } from "../auth/tokens";

// Declare type TicketPage for callers and internals.
type TicketPage = { ticketCursor?: string; ticketPageSize?: number };

// Define parseTicketCursor — core behavior for this module.
function parseTicketCursor(cursor: string): { openedAt: Date; id: string } {
  // Attempt the fallible work so errors can be handled below.
  try {
    // Capture value for use in this scope.
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    // Branch when this condition holds so the right path runs.
    if (!Array.isArray(value) || value.length !== 2 ||
        // Run next step: typeof value[0] !== "string" || typeof value[1] !== "string"…
        typeof value[0] !== "string" || typeof value[1] !== "string" ||
        // Run next step: !value[1] || Number.isNaN(new Date(value[0]).getTime())) thr…
        !value[1] || Number.isNaN(new Date(value[0]).getTime())) throw new Error();
    // Return the computed result to the caller.
    return { openedAt: new Date(value[0]), id: value[1] };
  // Run next step: } catch {
  } catch {
    // Abort with an error so callers can react.
    throw new AppError(400, "validation", "Invalid ticket cursor");
  }
}

/**
 * Resolve hotel-date midnight UTC from an ISO date or today's hotel timezone date.
 * Used as the Prisma `@db.Date` key for task/roster lookups.
 */
async function hotelDateStart(isoDate?: string): Promise<Date> {
  // Explicit ISO date → store as UTC midnight of that calendar day.
  if (isoDate) {
    // Return the computed result to the caller.
    return new Date(`${isoDate}T00:00:00.000Z`);
  }
  // Default: today's hotel-local calendar day as a Prisma Date key.
  const ops = await getOperations();
  // Return the computed result to the caller.
  return hotelDateAsUtcDate(new Date(), ops.hotelTimezone);
}

/**
 * Tasks scoped by data scope + optional shift; tickets always assignee-filtered.
 * `assigned_tickets` scope skips cleaning tasks entirely.
 */
export async function getMyWork(
  // Set user on the structure being built.
  user: AuthUser,
  // Run next step: hotelDate?: string,
  hotelDate?: string,
  // Run next step: shiftId?: string,
  shiftId?: string,
  // Set page on the structure being built.
  page: TicketPage = {},
// Run next step: ) {
) {
  // Capture page size for use in this scope.
  const pageSize = page.ticketPageSize ?? 50;
  // Branch when this condition holds so the right path runs.
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    // Abort with an error so callers can react.
    throw new AppError(400, "validation", "ticketPageSize must be between 1 and 100");
  }
  // Capture cursor for use in this scope.
  const cursor = page.ticketCursor ? parseTicketCursor(page.ticketCursor) : null;
  // Data scope drives which cleaning tasks are visible to this user.
  const scope = await resolveDataScope(user);
  // Hotel-date midnight UTC for Prisma Date keys + response hotelDate.
  const date = await hotelDateStart(hotelDate);
  // Capture date iso for use in this scope.
  const dateIso = formatHotelDate(date);

  // Resolve shift filter: explicit query param overrides roster for the day.
  let effectiveShiftId = shiftId ?? null;
  // Capture roster shift id for use in this scope.
  let rosterShiftId: string | null = null;
  // Branch when this condition holds so the right path runs.
  if (user.employeeId) {
    // Look up today's rostered shift for this employee (if any).
    const roster = await prisma.employeeShiftRoster.findUnique({
      // Set where on the structure being built.
      where: {
        // Set employeeId_hotelDate on the structure being built.
        employeeId_hotelDate: {
          // Set employeeId on the structure being built.
          employeeId: user.employeeId,
          // Set hotelDate on the structure being built.
          hotelDate: date,
        },
      },
      // Set select on the structure being built.
      select: { shiftId: true },
    });
    // Update roster shift id as control flow progresses.
    rosterShiftId = roster?.shiftId ?? null;
    // No explicit shiftId query param → fall back to roster.
    if (!effectiveShiftId) {
      // Update effective shift id as control flow progresses.
      effectiveShiftId = rosterShiftId;
    }
  }

  // Include unassigned-shift tasks so planners can leave shift blank on purpose.
  const shiftFilter = effectiveShiftId
    // Complete the ternary or optional chain started above.
    ? {
        // Set OR on the structure being built.
        OR: [{ shiftId: effectiveShiftId }, { shiftId: null }],
      }
    // Complete the ternary or optional chain started above.
    : {};

  // Technicians (assigned_tickets) skip the cleaning-task queue entirely.
  const tasks =
    // Run next step: scope.kind === "assigned_tickets"
    scope.kind === "assigned_tickets"
      // Complete the ternary or optional chain started above.
      ? []
      // Complete the ternary or optional chain started above.
      : await prisma.cleaningTask.findMany({
          // Set where on the structure being built.
          where: {
            // Set AND on the structure being built.
            AND: [
              // Data-scope predicate (sectors / assignee / all).
              taskWhere(scope),
              // Restrict to the resolved hotel calendar day.
              { hotelDate: date },
              // Only active workflow statuses (not done/cancelled).
              { status: { in: [...ACTIVE_TASK_STATUSES] } },
              // Run next step: { location: { catalogStatus: "active" } },
              { location: { catalogStatus: "active" } },
              // Run next step: shiftFilter,
              shiftFilter,
            ],
          },
          // Set include on the structure being built.
          include: {
            // Set location on the structure being built.
            location: { include: { floor: { include: { building: true } } } },
            // Set assignedEmployee on the structure being built.
            assignedEmployee: true,
            // Set shift on the structure being built.
            shift: {
              // Set select on the structure being built.
              select: {
                // Set id on the structure being built.
                id: true,
                // Set code on the structure being built.
                code: true,
                // Set nameBg on the structure being built.
                nameBg: true,
                // Set nameEn on the structure being built.
                nameEn: true,
                // Set startTime on the structure being built.
                startTime: true,
                // Set endTime on the structure being built.
                endTime: true,
              },
            },
            // Set sessions on the structure being built.
            sessions: true,
            // Set inspections on the structure being built.
            inspections: true,
          },
          // Highest priority first; oldest within priority next.
          orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
        });

  // Keyset pagination keeps later work reachable even when a prior row is resolved.
  const ticketWhere: Prisma.MaintenanceTicketWhereInput = {
    // Set assigneeId on the structure being built.
    assigneeId: user.employeeId,
    // Set status on the structure being built.
    status: { in: [...OPEN_TICKET_STATUSES] },
    // Set location on the structure being built.
    location: { catalogStatus: "active" },
  };
  // Load ticket rows asynchronously for the next steps.
  const ticketRows = await prisma.maintenanceTicket.findMany({
    // Set where on the structure being built.
    where: {
      // Set AND on the structure being built.
      AND: [ticketWhere, cursor ? {
        // Set OR on the structure being built.
        OR: [
          // Run next step: { openedAt: { lt: cursor.openedAt } },
          { openedAt: { lt: cursor.openedAt } },
          // Run next step: { openedAt: cursor.openedAt, id: { lt: cursor.id } },
          { openedAt: cursor.openedAt, id: { lt: cursor.id } },
        ],
      // Run next step: } : {}],
      } : {}],
    },
    // Set include on the structure being built.
    include: {
      // Set location on the structure being built.
      location: { include: { floor: { include: { building: true } } } },
      // Set reportedBy on the structure being built.
      reportedBy: true,
      // Set assignee on the structure being built.
      assignee: true,
      // Set resolvedBy on the structure being built.
      resolvedBy: true,
      // Set closedBy on the structure being built.
      closedBy: true,
    },
    // Set orderBy on the structure being built.
    orderBy: [{ openedAt: "desc" }, { id: "desc" }],
    // Set take on the structure being built.
    take: pageSize + 1,
  });
  // Capture has more for use in this scope.
  const hasMore = ticketRows.length > pageSize;
  // Capture visible tickets for use in this scope.
  const visibleTickets = ticketRows.slice(0, pageSize);
  // Capture last for use in this scope.
  const last = visibleTickets.at(-1);
  // Capture ticket next cursor for use in this scope.
  const ticketNextCursor = hasMore && last
    // Complete the ternary or optional chain started above.
    ? Buffer.from(JSON.stringify([last.openedAt.toISOString(), last.id])).toString("base64url")
    // Complete the ternary or optional chain started above.
    : null;
  // Load ticket count asynchronously for the next steps.
  const ticketCount = await prisma.maintenanceTicket.count({ where: ticketWhere });
  // Shape Prisma ticket rows into the maintenance API DTO.
  const tickets = visibleTickets.map(formatMaintenanceTicket);

  // Bundle tasks + tickets + header counts for My Work / sync pull.
  return {
    // Set hotelDate on the structure being built.
    hotelDate: dateIso,
    // Run next step: rosterShiftId,
    rosterShiftId,
    // Set filterShiftId on the structure being built.
    filterShiftId: effectiveShiftId,
    // Run next step: tasks,
    tasks,
    // Run next step: tickets,
    tickets,
    // Run next step: ticketNextCursor,
    ticketNextCursor,
    // Lightweight counts for the home-screen header.
    summary: {
      // Set taskCount on the structure being built.
      taskCount: tasks.length,
      // Run next step: ticketCount,
      ticketCount,
      // Count tasks that currently have a running cleaning session.
      runningSessions: tasks.filter((t) =>
        // Run next step: t.sessions.some((s) => s.status === "running"),
        t.sessions.some((s) => s.status === "running"),
      // Run next step: ).length,
      ).length,
    },
  };
}
