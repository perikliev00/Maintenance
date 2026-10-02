import { prisma } from "../db";
import { ACTIVE_TASK_STATUSES, OPEN_TICKET_STATUSES } from "../constants";
import { formatMaintenanceTicket } from "./maintenance";
import { resolveDataScope, taskWhere } from "./dataScope";
import type { AuthUser } from "../middleware/auth";

function hotelDateStart(isoDate?: string): Date {
  const raw = isoDate ?? new Date().toISOString().slice(0, 10);
  return new Date(`${raw}T00:00:00.000Z`);
}

export async function getMyWork(user: AuthUser, hotelDate?: string) {
  const scope = await resolveDataScope(user);
  const date = hotelDateStart(hotelDate);

  const tasks =
    scope.kind === "assigned_tickets"
      ? []
      : await prisma.cleaningTask.findMany({
          where: {
            AND: [
              taskWhere(scope),
              { hotelDate: date },
              { status: { in: [...ACTIVE_TASK_STATUSES] } },
            ],
          },
          include: {
            location: { include: { floor: { include: { building: true } } } },
            assignedEmployee: true,
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
    hotelDate: date.toISOString().slice(0, 10),
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
