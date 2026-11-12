/**
 * Read-side listing and event history for maintenance tickets.
 */
import { Priority, Prisma, TicketStatus } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../constants for this service.
import { OPEN_TICKET_STATUSES } from "../../constants";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module ./format for this service.
import { formatMaintenanceTicket } from "./format";
// Import module ./types for this service.
import { ticketInclude } from "./types";
// Import module dependency for this service.
import {
  // Run next step: decodeTicketListCursor,
  decodeTicketListCursor,
  // Run next step: encodeTicketListCursor,
  encodeTicketListCursor,
  // Declare type TicketSortKey for callers and internals.
  type TicketSortKey,
// Run next step: } from "./ticketListCursor";
} from "./ticketListCursor";

// Capture default page size for use in this scope.
const DEFAULT_PAGE_SIZE = 50;
// Capture max page size for use in this scope.
const MAX_PAGE_SIZE = 100;

// Declare type MaintenanceTicketListPage for callers and internals.
export type MaintenanceTicketListPage = {
  // Set items on the structure being built.
  items: Array<ReturnType<typeof formatMaintenanceTicket> & { slaBreached: boolean }>;
  // Set nextCursor on the structure being built.
  nextCursor: string | null;
  // Set total on the structure being built.
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
  // Run next step: locationId?: string;
  locationId?: string;
  // Run next step: assigneeId?: string;
  assigneeId?: string;
  // Run next step: openOnly?: boolean;
  openOnly?: boolean;
  // Run next step: resolvedOnly?: boolean;
  resolvedOnly?: boolean;
  // Run next step: statuses?: TicketStatus[];
  statuses?: TicketStatus[];
  // Run next step: priority?: Priority;
  priority?: Priority;
  // Run next step: slaBreached?: boolean;
  slaBreached?: boolean;
  // Run next step: blocksRoom?: boolean;
  blocksRoom?: boolean;
  // Run next step: limit?: number;
  limit?: number;
  // Run next step: cursor?: string;
  cursor?: string;
  // Run next step: includeArchivedLocations?: boolean;
  includeArchivedLocations?: boolean;
  /** Caller-supplied data-scope AND clause (sector / assignee limits). */
  scopeWhere?: Prisma.MaintenanceTicketWhereInput;
// Run next step: }): Promise<MaintenanceTicketListPage> {
}): Promise<MaintenanceTicketListPage> {
  // Single `now` so filter and computed slaBreached stay consistent.
  const now = new Date();
  // Capture history statuses for use in this scope.
  const historyStatuses =
    // Run next step: Boolean(filters.statuses?.length) &&
    Boolean(filters.statuses?.length) &&
    // Run next step: filters.statuses!.every(
    filters.statuses!.every(
      // Run next step: (status) =>
      (status) =>
        // Update status as control flow progresses.
        status === TicketStatus.resolved || status === TicketStatus.closed,
    );
  // status=resolved uses statuses=[resolved] (not resolvedOnly); keep sort aligned.
  const sortKey: TicketSortKey =
    // Run next step: filters.resolvedOnly || historyStatuses ? "resolvedAt" : "op…
    filters.resolvedOnly || historyStatuses ? "resolvedAt" : "openedAt";
  // Capture decoded for use in this scope.
  const decoded = filters.cursor ? decodeTicketListCursor(filters.cursor) : null;
  // Branch when this condition holds so the right path runs.
  if (decoded && decoded.sort !== sortKey) {
    // Abort with an error so callers can react.
    throw new AppError(
      // Run next step: 400,
      400,
      // Run next step: "validation",
      "validation",
      // Run next step: "Ticket list cursor does not match the current sort order",
      "Ticket list cursor does not match the current sort order",
    );
  }

  // Capture limit raw for use in this scope.
  const limitRaw = filters.limit;
  // Capture limited for use in this scope.
  const limited =
    // Run next step: limitRaw !== undefined && Number.isFinite(limitRaw) && limit…
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
  // Capture take for use in this scope.
  const take = pageSize !== undefined ? pageSize + 1 : undefined;

  // Capture base where for use in this scope.
  const baseWhere: Prisma.MaintenanceTicketWhereInput = {
    // Set AND on the structure being built.
    AND: [
      // Data-scope clause from the controller (may be empty).
      filters.scopeWhere ?? {},
      // Explicit location/history views retain archived records; operational queues hide them.
      filters.locationId ||
      // Run next step: filters.resolvedOnly ||
      filters.resolvedOnly ||
      // Run next step: filters.includeArchivedLocations ||
      filters.includeArchivedLocations ||
      // Run next step: historyStatuses
      historyStatuses
        // Complete the ternary or optional chain started above.
        ? {}
        // Complete the ternary or optional chain started above.
        : { location: { catalogStatus: "active" } },
      // Run next step: {
      {
        // Run next step: ...(filters.locationId ? { locationId: filters.locationId } …
        ...(filters.locationId ? { locationId: filters.locationId } : {}),
        // Run next step: ...(filters.assigneeId ? { assigneeId: filters.assigneeId } …
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
        // Run next step: ...(filters.resolvedOnly
        ...(filters.resolvedOnly
          // Complete the ternary or optional chain started above.
          ? { status: { in: [TicketStatus.resolved, TicketStatus.closed] } }
          // Complete the ternary or optional chain started above.
          : {}),
        // Run next step: ...(filters.priority ? { priority: filters.priority } : {}),
        ...(filters.priority ? { priority: filters.priority } : {}),
        // Run next step: ...(filters.blocksRoom !== undefined
        ...(filters.blocksRoom !== undefined
          // Complete the ternary or optional chain started above.
          ? { blocksRoom: filters.blocksRoom }
          // Complete the ternary or optional chain started above.
          : {}),
        // Paused tickets are excluded: clock is frozen until unpause.
        ...(filters.slaBreached
          // Complete the ternary or optional chain started above.
          ? {
              // Set dueAt on the structure being built.
              dueAt: { lt: now },
              // Set slaPausedAt on the structure being built.
              slaPausedAt: null,
              // Set status on the structure being built.
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
          // Set OR on the structure being built.
          OR: [
            // Run next step: { resolvedAt: { lt: decoded.at } },
            { resolvedAt: { lt: decoded.at } },
            // Run next step: { resolvedAt: decoded.at, id: { lt: decoded.id } },
            { resolvedAt: decoded.at, id: { lt: decoded.id } },
          ],
        }
      // Complete the ternary or optional chain started above.
      : {
          // Set OR on the structure being built.
          OR: [
            // Run next step: { openedAt: { lt: decoded.at } },
            { openedAt: { lt: decoded.at } },
            // Run next step: { openedAt: decoded.at, id: { lt: decoded.id } },
            { openedAt: decoded.at, id: { lt: decoded.id } },
          ],
        }
    // Complete the ternary or optional chain started above.
    : undefined;

  // Capture where for use in this scope.
  const where: Prisma.MaintenanceTicketWhereInput = cursorWhere
    // Complete the ternary or optional chain started above.
    ? { AND: [baseWhere, cursorWhere] }
    // Complete the ternary or optional chain started above.
    : baseWhere;

  // Load value asynchronously for the next steps.
  const [rows, total] = await Promise.all([
    // Persist or query via Prisma for durable state.
    prisma.maintenanceTicket.findMany({
      // Run next step: where,
      where,
      // Set include on the structure being built.
      include: ticketInclude,
      // Resolved views sort by resolvedAt; open/all views by openedAt. id breaks ties.
      orderBy:
        // Update sort key as control flow progresses.
        sortKey === "resolvedAt"
          // Complete the ternary or optional chain started above.
          ? [{ resolvedAt: "desc" }, { id: "desc" }]
          // Complete the ternary or optional chain started above.
          : [{ openedAt: "desc" }, { id: "desc" }],
      // Run next step: ...(take !== undefined ? { take } : {}),
      ...(take !== undefined ? { take } : {}),
    }),
    // Persist or query via Prisma for durable state.
    prisma.maintenanceTicket.count({ where: baseWhere }),
  ]);

  // Capture has more for use in this scope.
  const hasMore = take !== undefined && rows.length > pageSize!;
  // Capture page rows for use in this scope.
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  // Capture last for use in this scope.
  const last = pageRows.at(-1);
  // Capture next cursor for use in this scope.
  const nextCursor =
    // Run next step: hasMore && last
    hasMore && last
      // Complete the ternary or optional chain started above.
      ? encodeTicketListCursor({
          // Set sort on the structure being built.
          sort: sortKey,
          // Set at on the structure being built.
          at: sortKey === "resolvedAt"
            // Complete the ternary or optional chain started above.
            ? (last.resolvedAt ?? last.openedAt)
            // Complete the ternary or optional chain started above.
            : last.openedAt,
          // Set id on the structure being built.
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
      // Run next step: row.dueAt != null &&
      row.dueAt != null &&
      // Run next step: row.slaPausedAt == null &&
      row.slaPausedAt == null &&
      // Run next step: OPEN_TICKET_STATUSES.includes(row.status) &&
      OPEN_TICKET_STATUSES.includes(row.status) &&
      // Run next step: row.dueAt.getTime() < now.getTime();
      row.dueAt.getTime() < now.getTime();
    // Spread formatted ticket plus computed breach flag for list UI.
    return { ...formatted, slaBreached };
  });

  // Return the computed result to the caller.
  return { items, nextCursor, total };
}

/** Chronological status events for one ticket (404 if ticket missing). */
export async function listTicketEvents(ticketId: string) {
  // Existence check so empty history is distinguishable from missing ticket.
  const ticket = await prisma.maintenanceTicket.findUnique({
    // Set where on the structure being built.
    where: { id: ticketId },
    // Set select on the structure being built.
    select: { id: true },
  });
  // Branch when this condition holds so the right path runs.
  if (!ticket) {
    // Distinguish missing ticket from empty event list.
    throw new AppError(404, "not_found", "Ticket not found");
  }
  // Chronological timeline for the ticket history panel.
  return prisma.ticketEvent.findMany({
    // Set where on the structure being built.
    where: { ticketId },
    // Set include on the structure being built.
    include: {
      // Set actor on the structure being built.
      actor: {
        // Set select on the structure being built.
        select: { id: true, fullName: true, employeeNumber: true },
      },
    },
    // Set orderBy on the structure being built.
    orderBy: { occurredAt: "asc" },
  });
}
