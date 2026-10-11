import { Priority, Prisma, TicketStatus } from "@prisma/client";
import { prisma } from "../../db";
import { OPEN_TICKET_STATUSES } from "../../constants";
import { AppError } from "../../errors";
import { formatMaintenanceTicket } from "./format";
import { ticketInclude } from "./types";

export async function listMaintenanceTickets(filters: {
  locationId?: string;
  assigneeId?: string;
  openOnly?: boolean;
  resolvedOnly?: boolean;
  statuses?: TicketStatus[];
  priority?: Priority;
  slaBreached?: boolean;
  blocksRoom?: boolean;
  limit?: number;
  scopeWhere?: Prisma.MaintenanceTicketWhereInput;
}) {
  const now = new Date();
  const rows = await prisma.maintenanceTicket.findMany({
    where: {
      AND: [
        filters.scopeWhere ?? {},
        {
          ...(filters.locationId ? { locationId: filters.locationId } : {}),
          ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
          ...(filters.statuses?.length
            ? { status: { in: filters.statuses } }
            : filters.openOnly
              ? { status: { in: [...OPEN_TICKET_STATUSES] } }
              : {}),
          ...(filters.resolvedOnly
            ? { status: { in: [TicketStatus.resolved, TicketStatus.closed] } }
            : {}),
          ...(filters.priority ? { priority: filters.priority } : {}),
          ...(filters.blocksRoom !== undefined
            ? { blocksRoom: filters.blocksRoom }
            : {}),
          ...(filters.slaBreached
            ? {
                dueAt: { lt: now },
                slaPausedAt: null,
                status: { in: [...OPEN_TICKET_STATUSES] },
              }
            : {}),
        },
      ],
    },
    include: ticketInclude,
    orderBy: filters.resolvedOnly
      ? { resolvedAt: "desc" }
      : { openedAt: "desc" },
    ...(filters.limit ? { take: filters.limit } : {}),
  });
  return rows.map((row) => {
    const formatted = formatMaintenanceTicket(row);
    const slaBreached =
      row.dueAt != null &&
      row.slaPausedAt == null &&
      OPEN_TICKET_STATUSES.includes(row.status) &&
      row.dueAt.getTime() < now.getTime();
    return { ...formatted, slaBreached };
  });
}

export async function listTicketEvents(ticketId: string) {
  const ticket = await prisma.maintenanceTicket.findUnique({
    where: { id: ticketId },
    select: { id: true },
  });
  if (!ticket) {
    throw new AppError(404, "not_found", "Ticket not found");
  }
  return prisma.ticketEvent.findMany({
    where: { ticketId },
    include: {
      actor: {
        select: { id: true, fullName: true, employeeNumber: true },
      },
    },
    orderBy: { occurredAt: "asc" },
  });
}
