/**
 * Employee "My Work" aggregate: active cleaning tasks for the hotel date plus
 * open tickets assigned to the current employee (used by UI and sync pull).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { ACTIVE_TASK_STATUSES, OPEN_TICKET_STATUSES } from "../constants";
import { formatHotelDate, hotelDateAsUtcDate } from "./hotelTime";
import { formatMaintenanceTicket } from "./maintenance";
import { resolveDataScope, taskWhere } from "./dataScope";
import { getOperations } from "./settings";
// Import type(s) AuthUser for typing without runtime cost.
import type { AuthUser } from "../auth/tokens";

// Declare type TicketPage for callers and internals.
type TicketPage = { ticketCursor?: string; ticketPageSize?: number };

function parseTicketCursor(cursor: string): { openedAt: Date; id: string } {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 2 ||
        typeof value[0] !== "string" || typeof value[1] !== "string" ||
        !value[1] || Number.isNaN(new Date(value[0]).getTime())) throw new Error();
    return { openedAt: new Date(value[0]), id: value[1] };
  } catch {
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
    return new Date(`${isoDate}T00:00:00.000Z`);
  }
  // Default: today's hotel-local calendar day as a Prisma Date key.
  const ops = await getOperations();
  return hotelDateAsUtcDate(new Date(), ops.hotelTimezone);
}

/**
 * Tasks scoped by data scope + optional shift; tickets always assignee-filtered.
 * `assigned_tickets` scope skips cleaning tasks entirely.
 */
export async function getMyWork(
  user: AuthUser,
  hotelDate?: string,
  shiftId?: string,
  page: TicketPage = {},
) {
  // Capture page size for use in this scope.
  const pageSize = page.ticketPageSize ?? 50;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    // Abort with an error so callers can react.
    throw new AppError(400, "validation", "ticketPageSize must be between 1 and 100");
  }
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
  if (user.employeeId) {
    // Look up today's rostered shift for this employee (if any).
    const roster = await prisma.employeeShiftRoster.findUnique({
      where: {
        employeeId_hotelDate: {
          employeeId: user.employeeId,
          hotelDate: date,
        },
      },
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
        OR: [{ shiftId: effectiveShiftId }, { shiftId: null }],
      }
    // Complete the ternary or optional chain started above.
    : {};

  // Technicians (assigned_tickets) skip the cleaning-task queue entirely.
  const tasks =
    scope.kind === "assigned_tickets"
      // Complete the ternary or optional chain started above.
      ? []
      // Complete the ternary or optional chain started above.
      : await prisma.cleaningTask.findMany({
          where: {
            AND: [
              // Data-scope predicate (sectors / assignee / all).
              taskWhere(scope),
              // Restrict to the resolved hotel calendar day.
              { hotelDate: date },
              // Only active workflow statuses (not done/cancelled).
              { status: { in: [...ACTIVE_TASK_STATUSES] } },
              { location: { catalogStatus: "active" } },
              shiftFilter,
            ],
          },
          include: {
            location: { include: { floor: { include: { building: true } } } },
            assignedEmployee: true,
            shift: {
              select: {
                id: true,
                code: true,
                nameBg: true,
                nameEn: true,
                startTime: true,
                endTime: true,
              },
            },
            sessions: true,
            inspections: true,
          },
          // Highest priority first; oldest within priority next.
          orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
        });

  // Keyset pagination keeps later work reachable even when a prior row is resolved.
  const ticketWhere: Prisma.MaintenanceTicketWhereInput = {
    assigneeId: user.employeeId,
    status: { in: [...OPEN_TICKET_STATUSES] },
    location: { catalogStatus: "active" },
  };
  // Load ticket rows asynchronously for the next steps.
  const ticketRows = await prisma.maintenanceTicket.findMany({
    where: {
      AND: [ticketWhere, cursor ? {
        OR: [
          { openedAt: { lt: cursor.openedAt } },
          { openedAt: cursor.openedAt, id: { lt: cursor.id } },
        ],
      } : {}],
    },
    include: {
      location: { include: { floor: { include: { building: true } } } },
      reportedBy: true,
      assignee: true,
      resolvedBy: true,
      closedBy: true,
    },
    orderBy: [{ openedAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
  });
  // Capture has more for use in this scope.
  const hasMore = ticketRows.length > pageSize;
  // Capture visible tickets for use in this scope.
  const visibleTickets = ticketRows.slice(0, pageSize);
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
    hotelDate: dateIso,
    rosterShiftId,
    filterShiftId: effectiveShiftId,
    tasks,
    tickets,
    ticketNextCursor,
    // Lightweight counts for the home-screen header.
    summary: {
      taskCount: tasks.length,
      ticketCount,
      // Count tasks that currently have a running cleaning session.
      runningSessions: tasks.filter((t) =>
        t.sessions.some((s) => s.status === "running"),
      ).length,
    },
  };
}
