import { prisma } from "../db";
import { ACTIVE_TASK_STATUSES, OPEN_TICKET_STATUSES } from "../constants";
import { hotelDateAsUtcDate } from "./attendance";
import { formatMaintenanceTicket } from "./maintenance";
import { resolveDataScope, taskWhere } from "./dataScope";
import { getOperations } from "./settings";
import type { AuthUser } from "../middleware/auth";

async function hotelDateStart(isoDate?: string): Promise<Date> {
  if (isoDate) {
    return new Date(`${isoDate}T00:00:00.000Z`);
  }
  const ops = await getOperations();
  return hotelDateAsUtcDate(new Date(), ops.hotelTimezone);
}

export async function getMyWork(
  user: AuthUser,
  hotelDate?: string,
  shiftId?: string,
) {
  const scope = await resolveDataScope(user);
  const date = await hotelDateStart(hotelDate);
  const dateIso = date.toISOString().slice(0, 10);

  let effectiveShiftId = shiftId ?? null;
  let rosterShiftId: string | null = null;
  if (user.employeeId) {
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
    if (!effectiveShiftId) {
      effectiveShiftId = rosterShiftId;
    }
  }

  const shiftFilter = effectiveShiftId
    ? {
        OR: [{ shiftId: effectiveShiftId }, { shiftId: null }],
      }
    : {};

  const tasks =
    scope.kind === "assigned_tickets"
      ? []
      : await prisma.cleaningTask.findMany({
          where: {
            AND: [
              taskWhere(scope),
              { hotelDate: date },
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
          orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
        });

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
  const tickets = ticketRows.map(formatMaintenanceTicket);

  return {
    hotelDate: dateIso,
    rosterShiftId,
    filterShiftId: effectiveShiftId,
    tasks,
    tickets,
    summary: {
      taskCount: tasks.length,
      ticketCount: tickets.length,
      runningSessions: tasks.filter((t) =>
        t.sessions.some((s) => s.status === "running"),
      ).length,
    },
  };
}
