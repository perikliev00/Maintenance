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
  // Declare type TicketSortKey for callers and internals.
  type TicketSortKey,
} from "./ticketListCursor";

// Capture default page size for use in this scope.
const DEFAULT_PAGE_SIZE = 50;
// Capture max page size for use in this scope.
const MAX_PAGE_SIZE = 100;

// Declare type MaintenanceTicketListPage for callers and internals.
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
  // Capture history statuses for use in this scope.
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

  // Capture limit raw for use in this scope.
  const limitRaw = filters.limit;
  const limited =
    limitRaw !== undefined && Number.isFinite(limitRaw) && limitRaw > 0;
  // Cursor pages always take a bounded page size; legacy unlimited lists omit take.
  const pageSize = limited
    // Complete the ternary or optional chain started above.
    ? Math.min(Math.floor(limitRaw!), MAX_PAGE_SIZE)
    // Complete the ternary or optional chain started above.
    : filters.cursor
      // Complete the ternary or optional chain started above.
      ? DEFAULT_PAGE_SIZE
      // Complete the ternary or optional chain started above.
      : undefined;
  const take = pageSize !== undefined ? pageSize + 1 : undefined;

  // Capture base where for use in this scope.
  const baseWhere: Prisma.MaintenanceTicketWhereInput = {
    AND: [
      // Data-scope clause from the controller (may be empty).
      filters.scopeWhere ?? {},
      // Explicit location/history views retain archived records; operational queues hide them.
      filters.locationId ||
      filters.resolvedOnly ||
      filters.includeArchivedLocations ||
      historyStatuses
        // Complete the ternary or optional chain started above.
        ? {}
        // Complete the ternary or optional chain started above.
        : { location: { catalogStatus: "active" } },
      {
        ...(filters.locationId ? { locationId: filters.locationId } : {}),
        ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
        // Explicit statuses win over openOnly shorthand.
        ...(filters.statuses?.length
          // Complete the ternary or optional chain started above.
          ? { status: { in: filters.statuses } }
          // Complete the ternary or optional chain started above.
          : filters.openOnly
            // Complete the ternary or optional chain started above.
            ? { status: { in: [...OPEN_TICKET_STATUSES] } }
            // Complete the ternary or optional chain started above.
            : {}),
        ...(filters.resolvedOnly
          // Complete the ternary or optional chain started above.
          ? { status: { in: [TicketStatus.resolved, TicketStatus.closed] } }
          // Complete the ternary or optional chain started above.
          : {}),
        ...(filters.priority ? { priority: filters.priority } : {}),
        ...(filters.blocksRoom !== undefined
          // Complete the ternary or optional chain started above.
          ? { blocksRoom: filters.blocksRoom }
          // Complete the ternary or optional chain started above.
          : {}),
        // Paused tickets are excluded: clock is frozen until unpause.
        ...(filters.slaBreached
          // Complete the ternary or optional chain started above.
          ? {
              dueAt: { lt: now },
              slaPausedAt: null,
              status: { in: [...OPEN_TICKET_STATUSES] },
            }
          // Complete the ternary or optional chain started above.
          : {}),
      },
    ],
  };

  // Capture cursor where for use in this scope.
  const cursorWhere: Prisma.MaintenanceTicketWhereInput | undefined = decoded
    // Complete the ternary or optional chain started above.
    ? sortKey === "resolvedAt"
      // Complete the ternary or optional chain started above.
      ? {
          OR: [
            { resolvedAt: { lt: decoded.at } },
            { resolvedAt: decoded.at, id: { lt: decoded.id } },
          ],
        }
      // Complete the ternary or optional chain started above.
      : {
          OR: [
            { openedAt: { lt: decoded.at } },
            { openedAt: decoded.at, id: { lt: decoded.id } },
          ],
        }
    // Complete the ternary or optional chain started above.
    : undefined;

  const where: Prisma.MaintenanceTicketWhereInput = cursorWhere
    // Complete the ternary or optional chain started above.
    ? { AND: [baseWhere, cursorWhere] }
    // Complete the ternary or optional chain started above.
    : baseWhere;

  const [rows, total] = await Promise.all([
    // Persist or query via Prisma for durable state.
    prisma.maintenanceTicket.findMany({
      where,
      include: ticketInclude,
      // Resolved views sort by resolvedAt; open/all views by openedAt. id breaks ties.
      orderBy:
        // Update sort key as control flow progresses.
        sortKey === "resolvedAt"
          // Complete the ternary or optional chain started above.
          ? [{ resolvedAt: "desc" }, { id: "desc" }]
          // Complete the ternary or optional chain started above.
          : [{ openedAt: "desc" }, { id: "desc" }],
      ...(take !== undefined ? { take } : {}),
    }),
    // Persist or query via Prisma for durable state.
    prisma.maintenanceTicket.count({ where: baseWhere }),
  ]);

  // Capture has more for use in this scope.
  const hasMore = take !== undefined && rows.length > pageSize!;
  // Capture page rows for use in this scope.
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const last = pageRows.at(-1);
  // Capture next cursor for use in this scope.
  const nextCursor =
    hasMore && last
      // Complete the ternary or optional chain started above.
      ? encodeTicketListCursor({
          sort: sortKey,
          at: sortKey === "resolvedAt"
            // Complete the ternary or optional chain started above.
            ? (last.resolvedAt ?? last.openedAt)
            // Complete the ternary or optional chain started above.
            : last.openedAt,
          id: last.id,
        })
      // Complete the ternary or optional chain started above.
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
