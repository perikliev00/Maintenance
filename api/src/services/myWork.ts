/**
 * Employee "My Work" aggregate: active cleaning tasks for the hotel date plus
 * open tickets assigned to the current employee (used by UI and sync pull).
 */
import { prisma } from "../db";
import { ACTIVE_TASK_STATUSES, OPEN_TICKET_STATUSES } from "../constants";
import { hotelDateAsUtcDate } from "./hotelTime";
import { formatMaintenanceTicket } from "./maintenance";
import { resolveDataScope, taskWhere } from "./dataScope";
import { getOperations } from "./settings";
import type { AuthUser } from "../middleware/auth";

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
) {
  // Data scope drives which cleaning tasks are visible to this user.
  const scope = await resolveDataScope(user);
  // Hotel-date midnight UTC for Prisma Date keys + response hotelDate.
  const date = await hotelDateStart(hotelDate);
  const dateIso = date.toISOString().slice(0, 10);

  // Resolve shift filter: explicit query param overrides roster for the day.
  let effectiveShiftId = shiftId ?? null;
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
    rosterShiftId = roster?.shiftId ?? null;
    // No explicit shiftId query param → fall back to roster.
    if (!effectiveShiftId) {
      effectiveShiftId = rosterShiftId;
    }
  }

  // Include unassigned-shift tasks so planners can leave shift blank on purpose.
  const shiftFilter = effectiveShiftId
    ? {
        OR: [{ shiftId: effectiveShiftId }, { shiftId: null }],
      }
    : {};

  // Technicians (assigned_tickets) skip the cleaning-task queue entirely.
  const tasks =
    scope.kind === "assigned_tickets"
      ? []
      : await prisma.cleaningTask.findMany({
          where: {
            AND: [
              // Data-scope predicate (sectors / assignee / all).
              taskWhere(scope),
              // Restrict to the resolved hotel calendar day.
              { hotelDate: date },
              // Only active workflow statuses (not done/cancelled).
              { status: { in: [...ACTIVE_TASK_STATUSES] } },
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

  // Open tickets assigned to this employee (capped for mobile payload size).
  const ticketRows = await prisma.maintenanceTicket.findMany({
    where: {
      assigneeId: user.employeeId,
      status: { in: [...OPEN_TICKET_STATUSES] },
    },
    include: {
      location: { include: { floor: { include: { building: true } } } },
      reportedBy: true,
      assignee: true,
      resolvedBy: true,
      closedBy: true,
    },
    orderBy: { openedAt: "desc" },
    take: 50,
  });
  // Shape Prisma ticket rows into the maintenance API DTO.
  const tickets = ticketRows.map(formatMaintenanceTicket);

  // Bundle tasks + tickets + header counts for My Work / sync pull.
  return {
    hotelDate: dateIso,
    rosterShiftId,
    filterShiftId: effectiveShiftId,
    tasks,
    tickets,
    // Lightweight counts for the home-screen header.
    summary: {
      taskCount: tasks.length,
      ticketCount: tickets.length,
      // Count tasks that currently have a running cleaning session.
      runningSessions: tasks.filter((t) =>
        t.sessions.some((s) => s.status === "running"),
      ).length,
    },
  };
}
