/**
 * Operations live dashboard snapshot: running sessions, needs-attention queue,
 * recent completions, and a short audit feed — optionally scoped by data access.
 */
import {
  Prisma,
  SessionStatus,
  TaskStatus,
} from "@prisma/client";
import { prisma } from "../db";
import { OPEN_TICKET_STATUSES } from "../constants";
import { getOperations } from "./settings";
import { LIVE_AUDIT_ACTIONS } from "./audit";

/** Completions strip window (minutes). */
const RECENTLY_COMPLETED_MINUTES = 60;
/** Audit feed lookback (hours). */
const AUDIT_HOURS = 24;
/** Max audit rows in the live feed. */
const AUDIT_LIMIT = 40;
/** Cap per needs-attention source query / page. */
export const NEEDS_ATTENTION_LIMIT = 50;

export type NeedsAttentionKind =
  | "awaiting_inspection"
  | "past_due"
  | "blocking_ticket";

/**
 * Compact location DTO for live cards (building + floor flattened).
 * Avoids shipping full floor/building joins to the ops dashboard.
 */
function locationPayload(location: {
  id: string;
  number: string;
  kind: string;
  floor: { number: number; building: { code: string } };
}) {
  return {
    id: location.id,
    number: location.number,
    kind: location.kind,
    buildingCode: location.floor.building.code,
    floor: location.floor.number,
  };
}

/**
 * Compact employee DTO for live cards.
 * Same shape used for session assignees and needs-attention rows.
 */
function employeePayload(employee: {
  id: string;
  fullName: string;
  employeeNumber: string;
}) {
  return {
    id: employee.id,
    fullName: employee.fullName,
    employeeNumber: employee.employeeNumber,
  };
}

/** Nested floor/building include shared by session/task/ticket live queries. */
const locationInclude = {
  floor: { include: { building: true } },
} as const;

const taskListInclude = {
  location: { include: locationInclude },
  assignedEmployee: true,
} as const;

type NeedsItem = {
  kind: NeedsAttentionKind;
  id: string;
  /** Stable i18n key; client localizes. Free-text ticket titles use "custom". */
  titleKey: "inspection_needed" | "past_due" | "custom";
  title: string;
  location: ReturnType<typeof locationPayload>;
  employee: ReturnType<typeof employeePayload> | null;
  dueAt: string | null;
  priority: string | null;
  status: string;
};

type AttentionPageMeta = {
  total: number;
  returned: number;
  hasMore: boolean;
  nextCursor: string | null;
};

function encodeCursor(dueOrUpdatedAt: Date, id: string): string {
  return `${dueOrUpdatedAt.toISOString()}|${id}`;
}

function decodeCursor(cursor: string | null | undefined): {
  at: Date;
  id: string;
} | null {
  if (!cursor) return null;
  const sep = cursor.indexOf("|");
  if (sep <= 0) return null;
  const at = new Date(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (Number.isNaN(at.getTime()) || !id) return null;
  return { at, id };
}

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
  return {
    kind,
    id: t.id,
    titleKey: kind === "awaiting_inspection" ? "inspection_needed" : "past_due",
    // Keep a stable EN fallback for older clients; UI prefers titleKey.
    title:
      kind === "awaiting_inspection" ? "Inspection needed" : "Past due",
    location: locationPayload(t.location),
    employee: t.assignedEmployee
      ? employeePayload(t.assignedEmployee)
      : null,
    dueAt: t.dueAt?.toISOString() ?? null,
    priority: t.priority,
    status: t.status,
  };
}

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
    // Past-due work plus overdue inspections (so load-more can surface
    // inspections that missed the newest-N awaiting page).
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

  // blocking_ticket
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
  const items: NeedsItem[] = tickets.map((ticket) => ({
    kind: "blocking_ticket",
    id: ticket.id,
    titleKey: "custom",
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

/**
 * Parallel fan-out of live ops queries. Overdue = session elapsed ≥ configured
 * minutes; anomaly = 2× that threshold. Empty location scope means hotel-wide.
 */
export async function getOperationsLive(scopeWhere?: {
  task?: Prisma.CleaningTaskWhereInput;
  ticket?: Prisma.MaintenanceTicketWhereInput;
  session?: Prisma.CleaningSessionWhereInput;
  location?: Prisma.LocationWhereInput;
}) {
  const now = Date.now();
  const operations = await getOperations();
  const overdueThresholdMinutes = operations.overdueSessionMinutes;
  const anomalyThresholdMinutes = overdueThresholdMinutes * 2;

  const recentCompletedSince = new Date(
    now - RECENTLY_COMPLETED_MINUTES * 60 * 1000,
  );
  const auditSince = new Date(now - AUDIT_HOURS * 60 * 60 * 1000);
  const nowDate = new Date(now);

  const taskScope: Prisma.CleaningTaskWhereInput = {
    AND: [scopeWhere?.task ?? {}, { location: { catalogStatus: "active" } }],
  };
  const ticketScope: Prisma.MaintenanceTicketWhereInput = {
    AND: [scopeWhere?.ticket ?? {}, { location: { catalogStatus: "active" } }],
  };
  const sessionScope: Prisma.CleaningSessionWhereInput = {
    AND: [
      scopeWhere?.session ?? {},
      { task: { location: { catalogStatus: "active" } } },
    ],
  };
  const locationScope = scopeWhere?.location ?? {};
  const hasLocationScope = Object.keys(locationScope).length > 0;

  const scopedLocationIds = hasLocationScope
    ? (
        await prisma.location.findMany({
          where: locationScope,
          select: { id: true },
        })
      ).map((l) => l.id)
    : null;

  const awaitingWhere: Prisma.CleaningTaskWhereInput = {
    status: TaskStatus.awaiting_inspection,
    ...taskScope,
  };
  const pastDueWorkWhere: Prisma.CleaningTaskWhereInput = {
    status: {
      in: [TaskStatus.assigned, TaskStatus.in_progress, TaskStatus.rework],
    },
    dueAt: { lt: nowDate },
    ...taskScope,
  };
  const blockingWhere: Prisma.MaintenanceTicketWhereInput = {
    blocksRoom: true,
    status: { in: [...OPEN_TICKET_STATUSES] },
    ...ticketScope,
  };

  const [
    runningSessions,
    recentlyCompletedRaw,
    awaitingTasks,
    pastDueTasks,
    blockingTickets,
    recentAuditEvents,
    awaitingInspectionTotal,
    pastDueTotal,
    blockingTicketsTotal,
  ] = await Promise.all([
    prisma.cleaningSession.findMany({
      where: { status: SessionStatus.running, ...sessionScope },
      include: {
        employee: true,
        task: { include: { location: { include: locationInclude } } },
      },
      orderBy: { startedAt: "asc" },
    }),
    prisma.cleaningSession.findMany({
      where: {
        status: SessionStatus.completed,
        finishedAt: { gte: recentCompletedSince },
        ...sessionScope,
      },
      include: {
        employee: true,
        task: { include: { location: { include: locationInclude } } },
      },
      orderBy: { finishedAt: "desc" },
      take: 40,
    }),
    prisma.cleaningTask.findMany({
      where: awaitingWhere,
      include: taskListInclude,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: NEEDS_ATTENTION_LIMIT,
    }),
    // Past-due assigned/in_progress/rework only — never consume slots with inspections.
    prisma.cleaningTask.findMany({
      where: pastDueWorkWhere,
      include: taskListInclude,
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: NEEDS_ATTENTION_LIMIT,
    }),
    prisma.maintenanceTicket.findMany({
      where: blockingWhere,
      include: {
        location: { include: locationInclude },
        assignee: true,
      },
      orderBy: [{ priority: "desc" }, { openedAt: "asc" }, { id: "asc" }],
      take: NEEDS_ATTENTION_LIMIT,
    }),
    prisma.auditEvent.findMany({
      where: {
        occurredAt: { gte: auditSince },
        AND: [
          {
            OR: [
              { action: { in: [...LIVE_AUDIT_ACTIONS] } },
              { locationId: { not: null } },
            ],
          },
          scopedLocationIds
            ? {
                locationId: {
                  in:
                    scopedLocationIds.length > 0
                      ? scopedLocationIds
                      : ["__none__"],
                },
              }
            : {},
        ],
      },
      include: {
        actor: {
          select: { id: true, fullName: true, employeeNumber: true },
        },
      },
      orderBy: { occurredAt: "desc" },
      take: AUDIT_LIMIT,
    }),
    prisma.cleaningTask.count({ where: awaitingWhere }),
    prisma.cleaningTask.count({ where: pastDueWorkWhere }),
    prisma.maintenanceTicket.count({ where: blockingWhere }),
  ]);

  // Past-due inspections outside the newest-N inspection page get a dedicated
  // quota (not stolen from / blocked by a full past-due work page).
  const awaitingIds = new Set(awaitingTasks.map((t) => t.id));
  const pastDueInspectionWhere: Prisma.CleaningTaskWhereInput = {
    status: TaskStatus.awaiting_inspection,
    dueAt: { lt: nowDate },
    id: { notIn: [...awaitingIds] },
    ...taskScope,
  };
  const [pastDueInspectionOverflow, pastDueInspectionOverflowTotal] =
    await Promise.all([
      prisma.cleaningTask.findMany({
        where: pastDueInspectionWhere,
        include: taskListInclude,
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        take: NEEDS_ATTENTION_LIMIT,
      }),
      prisma.cleaningTask.count({ where: pastDueInspectionWhere }),
    ]);

  const activeSessions = runningSessions.map((s) => {
    const elapsedMinutes = Math.floor(
      (now - s.startedAt.getTime()) / 60_000,
    );
    const overdue = elapsedMinutes >= overdueThresholdMinutes;
    const anomaly = elapsedMinutes >= anomalyThresholdMinutes;
    return {
      sessionId: s.id,
      taskId: s.taskId,
      startedAt: s.startedAt.toISOString(),
      elapsedMinutes,
      overdue,
      anomaly,
      employee: employeePayload(s.employee),
      location: locationPayload(s.task.location),
    };
  });

  const recentlyCompleted = recentlyCompletedRaw.map((s) => {
    const finishedAt = s.finishedAt!;
    const durationMinutes = Math.floor(
      (finishedAt.getTime() - s.startedAt.getTime()) / 60_000,
    );
    return {
      sessionId: s.id,
      taskId: s.taskId,
      startedAt: s.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMinutes,
      employee: employeePayload(s.employee),
      location: locationPayload(s.task.location),
    };
  });

  const needsAttention: NeedsItem[] = [];
  const seenKeys = new Set<string>();

  function pushNeed(item: NeedsItem) {
    const key = `${item.kind}:${item.id}`;
    if (seenKeys.has(key)) return;
    // Also prevent the same task id appearing as both inspection and past_due.
    if (item.kind === "past_due" && seenKeys.has(`awaiting_inspection:${item.id}`)) {
      return;
    }
    if (
      item.kind === "awaiting_inspection" &&
      seenKeys.has(`past_due:${item.id}`)
    ) {
      return;
    }
    seenKeys.add(key);
    needsAttention.push(item);
  }

  for (const t of awaitingTasks) {
    pushNeed(taskToNeed(t, "awaiting_inspection"));
  }
  for (const t of pastDueTasks) {
    pushNeed(taskToNeed(t, "past_due"));
  }
  for (const t of pastDueInspectionOverflow) {
    // Visible overdue inspections that missed the inspection page.
    pushNeed(taskToNeed(t, "past_due"));
  }

  for (const ticket of blockingTickets) {
    pushNeed({
      kind: "blocking_ticket",
      id: ticket.id,
      titleKey: "custom",
      title: ticket.title,
      location: locationPayload(ticket.location),
      employee: ticket.assignee ? employeePayload(ticket.assignee) : null,
      dueAt: ticket.dueAt?.toISOString() ?? null,
      priority: ticket.priority,
      status: ticket.status,
    });
  }

  const locationIds = [
    ...new Set(
      recentAuditEvents
        .map((e) => e.locationId)
        .filter((id): id is string => !!id),
    ),
  ];
  const locationsById = new Map(
    (
      await prisma.location.findMany({
        where: { id: { in: locationIds } },
        select: { id: true, number: true },
      })
    ).map((l) => [l.id, l.number]),
  );

  type AuditItem = {
    at: string;
    type: string;
    summary: string;
    locationNumber: string | null;
    entityId: string;
    actorName: string | null;
  };

  const auditFeed: AuditItem[] = recentAuditEvents.map((ev) => ({
    at: ev.occurredAt.toISOString(),
    type: ev.action,
    summary:
      ev.summary ||
      `${ev.actor?.fullName ?? "System"} · ${ev.action} · ${ev.entityType}`,
    locationNumber: ev.locationId
      ? locationsById.get(ev.locationId) ?? null
      : null,
    entityId: ev.entityId,
    actorName: ev.actor?.fullName ?? null,
  }));

  const overdueCount = activeSessions.filter((s) => s.overdue).length;
  const anomaliesCount = activeSessions.filter((s) => s.anomaly).length;

  const awaitingLast = awaitingTasks[awaitingTasks.length - 1];
  const pastDueLast = pastDueTasks[pastDueTasks.length - 1];
  const blockingLast = blockingTickets[blockingTickets.length - 1];

  const attention: {
    awaitingInspection: AttentionPageMeta;
    pastDue: AttentionPageMeta;
    blockingTickets: AttentionPageMeta;
  } = {
    awaitingInspection: {
      total: awaitingInspectionTotal,
      returned: awaitingTasks.length,
      hasMore: awaitingTasks.length < awaitingInspectionTotal,
      nextCursor: awaitingLast
        ? encodeCursor(awaitingLast.updatedAt, awaitingLast.id)
        : null,
    },
    pastDue: (() => {
      const overflowReturned = pastDueInspectionOverflow.length;
      const workReturned = pastDueTasks.length;
      const total = pastDueTotal + pastDueInspectionOverflowTotal;
      const returned = workReturned + overflowReturned;
      const overflowLast =
        pastDueInspectionOverflow[pastDueInspectionOverflow.length - 1];
      // Prefer continuing the earlier overdue-inspection slice so remaining
      // overflow is not skipped when work rows have later dueAt values.
      let nextCursor: string | null = null;
      if (overflowReturned < pastDueInspectionOverflowTotal && overflowLast?.dueAt) {
        nextCursor = encodeCursor(overflowLast.dueAt, overflowLast.id);
      } else if (workReturned < pastDueTotal && pastDueLast?.dueAt) {
        nextCursor = encodeCursor(pastDueLast.dueAt, pastDueLast.id);
      }
      return {
        total,
        returned,
        hasMore: returned < total,
        nextCursor,
      };
    })(),
    blockingTickets: {
      total: blockingTicketsTotal,
      returned: blockingTickets.length,
      hasMore: blockingTickets.length < blockingTicketsTotal,
      nextCursor: blockingLast
        ? encodeCursor(blockingLast.openedAt, blockingLast.id)
        : null,
    },
  };

  return {
    updatedAt: new Date(now).toISOString(),
    overdueThresholdMinutes,
    anomalyThresholdMinutes,
    activeSessions,
    recentlyCompleted,
    needsAttention,
    attention,
    auditFeed,
    counts: {
      active: activeSessions.length,
      overdue: overdueCount,
      anomalies: anomaliesCount,
      awaitingInspection: awaitingInspectionTotal,
      blockingTickets: blockingTicketsTotal,
    },
  };
}
