/**
 * Paginated needs-attention slices for the operations live board.
 */
import { Prisma, TaskStatus } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../constants for this service.
import { OPEN_TICKET_STATUSES } from "../../constants";
// Import module dependency for this service.
import {
  // Run next step: ATTENTION_KIND_META,
  ATTENTION_KIND_META,
  // Run next step: attentionTitleForKind,
  attentionTitleForKind,
  // Declare type NeedsAttentionKind for callers and internals.
  type NeedsAttentionKind,
// Run next step: } from "../operationsLiveAttention";
} from "../operationsLiveAttention";
// Import module ./cursors for this service.
import { decodeCursor, encodeCursor } from "./cursors";
// Import module dependency for this service.
import {
  // Run next step: employeePayload,
  employeePayload,
  // Run next step: locationInclude,
  locationInclude,
  // Run next step: locationPayload,
  locationPayload,
  // Run next step: NEEDS_ATTENTION_LIMIT,
  NEEDS_ATTENTION_LIMIT,
  // Run next step: taskListInclude,
  taskListInclude,
  // Declare type NeedsItem for callers and internals.
  type NeedsItem,
// Run next step: } from "./dto";
} from "./dto";

// Define taskToNeed — core behavior for this module.
function taskToNeed(
  // Set t on the structure being built.
  t: {
    // Set id on the structure being built.
    id: string;
    // Set status on the structure being built.
    status: TaskStatus;
    // Set dueAt on the structure being built.
    dueAt: Date | null;
    // Set priority on the structure being built.
    priority: string;
    // Set location on the structure being built.
    location: {
      // Set id on the structure being built.
      id: string;
      // Set number on the structure being built.
      number: string;
      // Set kind on the structure being built.
      kind: string;
      // Set floor on the structure being built.
      floor: { number: number; building: { code: string } };
    };
    // Set assignedEmployee on the structure being built.
    assignedEmployee: {
      // Set id on the structure being built.
      id: string;
      // Set fullName on the structure being built.
      fullName: string;
      // Set employeeNumber on the structure being built.
      employeeNumber: string;
    // Run next step: } | null;
    } | null;
  },
  // Set kind on the structure being built.
  kind: "awaiting_inspection" | "past_due",
// Run next step: ): NeedsItem {
): NeedsItem {
  // Capture titles for use in this scope.
  const titles = attentionTitleForKind(kind);
  // Return the computed result to the caller.
  return {
    // Run next step: kind,
    kind,
    // Set id on the structure being built.
    id: t.id,
    // Set titleKey on the structure being built.
    titleKey: titles.titleKey,
    // Set title on the structure being built.
    title: titles.title,
    // Set location on the structure being built.
    location: locationPayload(t.location),
    // Set employee on the structure being built.
    employee: t.assignedEmployee
      // Complete the ternary or optional chain started above.
      ? employeePayload(t.assignedEmployee)
      // Complete the ternary or optional chain started above.
      : null,
    // Set dueAt on the structure being built.
    dueAt: t.dueAt?.toISOString() ?? null,
    // Set priority on the structure being built.
    priority: t.priority,
    // Set status on the structure being built.
    status: t.status,
  };
}

// Re-export selected symbols for barrel consumers.
export { taskToNeed };

/**
 * Page of one needs-attention kind (cursor pagination). Used by the live board
 * "load more" path so totals stay accurate without unbounded first payloads.
 */
export async function getOperationsLiveAttentionPage(input: {
  // Set kind on the structure being built.
  kind: NeedsAttentionKind;
  // Run next step: cursor?: string | null;
  cursor?: string | null;
  // Run next step: limit?: number;
  limit?: number;
  // Run next step: scopeWhere?: {
  scopeWhere?: {
    // Run next step: task?: Prisma.CleaningTaskWhereInput;
    task?: Prisma.CleaningTaskWhereInput;
    // Run next step: ticket?: Prisma.MaintenanceTicketWhereInput;
    ticket?: Prisma.MaintenanceTicketWhereInput;
  };
// Run next step: }) {
}) {
  // Capture limit for use in this scope.
  const limit = Math.min(
    // Run next step: Math.max(1, input.limit ?? NEEDS_ATTENTION_LIMIT),
    Math.max(1, input.limit ?? NEEDS_ATTENTION_LIMIT),
    // Run next step: NEEDS_ATTENTION_LIMIT,
    NEEDS_ATTENTION_LIMIT,
  );
  // Capture now for use in this scope.
  const now = new Date();
  // Capture task scope for use in this scope.
  const taskScope: Prisma.CleaningTaskWhereInput = {
    // Set AND on the structure being built.
    AND: [input.scopeWhere?.task ?? {}, { location: { catalogStatus: "active" } }],
  };
  // Capture ticket scope for use in this scope.
  const ticketScope: Prisma.MaintenanceTicketWhereInput = {
    // Set AND on the structure being built.
    AND: [
      // Run next step: input.scopeWhere?.ticket ?? {},
      input.scopeWhere?.ticket ?? {},
      // Run next step: { location: { catalogStatus: "active" } },
      { location: { catalogStatus: "active" } },
    ],
  };
  // Capture cursor for use in this scope.
  const cursor = decodeCursor(input.cursor);

  // Branch when this condition holds so the right path runs.
  if (input.kind === "awaiting_inspection") {
    // Capture where for use in this scope.
    const where: Prisma.CleaningTaskWhereInput = {
      // Set status on the structure being built.
      status: TaskStatus.awaiting_inspection,
      // Run next step: ...taskScope,
      ...taskScope,
      // Run next step: ...(cursor
      ...(cursor
        // Complete the ternary or optional chain started above.
        ? {
            // Set OR on the structure being built.
            OR: [
              // Run next step: { updatedAt: { lt: cursor.at } },
              { updatedAt: { lt: cursor.at } },
              // Run next step: { updatedAt: cursor.at, id: { lt: cursor.id } },
              { updatedAt: cursor.at, id: { lt: cursor.id } },
            ],
          }
        // Complete the ternary or optional chain started above.
        : {}),
    };
    // Load value asynchronously for the next steps.
    const [rows, total] = await Promise.all([
      // Persist or query via Prisma for durable state.
      prisma.cleaningTask.findMany({
        // Run next step: where,
        where,
        // Set include on the structure being built.
        include: taskListInclude,
        // Set orderBy on the structure being built.
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        // Set take on the structure being built.
        take: limit,
      }),
      // Persist or query via Prisma for durable state.
      prisma.cleaningTask.count({
        // Set where on the structure being built.
        where: { status: TaskStatus.awaiting_inspection, ...taskScope },
      }),
    ]);
    // Capture items for use in this scope.
    const items = rows.map((t) => taskToNeed(t, "awaiting_inspection"));
    // Capture last for use in this scope.
    const last = rows[rows.length - 1];
    // Return the computed result to the caller.
    return {
      // Set kind on the structure being built.
      kind: input.kind as NeedsAttentionKind,
      // Run next step: items,
      items,
      // Run next step: total,
      total,
      // Set returned on the structure being built.
      returned: items.length,
      // Set hasMore on the structure being built.
      hasMore: rows.length === limit,
      // Set nextCursor on the structure being built.
      nextCursor: last ? encodeCursor(last.updatedAt, last.id) : null,
    };
  }

  // Branch when this condition holds so the right path runs.
  if (input.kind === "past_due") {
    // Capture base where for use in this scope.
    const baseWhere: Prisma.CleaningTaskWhereInput = {
      // Set status on the structure being built.
      status: {
        // Set in on the structure being built.
        in: [
          // Run next step: TaskStatus.assigned,
          TaskStatus.assigned,
          // Run next step: TaskStatus.in_progress,
          TaskStatus.in_progress,
          // Run next step: TaskStatus.rework,
          TaskStatus.rework,
          // Run next step: TaskStatus.awaiting_inspection,
          TaskStatus.awaiting_inspection,
        ],
      },
      // Set dueAt on the structure being built.
      dueAt: { lt: now },
      // Run next step: ...taskScope,
      ...taskScope,
    };
    // Capture where for use in this scope.
    const where: Prisma.CleaningTaskWhereInput = {
      // Run next step: ...baseWhere,
      ...baseWhere,
      // Run next step: ...(cursor
      ...(cursor
        // Complete the ternary or optional chain started above.
        ? {
            // Set OR on the structure being built.
            OR: [
              // Run next step: { dueAt: { gt: cursor.at } },
              { dueAt: { gt: cursor.at } },
              // Run next step: { dueAt: cursor.at, id: { gt: cursor.id } },
              { dueAt: cursor.at, id: { gt: cursor.id } },
            ],
          }
        // Complete the ternary or optional chain started above.
        : {}),
    };
    // Load value asynchronously for the next steps.
    const [rows, total] = await Promise.all([
      // Persist or query via Prisma for durable state.
      prisma.cleaningTask.findMany({
        // Run next step: where,
        where,
        // Set include on the structure being built.
        include: taskListInclude,
        // Set orderBy on the structure being built.
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        // Set take on the structure being built.
        take: limit,
      }),
      // Persist or query via Prisma for durable state.
      prisma.cleaningTask.count({ where: baseWhere }),
    ]);
    // Capture items for use in this scope.
    const items = rows.map((t) => taskToNeed(t, "past_due"));
    // Capture last for use in this scope.
    const last = rows[rows.length - 1];
    // Return the computed result to the caller.
    return {
      // Set kind on the structure being built.
      kind: input.kind,
      // Run next step: items,
      items,
      // Run next step: total,
      total,
      // Set returned on the structure being built.
      returned: items.length,
      // Set hasMore on the structure being built.
      hasMore: rows.length === limit,
      // Set nextCursor on the structure being built.
      nextCursor:
        // Run next step: last && last.dueAt ? encodeCursor(last.dueAt, last.id) : nul…
        last && last.dueAt ? encodeCursor(last.dueAt, last.id) : null,
    };
  }

  // Capture base ticket where for use in this scope.
  const baseTicketWhere: Prisma.MaintenanceTicketWhereInput = {
    // Set blocksRoom on the structure being built.
    blocksRoom: true,
    // Set status on the structure being built.
    status: { in: [...OPEN_TICKET_STATUSES] },
    // Run next step: ...ticketScope,
    ...ticketScope,
  };
  // Capture ticket where for use in this scope.
  const ticketWhere: Prisma.MaintenanceTicketWhereInput = {
    // Run next step: ...baseTicketWhere,
    ...baseTicketWhere,
    // Run next step: ...(cursor
    ...(cursor
      // Complete the ternary or optional chain started above.
      ? {
          // Set OR on the structure being built.
          OR: [
            // Run next step: { openedAt: { gt: cursor.at } },
            { openedAt: { gt: cursor.at } },
            // Run next step: { openedAt: cursor.at, id: { gt: cursor.id } },
            { openedAt: cursor.at, id: { gt: cursor.id } },
          ],
        }
      // Complete the ternary or optional chain started above.
      : {}),
  };
  // Load value asynchronously for the next steps.
  const [tickets, total] = await Promise.all([
    // Persist or query via Prisma for durable state.
    prisma.maintenanceTicket.findMany({
      // Set where on the structure being built.
      where: ticketWhere,
      // Set include on the structure being built.
      include: {
        // Set location on the structure being built.
        location: { include: locationInclude },
        // Set assignee on the structure being built.
        assignee: true,
      },
      // Set orderBy on the structure being built.
      orderBy: [{ priority: "desc" }, { openedAt: "asc" }, { id: "asc" }],
      // Set take on the structure being built.
      take: limit,
    }),
    // Persist or query via Prisma for durable state.
    prisma.maintenanceTicket.count({ where: baseTicketWhere }),
  ]);
  // Capture blocking meta for use in this scope.
  const blockingMeta = ATTENTION_KIND_META.blocking_ticket;
  // Capture items for use in this scope.
  const items: NeedsItem[] = tickets.map((ticket) => ({
    // Set kind on the structure being built.
    kind: "blocking_ticket",
    // Set id on the structure being built.
    id: ticket.id,
    // Set titleKey on the structure being built.
    titleKey: blockingMeta.titleKey,
    // Set title on the structure being built.
    title: ticket.title,
    // Set location on the structure being built.
    location: locationPayload(ticket.location),
    // Set employee on the structure being built.
    employee: ticket.assignee ? employeePayload(ticket.assignee) : null,
    // Set dueAt on the structure being built.
    dueAt: ticket.dueAt?.toISOString() ?? null,
    // Set priority on the structure being built.
    priority: ticket.priority,
    // Set status on the structure being built.
    status: ticket.status,
  }));
  // Capture last for use in this scope.
  const last = tickets[tickets.length - 1];
  // Return the computed result to the caller.
  return {
    // Set kind on the structure being built.
    kind: input.kind,
    // Run next step: items,
    items,
    // Run next step: total,
    total,
    // Set returned on the structure being built.
    returned: items.length,
    // Set hasMore on the structure being built.
    hasMore: tickets.length === limit,
    // Set nextCursor on the structure being built.
    nextCursor: last ? encodeCursor(last.openedAt, last.id) : null,
  };
}
