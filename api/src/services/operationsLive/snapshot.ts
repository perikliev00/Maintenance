/**
 * Full operations live snapshot assembly.
 */
import {
  Prisma,
  SessionStatus,
  TaskStatus,
} from "@prisma/client";
import { prisma } from "../../db";
import { OPEN_TICKET_STATUSES } from "../../constants";
import { getOperations } from "../settings";
import { LIVE_AUDIT_ACTIONS } from "../audit";
import {
  sessionAnomalyThresholdMinutes,
  sessionElapsedFlags,
} from "../analytics/sessionThresholds";
import { ATTENTION_KIND_META } from "../operationsLiveAttention";
import { taskToNeed } from "./attention";
import { encodeCursor } from "./cursors";
import {
  AUDIT_HOURS,
  AUDIT_LIMIT,
  AttentionPageMeta,
  employeePayload,
  locationInclude,
  locationPayload,
  NEEDS_ATTENTION_LIMIT,
  NeedsItem,
  RECENTLY_COMPLETED_MINUTES,
  taskListInclude,
} from "./dto";

type LiveScope = {
  task?: Prisma.CleaningTaskWhereInput;
  ticket?: Prisma.MaintenanceTicketWhereInput;
  session?: Prisma.CleaningSessionWhereInput;
  location?: Prisma.LocationWhereInput;
};

type LiveScopes = {
  taskScope: Prisma.CleaningTaskWhereInput;
  ticketScope: Prisma.MaintenanceTicketWhereInput;
  sessionScope: Prisma.CleaningSessionWhereInput;
  scopedLocationIds: string[] | null;
  nowDate: Date;
  recentCompletedSince: Date;
  auditSince: Date;
};

async function resolveLiveScopes(scopeWhere?: LiveScope): Promise<LiveScopes> {
  const now = Date.now();
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
  return {
    taskScope,
    ticketScope,
    sessionScope,
    scopedLocationIds,
    nowDate,
    recentCompletedSince: new Date(now - RECENTLY_COMPLETED_MINUTES * 60 * 1000),
    auditSince: new Date(now - AUDIT_HOURS * 60 * 60 * 1000),
  };
}

/** Parallel fan-out of the primary live board queries. */
async function loadLiveSlices(scopes: LiveScopes) {
  const {
    taskScope,
    ticketScope,
    sessionScope,
    scopedLocationIds,
    nowDate,
    recentCompletedSince,
    auditSince,
  } = scopes;

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

  return {
    runningSessions,
    recentlyCompletedRaw,
    awaitingTasks,
    pastDueTasks,
    blockingTickets,
    recentAuditEvents,
    awaitingInspectionTotal,
    pastDueTotal,
    blockingTicketsTotal,
    pastDueWorkWhere,
    awaitingWhere,
  };
}

/**
 * Parallel fan-out of live ops queries. Overdue = session elapsed ≥ configured
 * minutes; anomaly = 2× that threshold. Empty location scope means hotel-wide.
 */
export async function getOperationsLive(scopeWhere?: LiveScope) {
  const now = Date.now();
  const operations = await getOperations();
  const overdueThresholdMinutes = operations.overdueSessionMinutes;
  const anomalyThresholdMinutes = sessionAnomalyThresholdMinutes(
    overdueThresholdMinutes,
  );

  const scopes = await resolveLiveScopes(scopeWhere);
  const slices = await loadLiveSlices(scopes);
  const {
    runningSessions,
    recentlyCompletedRaw,
    awaitingTasks,
    pastDueTasks,
    blockingTickets,
    recentAuditEvents,
    awaitingInspectionTotal,
    pastDueTotal,
    blockingTicketsTotal,
  } = slices;

  const awaitingIds = new Set(awaitingTasks.map((t) => t.id));
  const pastDueInspectionWhere: Prisma.CleaningTaskWhereInput = {
    status: TaskStatus.awaiting_inspection,
    dueAt: { lt: scopes.nowDate },
    id: { notIn: [...awaitingIds] },
    ...scopes.taskScope,
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
    const { overdue, anomaly } = sessionElapsedFlags(
      elapsedMinutes,
      overdueThresholdMinutes,
    );
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
    pushNeed(taskToNeed(t, "past_due"));
  }

  const blockingMeta = ATTENTION_KIND_META.blocking_ticket;
  for (const ticket of blockingTickets) {
    pushNeed({
      kind: "blocking_ticket",
      id: ticket.id,
      titleKey: blockingMeta.titleKey,
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

  const auditFeed = recentAuditEvents.map((ev) => ({
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
