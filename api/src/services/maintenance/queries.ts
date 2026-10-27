/**
 * Read-side listing and event history for maintenance tickets.
 */
import { Priority, Prisma, TicketStatus } from "@prisma/client";
import { prisma } from "../../db";
import { OPEN_TICKET_STATUSES } from "../../constants";
import { AppError } from "../../errors";
import { formatMaintenanceTicket } from "./format";
import { ticketInclude } from "./types";
import {
  decodeTicketListCursor,
  encodeTicketListCursor,
  type TicketSortKey,
} from "./ticketListCursor";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export type MaintenanceTicketListPage = {
  items: Array<ReturnType<typeof formatMaintenanceTicket> & { slaBreached: boolean }>;
  nextCursor: string | null;
  total: number;
};

/**
 * Filtered ticket list with computed `slaBreached` on each row.
 * Breach = open, not paused, dueAt in the past (same rules as the slaBreached filter).
 *
 * Keyset pagination uses (openedAt|resolvedAt, id) so pages stay stable under
 * concurrent inserts/updates without offset drift or duplicates.
 *
 * @param filters.scopeWhere - Data-scope AND clause from the controller.
 * @param filters.openOnly - Shorthand for OPEN_TICKET_STATUSES when statuses omitted.
 * @param filters.slaBreached - When true, pre-filter to breached open tickets only.
 * @param filters.includeArchivedLocations - History views include archived rooms.
 * @param filters.cursor - Opaque keyset cursor from a prior page.
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
  cursor?: string;
  includeArchivedLocations?: boolean;
  /** Caller-supplied data-scope AND clause (sector / assignee limits). */
  scopeWhere?: Prisma.MaintenanceTicketWhereInput;
}): Promise<MaintenanceTicketListPage> {
  // Single `now` so filter and computed slaBreached stay consistent.
  const now = new Date();
  const historyStatuses =
    Boolean(filters.statuses?.length) &&
    filters.statuses!.every(
      (status) =>
        status === TicketStatus.resolved || status === TicketStatus.closed,
    );
  // status=resolved uses statuses=[resolved] (not resolvedOnly); keep sort aligned.
  const sortKey: TicketSortKey =
    filters.resolvedOnly || historyStatuses ? "resolvedAt" : "openedAt";
  const decoded = filters.cursor ? decodeTicketListCursor(filters.cursor) : null;
  if (decoded && decoded.sort !== sortKey) {
    throw new AppError(
      400,
      "validation",
      "Ticket list cursor does not match the current sort order",
    );
  }

  const limitRaw = filters.limit;
  const limited =
    limitRaw !== undefined && Number.isFinite(limitRaw) && limitRaw > 0;
  // Cursor pages always take a bounded page size; legacy unlimited lists omit take.
  const pageSize = limited
    ? Math.min(Math.floor(limitRaw!), MAX_PAGE_SIZE)
    : filters.cursor
      ? DEFAULT_PAGE_SIZE
      : undefined;
  const take = pageSize !== undefined ? pageSize + 1 : undefined;

  const baseWhere: Prisma.MaintenanceTicketWhereInput = {
    AND: [
      // Data-scope clause from the controller (may be empty).
      filters.scopeWhere ?? {},
      // Explicit location/history views retain archived records; operational queues hide them.
      filters.locationId ||
      filters.resolvedOnly ||
      filters.includeArchivedLocations ||
      historyStatuses
        ? {}
        : { location: { catalogStatus: "active" } },
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
  };

  const cursorWhere: Prisma.MaintenanceTicketWhereInput | undefined = decoded
    ? sortKey === "resolvedAt"
      ? {
          OR: [
            { resolvedAt: { lt: decoded.at } },
            { resolvedAt: decoded.at, id: { lt: decoded.id } },
          ],
        }
      : {
          OR: [
            { openedAt: { lt: decoded.at } },
            { openedAt: decoded.at, id: { lt: decoded.id } },
          ],
        }
    : undefined;

  const where: Prisma.MaintenanceTicketWhereInput = cursorWhere
    ? { AND: [baseWhere, cursorWhere] }
    : baseWhere;

  const [rows, total] = await Promise.all([
    prisma.maintenanceTicket.findMany({
      where,
      include: ticketInclude,
      // Resolved views sort by resolvedAt; open/all views by openedAt. id breaks ties.
      orderBy:
        sortKey === "resolvedAt"
          ? [{ resolvedAt: "desc" }, { id: "desc" }]
          : [{ openedAt: "desc" }, { id: "desc" }],
      ...(take !== undefined ? { take } : {}),
    }),
    prisma.maintenanceTicket.count({ where: baseWhere }),
  ]);

  const hasMore = take !== undefined && rows.length > pageSize!;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const last = pageRows.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeTicketListCursor({
          sort: sortKey,
          at: sortKey === "resolvedAt"
            ? (last.resolvedAt ?? last.openedAt)
            : last.openedAt,
          id: last.id,
        })
      : null;

  // Attach computed slaBreached (same rules as the filter) for the UI badge.
  const items = pageRows.map((row) => {
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

  return { items, nextCursor, total };
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
