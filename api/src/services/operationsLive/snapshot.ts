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

// Declare type LiveScope for callers and internals.
type LiveScope = {
  task?: Prisma.CleaningTaskWhereInput;
  ticket?: Prisma.MaintenanceTicketWhereInput;
  session?: Prisma.CleaningSessionWhereInput;
  location?: Prisma.LocationWhereInput;
};

// Declare type LiveScopes for callers and internals.
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
  // Capture now date for use in this scope.
  const nowDate = new Date(now);
  // Capture task scope for use in this scope.
  const taskScope: Prisma.CleaningTaskWhereInput = {
    AND: [scopeWhere?.task ?? {}, { location: { catalogStatus: "active" } }],
  };
  // Capture ticket scope for use in this scope.
  const ticketScope: Prisma.MaintenanceTicketWhereInput = {
    AND: [scopeWhere?.ticket ?? {}, { location: { catalogStatus: "active" } }],
  };
  // Capture session scope for use in this scope.
  const sessionScope: Prisma.CleaningSessionWhereInput = {
    AND: [
      scopeWhere?.session ?? {},
      { task: { location: { catalogStatus: "active" } } },
    ],
  };
  // Capture location scope for use in this scope.
  const locationScope = scopeWhere?.location ?? {};
  // Capture has location scope for use in this scope.
  const hasLocationScope = Object.keys(locationScope).length > 0;
  // Capture scoped location ids for use in this scope.
  const scopedLocationIds = hasLocationScope
    // Complete the ternary or optional chain started above.
    ? (
        await prisma.location.findMany({
          where: locationScope,
          select: { id: true },
        })
      ).map((l) => l.id)
    // Complete the ternary or optional chain started above.
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

  // Capture awaiting where for use in this scope.
  const awaitingWhere: Prisma.CleaningTaskWhereInput = {
    status: TaskStatus.awaiting_inspection,
    ...taskScope,
  };
  // Capture past due work where for use in this scope.
  const pastDueWorkWhere: Prisma.CleaningTaskWhereInput = {
    status: {
      in: [TaskStatus.assigned, TaskStatus.in_progress, TaskStatus.rework],
    },
    dueAt: { lt: nowDate },
    ...taskScope,
  };
  // Capture blocking where for use in this scope.
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
    // Persist or query via Prisma for durable state.
    prisma.cleaningSession.findMany({
      where: { status: SessionStatus.running, ...sessionScope },
      include: {
        employee: true,
        task: { include: { location: { include: locationInclude } } },
      },
      orderBy: { startedAt: "asc" },
    }),
    // Persist or query via Prisma for durable state.
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
    // Persist or query via Prisma for durable state.
    prisma.cleaningTask.findMany({
      where: awaitingWhere,
      include: taskListInclude,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: NEEDS_ATTENTION_LIMIT,
    }),
    // Persist or query via Prisma for durable state.
    prisma.cleaningTask.findMany({
      where: pastDueWorkWhere,
      include: taskListInclude,
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: NEEDS_ATTENTION_LIMIT,
    }),
    // Persist or query via Prisma for durable state.
    prisma.maintenanceTicket.findMany({
      where: blockingWhere,
      include: {
        location: { include: locationInclude },
        assignee: true,
      },
      orderBy: [{ priority: "desc" }, { openedAt: "asc" }, { id: "asc" }],
      take: NEEDS_ATTENTION_LIMIT,
    }),
    // Persist or query via Prisma for durable state.
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
            // Complete the ternary or optional chain started above.
            ? {
                locationId: {
                  in:
                    scopedLocationIds.length > 0
                      // Complete the ternary or optional chain started above.
                      ? scopedLocationIds
                      // Complete the ternary or optional chain started above.
                      : ["__none__"],
                },
              }
            // Complete the ternary or optional chain started above.
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
    // Persist or query via Prisma for durable state.
    prisma.cleaningTask.count({ where: awaitingWhere }),
    // Persist or query via Prisma for durable state.
    prisma.cleaningTask.count({ where: pastDueWorkWhere }),
    // Persist or query via Prisma for durable state.
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
  // Capture overdue threshold minutes for use in this scope.
  const overdueThresholdMinutes = operations.overdueSessionMinutes;
  // Capture anomaly threshold minutes for use in this scope.
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

  // Capture awaiting ids for use in this scope.
  const awaitingIds = new Set(awaitingTasks.map((t) => t.id));
  // Capture past due inspection where for use in this scope.
  const pastDueInspectionWhere: Prisma.CleaningTaskWhereInput = {
    status: TaskStatus.awaiting_inspection,
    dueAt: { lt: scopes.nowDate },
    id: { notIn: [...awaitingIds] },
    ...scopes.taskScope,
  };
  const [pastDueInspectionOverflow, pastDueInspectionOverflowTotal] =
    await Promise.all([
      // Persist or query via Prisma for durable state.
      prisma.cleaningTask.findMany({
        where: pastDueInspectionWhere,
        include: taskListInclude,
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        take: NEEDS_ATTENTION_LIMIT,
      }),
      // Persist or query via Prisma for durable state.
      prisma.cleaningTask.count({ where: pastDueInspectionWhere }),
    ]);

  // Capture active sessions for use in this scope.
  const activeSessions = runningSessions.map((s) => {
    // Capture elapsed minutes for use in this scope.
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

  // Capture recently completed for use in this scope.
  const recentlyCompleted = recentlyCompletedRaw.map((s) => {
    // Capture finished at for use in this scope.
    const finishedAt = s.finishedAt!;
    // Capture duration minutes for use in this scope.
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

  // Capture needs attention for use in this scope.
  const needsAttention: NeedsItem[] = [];
  // Capture seen keys for use in this scope.
  const seenKeys = new Set<string>();

  function pushNeed(item: NeedsItem) {
    const key = `${item.kind}:${item.id}`;
    if (seenKeys.has(key)) return;
    if (item.kind === "past_due" && seenKeys.has(`awaiting_inspection:${item.id}`)) {
      // Exit early; nothing more to do on this path.
      return;
    }
    if (
      item.kind === "awaiting_inspection" &&
      seenKeys.has(`past_due:${item.id}`)
    ) {
      // Exit early; nothing more to do on this path.
      return;
    }
    seenKeys.add(key);
    // Append an entry to the accumulating collection.
    needsAttention.push(item);
  }

  // Iterate items to apply the same logic to each entry.
  for (const t of awaitingTasks) {
    pushNeed(taskToNeed(t, "awaiting_inspection"));
  }
  // Iterate items to apply the same logic to each entry.
  for (const t of pastDueTasks) {
    pushNeed(taskToNeed(t, "past_due"));
  }
  // Iterate items to apply the same logic to each entry.
  for (const t of pastDueInspectionOverflow) {
    pushNeed(taskToNeed(t, "past_due"));
  }

  // Capture blocking meta for use in this scope.
  const blockingMeta = ATTENTION_KIND_META.blocking_ticket;
  // Iterate items to apply the same logic to each entry.
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

  // Collect location ids list for later processing.
  const locationIds = [
    ...new Set(
      recentAuditEvents
        // Continue the chained call from the previous expression.
        .map((e) => e.locationId)
        // Continue the chained call from the previous expression.
        .filter((id): id is string => !!id),
    ),
  ];
  // Capture locations by id for use in this scope.
  const locationsById = new Map(
    (
      await prisma.location.findMany({
        where: { id: { in: locationIds } },
        select: { id: true, number: true },
      })
    ).map((l) => [l.id, l.number]),
  );

  // Capture audit feed for use in this scope.
  const auditFeed = recentAuditEvents.map((ev) => ({
    at: ev.occurredAt.toISOString(),
    type: ev.action,
    summary:
      ev.summary ||
      `${ev.actor?.fullName ?? "System"} · ${ev.action} · ${ev.entityType}`,
    locationNumber: ev.locationId
      // Complete the ternary or optional chain started above.
      ? locationsById.get(ev.locationId) ?? null
      // Complete the ternary or optional chain started above.
      : null,
    entityId: ev.entityId,
    actorName: ev.actor?.fullName ?? null,
  }));

  // Capture overdue count for use in this scope.
  const overdueCount = activeSessions.filter((s) => s.overdue).length;
  // Capture anomalies count for use in this scope.
  const anomaliesCount = activeSessions.filter((s) => s.anomaly).length;

  // Capture awaiting last for use in this scope.
  const awaitingLast = awaitingTasks[awaitingTasks.length - 1];
  // Capture past due last for use in this scope.
  const pastDueLast = pastDueTasks[pastDueTasks.length - 1];
  // Capture blocking last for use in this scope.
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
        // Complete the ternary or optional chain started above.
        ? encodeCursor(awaitingLast.updatedAt, awaitingLast.id)
        // Complete the ternary or optional chain started above.
        : null,
    },
    pastDue: (() => {
      // Capture overflow returned for use in this scope.
      const overflowReturned = pastDueInspectionOverflow.length;
      // Capture work returned for use in this scope.
      const workReturned = pastDueTasks.length;
      const total = pastDueTotal + pastDueInspectionOverflowTotal;
      const returned = workReturned + overflowReturned;
      // Capture overflow last for use in this scope.
      const overflowLast =
        pastDueInspectionOverflow[pastDueInspectionOverflow.length - 1];
      // Capture next cursor for use in this scope.
      let nextCursor: string | null = null;
      if (overflowReturned < pastDueInspectionOverflowTotal && overflowLast?.dueAt) {
        // Update next cursor as control flow progresses.
        nextCursor = encodeCursor(overflowLast.dueAt, overflowLast.id);
      } else if (workReturned < pastDueTotal && pastDueLast?.dueAt) {
        // Update next cursor as control flow progresses.
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
        // Complete the ternary or optional chain started above.
        ? encodeCursor(blockingLast.openedAt, blockingLast.id)
        // Complete the ternary or optional chain started above.
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
