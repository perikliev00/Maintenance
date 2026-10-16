/**
 * Read-side listing and event history for maintenance tickets.
 */
import { Priority, Prisma, TicketStatus } from "@prisma/client";
import { prisma } from "../../db";
import { OPEN_TICKET_STATUSES } from "../../constants";
import { AppError } from "../../errors";
import { formatMaintenanceTicket } from "./format";
import { ticketInclude } from "./types";

/**
 * Filtered ticket list with computed `slaBreached` on each row.
 * Breach = open, not paused, dueAt in the past (same rules as the slaBreached filter).
 *
 * @param filters.scopeWhere - Data-scope AND clause from the controller.
 * @param filters.openOnly - Shorthand for OPEN_TICKET_STATUSES when statuses omitted.
 * @param filters.slaBreached - When true, pre-filter to breached open tickets only.
 */
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
  /** Caller-supplied data-scope AND clause (sector / assignee limits). */
  scopeWhere?: Prisma.MaintenanceTicketWhereInput;
}) {
  // Single `now` so filter and computed slaBreached stay consistent.
  const now = new Date();
  // Single query — post-map adds computed slaBreached per row.
  const rows = await prisma.maintenanceTicket.findMany({
    where: {
      AND: [
        // Data-scope clause from the controller (may be empty).
        filters.scopeWhere ?? {},
        {
          ...(filters.locationId ? { locationId: filters.locationId } : {}),
          ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
          // Explicit statuses win over openOnly shorthand.
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
          // Paused tickets are excluded: clock is frozen until unpause.
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
    // Resolved views sort by resolvedAt; open views by openedAt.
    orderBy: filters.resolvedOnly
      ? { resolvedAt: "desc" }
      : { openedAt: "desc" },
    ...(filters.limit ? { take: filters.limit } : {}),
  });
  // Attach computed slaBreached (same rules as the filter) for the UI badge.
  return rows.map((row) => {
    // Base ticket DTO from shared formatter.
    const formatted = formatMaintenanceTicket(row);
    // Mirror list filter rules so badges match server-side slaBreached filter.
    const slaBreached =
      row.dueAt != null &&
      row.slaPausedAt == null &&
      OPEN_TICKET_STATUSES.includes(row.status) &&
      row.dueAt.getTime() < now.getTime();
    // Spread formatted ticket plus computed breach flag for list UI.
    return { ...formatted, slaBreached };
  });
}

/** Chronological status events for one ticket (404 if ticket missing). */
export async function listTicketEvents(ticketId: string) {
  // Existence check so empty history is distinguishable from missing ticket.
  const ticket = await prisma.maintenanceTicket.findUnique({
    where: { id: ticketId },
    select: { id: true },
  });
  if (!ticket) {
    // Distinguish missing ticket from empty event list.
    throw new AppError(404, "not_found", "Ticket not found");
  }
  // Chronological timeline for the ticket history panel.
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
