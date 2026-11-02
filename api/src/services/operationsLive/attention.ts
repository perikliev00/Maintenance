/**
 * Paginated needs-attention slices for the operations live board.
 */
import { Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "../../db";
import { OPEN_TICKET_STATUSES } from "../../constants";
import {
  ATTENTION_KIND_META,
  attentionTitleForKind,
  type NeedsAttentionKind,
} from "../operationsLiveAttention";
import { decodeCursor, encodeCursor } from "./cursors";
import {
  employeePayload,
  locationInclude,
  locationPayload,
  NEEDS_ATTENTION_LIMIT,
  taskListInclude,
  type NeedsItem,
} from "./dto";

function taskToNeed(
  t: {
    id: string;
    status: TaskStatus;
    dueAt: Date | null;
    priority: string;
    location: {
      id: string;
      number: string;
      kind: string;
      floor: { number: number; building: { code: string } };
    };
    assignedEmployee: {
      id: string;
      fullName: string;
      employeeNumber: string;
    } | null;
  },
  kind: "awaiting_inspection" | "past_due",
): NeedsItem {
  const titles = attentionTitleForKind(kind);
  return {
    kind,
    id: t.id,
    titleKey: titles.titleKey,
    title: titles.title,
    location: locationPayload(t.location),
    employee: t.assignedEmployee
      ? employeePayload(t.assignedEmployee)
      : null,
    dueAt: t.dueAt?.toISOString() ?? null,
    priority: t.priority,
    status: t.status,
  };
}

export { taskToNeed };

/**
 * Page of one needs-attention kind (cursor pagination). Used by the live board
 * "load more" path so totals stay accurate without unbounded first payloads.
 */
export async function getOperationsLiveAttentionPage(input: {
  kind: NeedsAttentionKind;
  cursor?: string | null;
  limit?: number;
  scopeWhere?: {
    task?: Prisma.CleaningTaskWhereInput;
    ticket?: Prisma.MaintenanceTicketWhereInput;
  };
}) {
  const limit = Math.min(
    Math.max(1, input.limit ?? NEEDS_ATTENTION_LIMIT),
    NEEDS_ATTENTION_LIMIT,
  );
  const now = new Date();
  const taskScope: Prisma.CleaningTaskWhereInput = {
    AND: [input.scopeWhere?.task ?? {}, { location: { catalogStatus: "active" } }],
  };
  const ticketScope: Prisma.MaintenanceTicketWhereInput = {
    AND: [
      input.scopeWhere?.ticket ?? {},
      { location: { catalogStatus: "active" } },
    ],
  };
  const cursor = decodeCursor(input.cursor);

  if (input.kind === "awaiting_inspection") {
    const where: Prisma.CleaningTaskWhereInput = {
      status: TaskStatus.awaiting_inspection,
      ...taskScope,
      ...(cursor
        ? {
            OR: [
              { updatedAt: { lt: cursor.at } },
              { updatedAt: cursor.at, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.cleaningTask.findMany({
        where,
        include: taskListInclude,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: limit,
      }),
      prisma.cleaningTask.count({
        where: { status: TaskStatus.awaiting_inspection, ...taskScope },
      }),
    ]);
    const items = rows.map((t) => taskToNeed(t, "awaiting_inspection"));
    const last = rows[rows.length - 1];
    return {
      kind: input.kind as NeedsAttentionKind,
      items,
      total,
      returned: items.length,
      hasMore: rows.length === limit,
      nextCursor: last ? encodeCursor(last.updatedAt, last.id) : null,
    };
  }

  if (input.kind === "past_due") {
    const baseWhere: Prisma.CleaningTaskWhereInput = {
      status: {
        in: [
          TaskStatus.assigned,
          TaskStatus.in_progress,
          TaskStatus.rework,
          TaskStatus.awaiting_inspection,
        ],
      },
      dueAt: { lt: now },
      ...taskScope,
    };
    const where: Prisma.CleaningTaskWhereInput = {
      ...baseWhere,
      ...(cursor
        ? {
            OR: [
              { dueAt: { gt: cursor.at } },
              { dueAt: cursor.at, id: { gt: cursor.id } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.cleaningTask.findMany({
        where,
        include: taskListInclude,
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        take: limit,
      }),
      prisma.cleaningTask.count({ where: baseWhere }),
    ]);
    const items = rows.map((t) => taskToNeed(t, "past_due"));
    const last = rows[rows.length - 1];
    return {
      kind: input.kind,
      items,
      total,
      returned: items.length,
      hasMore: rows.length === limit,
      nextCursor:
        last && last.dueAt ? encodeCursor(last.dueAt, last.id) : null,
    };
  }

  const baseTicketWhere: Prisma.MaintenanceTicketWhereInput = {
    blocksRoom: true,
    status: { in: [...OPEN_TICKET_STATUSES] },
    ...ticketScope,
  };
  const ticketWhere: Prisma.MaintenanceTicketWhereInput = {
    ...baseTicketWhere,
    ...(cursor
      ? {
          OR: [
            { openedAt: { gt: cursor.at } },
            { openedAt: cursor.at, id: { gt: cursor.id } },
          ],
        }
      : {}),
  };
  const [tickets, total] = await Promise.all([
    prisma.maintenanceTicket.findMany({
      where: ticketWhere,
      include: {
        location: { include: locationInclude },
        assignee: true,
      },
      orderBy: [{ priority: "desc" }, { openedAt: "asc" }, { id: "asc" }],
      take: limit,
    }),
    prisma.maintenanceTicket.count({ where: baseTicketWhere }),
  ]);
  const blockingMeta = ATTENTION_KIND_META.blocking_ticket;
  const items: NeedsItem[] = tickets.map((ticket) => ({
    kind: "blocking_ticket",
    id: ticket.id,
    titleKey: blockingMeta.titleKey,
    title: ticket.title,
    location: locationPayload(ticket.location),
    employee: ticket.assignee ? employeePayload(ticket.assignee) : null,
    dueAt: ticket.dueAt?.toISOString() ?? null,
    priority: ticket.priority,
    status: ticket.status,
  }));
  const last = tickets[tickets.length - 1];
  return {
    kind: input.kind,
    items,
    total,
    returned: items.length,
    hasMore: tickets.length === limit,
    nextCursor: last ? encodeCursor(last.openedAt, last.id) : null,
  };
}
