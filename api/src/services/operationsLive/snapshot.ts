/**
 * Full operations live snapshot assembly.
 */
import {
  // Run next step: Prisma,
  Prisma,
  // Run next step: SessionStatus,
  SessionStatus,
  // Run next step: TaskStatus,
  TaskStatus,
// Run next step: } from "@prisma/client";
} from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../constants for this service.
import { OPEN_TICKET_STATUSES } from "../../constants";
// Import module ../settings for this service.
import { getOperations } from "../settings";
// Import module ../audit for this service.
import { LIVE_AUDIT_ACTIONS } from "../audit";
// Import module dependency for this service.
import {
  // Run next step: sessionAnomalyThresholdMinutes,
  sessionAnomalyThresholdMinutes,
  // Run next step: sessionElapsedFlags,
  sessionElapsedFlags,
// Run next step: } from "../analytics/sessionThresholds";
} from "../analytics/sessionThresholds";
// Import module ../operationsLiveAttention for this service.
import { ATTENTION_KIND_META } from "../operationsLiveAttention";
// Import module ./attention for this service.
import { taskToNeed } from "./attention";
// Import module ./cursors for this service.
import { encodeCursor } from "./cursors";
// Import module dependency for this service.
import {
  // Run next step: AUDIT_HOURS,
  AUDIT_HOURS,
  // Run next step: AUDIT_LIMIT,
  AUDIT_LIMIT,
  // Run next step: AttentionPageMeta,
  AttentionPageMeta,
  // Run next step: employeePayload,
  employeePayload,
  // Run next step: locationInclude,
  locationInclude,
  // Run next step: locationPayload,
  locationPayload,
  // Run next step: NEEDS_ATTENTION_LIMIT,
  NEEDS_ATTENTION_LIMIT,
  // Run next step: NeedsItem,
  NeedsItem,
  // Run next step: RECENTLY_COMPLETED_MINUTES,
  RECENTLY_COMPLETED_MINUTES,
  // Run next step: taskListInclude,
  taskListInclude,
// Run next step: } from "./dto";
} from "./dto";

// Declare type LiveScope for callers and internals.
type LiveScope = {
  // Run next step: task?: Prisma.CleaningTaskWhereInput;
  task?: Prisma.CleaningTaskWhereInput;
  // Run next step: ticket?: Prisma.MaintenanceTicketWhereInput;
  ticket?: Prisma.MaintenanceTicketWhereInput;
  // Run next step: session?: Prisma.CleaningSessionWhereInput;
  session?: Prisma.CleaningSessionWhereInput;
  // Run next step: location?: Prisma.LocationWhereInput;
  location?: Prisma.LocationWhereInput;
};

// Declare type LiveScopes for callers and internals.
type LiveScopes = {
  // Set taskScope on the structure being built.
  taskScope: Prisma.CleaningTaskWhereInput;
  // Set ticketScope on the structure being built.
  ticketScope: Prisma.MaintenanceTicketWhereInput;
  // Set sessionScope on the structure being built.
  sessionScope: Prisma.CleaningSessionWhereInput;
  // Set scopedLocationIds on the structure being built.
  scopedLocationIds: string[] | null;
  // Set nowDate on the structure being built.
  nowDate: Date;
  // Set recentCompletedSince on the structure being built.
  recentCompletedSince: Date;
  // Set auditSince on the structure being built.
  auditSince: Date;
};

// Define resolveLiveScopes — core behavior for this module.
async function resolveLiveScopes(scopeWhere?: LiveScope): Promise<LiveScopes> {
  // Capture now for use in this scope.
  const now = Date.now();
  // Capture now date for use in this scope.
  const nowDate = new Date(now);
  // Capture task scope for use in this scope.
  const taskScope: Prisma.CleaningTaskWhereInput = {
    // Set AND on the structure being built.
    AND: [scopeWhere?.task ?? {}, { location: { catalogStatus: "active" } }],
  };
  // Capture ticket scope for use in this scope.
  const ticketScope: Prisma.MaintenanceTicketWhereInput = {
    // Set AND on the structure being built.
    AND: [scopeWhere?.ticket ?? {}, { location: { catalogStatus: "active" } }],
  };
  // Capture session scope for use in this scope.
  const sessionScope: Prisma.CleaningSessionWhereInput = {
    // Set AND on the structure being built.
    AND: [
      // Run next step: scopeWhere?.session ?? {},
      scopeWhere?.session ?? {},
      // Run next step: { task: { location: { catalogStatus: "active" } } },
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
        // Wait for the async step before continuing.
        await prisma.location.findMany({
          // Set where on the structure being built.
          where: locationScope,
          // Set select on the structure being built.
          select: { id: true },
        })
      // Run next step: ).map((l) => l.id)
      ).map((l) => l.id)
    // Complete the ternary or optional chain started above.
    : null;
  // Return the computed result to the caller.
  return {
    // Run next step: taskScope,
    taskScope,
    // Run next step: ticketScope,
    ticketScope,
    // Run next step: sessionScope,
    sessionScope,
    // Run next step: scopedLocationIds,
    scopedLocationIds,
    // Run next step: nowDate,
    nowDate,
    // Set recentCompletedSince on the structure being built.
    recentCompletedSince: new Date(now - RECENTLY_COMPLETED_MINUTES * 60 * 1000),
    // Set auditSince on the structure being built.
    auditSince: new Date(now - AUDIT_HOURS * 60 * 60 * 1000),
  };
}

/** Parallel fan-out of the primary live board queries. */
async function loadLiveSlices(scopes: LiveScopes) {
  // Destructure value fields needed locally.
  const {
    // Run next step: taskScope,
    taskScope,
    // Run next step: ticketScope,
    ticketScope,
    // Run next step: sessionScope,
    sessionScope,
    // Run next step: scopedLocationIds,
    scopedLocationIds,
    // Run next step: nowDate,
    nowDate,
    // Run next step: recentCompletedSince,
    recentCompletedSince,
    // Run next step: auditSince,
    auditSince,
  // Run next step: } = scopes;
  } = scopes;

  // Capture awaiting where for use in this scope.
  const awaitingWhere: Prisma.CleaningTaskWhereInput = {
    // Set status on the structure being built.
    status: TaskStatus.awaiting_inspection,
    // Run next step: ...taskScope,
    ...taskScope,
  };
  // Capture past due work where for use in this scope.
  const pastDueWorkWhere: Prisma.CleaningTaskWhereInput = {
    // Set status on the structure being built.
    status: {
      // Set in on the structure being built.
      in: [TaskStatus.assigned, TaskStatus.in_progress, TaskStatus.rework],
    },
    // Set dueAt on the structure being built.
    dueAt: { lt: nowDate },
    // Run next step: ...taskScope,
    ...taskScope,
  };
  // Capture blocking where for use in this scope.
  const blockingWhere: Prisma.MaintenanceTicketWhereInput = {
    // Set blocksRoom on the structure being built.
    blocksRoom: true,
    // Set status on the structure being built.
    status: { in: [...OPEN_TICKET_STATUSES] },
    // Run next step: ...ticketScope,
    ...ticketScope,
  };

  // Destructure value fields needed locally.
  const [
    // Run next step: runningSessions,
    runningSessions,
    // Run next step: recentlyCompletedRaw,
    recentlyCompletedRaw,
    // Run next step: awaitingTasks,
    awaitingTasks,
    // Run next step: pastDueTasks,
    pastDueTasks,
    // Run next step: blockingTickets,
    blockingTickets,
    // Run next step: recentAuditEvents,
    recentAuditEvents,
    // Run next step: awaitingInspectionTotal,
    awaitingInspectionTotal,
    // Run next step: pastDueTotal,
    pastDueTotal,
    // Run next step: blockingTicketsTotal,
    blockingTicketsTotal,
  // Run next step: ] = await Promise.all([
  ] = await Promise.all([
    // Persist or query via Prisma for durable state.
    prisma.cleaningSession.findMany({
      // Set where on the structure being built.
      where: { status: SessionStatus.running, ...sessionScope },
      // Set include on the structure being built.
      include: {
        // Set employee on the structure being built.
        employee: true,
        // Set task on the structure being built.
        task: { include: { location: { include: locationInclude } } },
      },
      // Set orderBy on the structure being built.
      orderBy: { startedAt: "asc" },
    }),
    // Persist or query via Prisma for durable state.
    prisma.cleaningSession.findMany({
      // Set where on the structure being built.
      where: {
        // Set status on the structure being built.
        status: SessionStatus.completed,
        // Set finishedAt on the structure being built.
        finishedAt: { gte: recentCompletedSince },
        // Run next step: ...sessionScope,
        ...sessionScope,
      },
      // Set include on the structure being built.
      include: {
        // Set employee on the structure being built.
        employee: true,
        // Set task on the structure being built.
        task: { include: { location: { include: locationInclude } } },
      },
      // Set orderBy on the structure being built.
      orderBy: { finishedAt: "desc" },
      // Set take on the structure being built.
      take: 40,
    }),
    // Persist or query via Prisma for durable state.
    prisma.cleaningTask.findMany({
      // Set where on the structure being built.
      where: awaitingWhere,
      // Set include on the structure being built.
      include: taskListInclude,
      // Set orderBy on the structure being built.
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      // Set take on the structure being built.
      take: NEEDS_ATTENTION_LIMIT,
    }),
    // Persist or query via Prisma for durable state.
    prisma.cleaningTask.findMany({
      // Set where on the structure being built.
      where: pastDueWorkWhere,
      // Set include on the structure being built.
      include: taskListInclude,
      // Set orderBy on the structure being built.
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      // Set take on the structure being built.
      take: NEEDS_ATTENTION_LIMIT,
    }),
    // Persist or query via Prisma for durable state.
    prisma.maintenanceTicket.findMany({
      // Set where on the structure being built.
      where: blockingWhere,
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
      take: NEEDS_ATTENTION_LIMIT,
    }),
    // Persist or query via Prisma for durable state.
    prisma.auditEvent.findMany({
      // Set where on the structure being built.
      where: {
        // Set occurredAt on the structure being built.
        occurredAt: { gte: auditSince },
        // Set AND on the structure being built.
        AND: [
          // Run next step: {
          {
            // Set OR on the structure being built.
            OR: [
              // Run next step: { action: { in: [...LIVE_AUDIT_ACTIONS] } },
              { action: { in: [...LIVE_AUDIT_ACTIONS] } },
              // Run next step: { locationId: { not: null } },
              { locationId: { not: null } },
            ],
          },
          // Run next step: scopedLocationIds
          scopedLocationIds
            // Complete the ternary or optional chain started above.
            ? {
                // Set locationId on the structure being built.
                locationId: {
                  // Set in on the structure being built.
                  in:
                    // Run next step: scopedLocationIds.length > 0
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
      // Set include on the structure being built.
      include: {
        // Set actor on the structure being built.
        actor: {
          // Set select on the structure being built.
          select: { id: true, fullName: true, employeeNumber: true },
        },
      },
      // Set orderBy on the structure being built.
      orderBy: { occurredAt: "desc" },
      // Set take on the structure being built.
      take: AUDIT_LIMIT,
    }),
    // Persist or query via Prisma for durable state.
    prisma.cleaningTask.count({ where: awaitingWhere }),
    // Persist or query via Prisma for durable state.
    prisma.cleaningTask.count({ where: pastDueWorkWhere }),
    // Persist or query via Prisma for durable state.
    prisma.maintenanceTicket.count({ where: blockingWhere }),
  ]);

  // Return the computed result to the caller.
  return {
    // Run next step: runningSessions,
    runningSessions,
    // Run next step: recentlyCompletedRaw,
    recentlyCompletedRaw,
    // Run next step: awaitingTasks,
    awaitingTasks,
    // Run next step: pastDueTasks,
    pastDueTasks,
    // Run next step: blockingTickets,
    blockingTickets,
    // Run next step: recentAuditEvents,
    recentAuditEvents,
    // Run next step: awaitingInspectionTotal,
    awaitingInspectionTotal,
    // Run next step: pastDueTotal,
    pastDueTotal,
    // Run next step: blockingTicketsTotal,
    blockingTicketsTotal,
    // Run next step: pastDueWorkWhere,
    pastDueWorkWhere,
    // Run next step: awaitingWhere,
    awaitingWhere,
  };
}

/**
 * Parallel fan-out of live ops queries. Overdue = session elapsed ≥ configured
 * minutes; anomaly = 2× that threshold. Empty location scope means hotel-wide.
 */
export async function getOperationsLive(scopeWhere?: LiveScope) {
  // Capture now for use in this scope.
  const now = Date.now();
  // Load operations asynchronously for the next steps.
  const operations = await getOperations();
  // Capture overdue threshold minutes for use in this scope.
  const overdueThresholdMinutes = operations.overdueSessionMinutes;
  // Capture anomaly threshold minutes for use in this scope.
  const anomalyThresholdMinutes = sessionAnomalyThresholdMinutes(
    // Run next step: overdueThresholdMinutes,
    overdueThresholdMinutes,
  );

  // Load scopes asynchronously for the next steps.
  const scopes = await resolveLiveScopes(scopeWhere);
  // Load slices asynchronously for the next steps.
  const slices = await loadLiveSlices(scopes);
  // Destructure value fields needed locally.
  const {
    // Run next step: runningSessions,
    runningSessions,
    // Run next step: recentlyCompletedRaw,
    recentlyCompletedRaw,
    // Run next step: awaitingTasks,
    awaitingTasks,
    // Run next step: pastDueTasks,
    pastDueTasks,
    // Run next step: blockingTickets,
    blockingTickets,
    // Run next step: recentAuditEvents,
    recentAuditEvents,
    // Run next step: awaitingInspectionTotal,
    awaitingInspectionTotal,
    // Run next step: pastDueTotal,
    pastDueTotal,
    // Run next step: blockingTicketsTotal,
    blockingTicketsTotal,
  // Run next step: } = slices;
  } = slices;

  // Capture awaiting ids for use in this scope.
  const awaitingIds = new Set(awaitingTasks.map((t) => t.id));
  // Capture past due inspection where for use in this scope.
  const pastDueInspectionWhere: Prisma.CleaningTaskWhereInput = {
    // Set status on the structure being built.
    status: TaskStatus.awaiting_inspection,
    // Set dueAt on the structure being built.
    dueAt: { lt: scopes.nowDate },
    // Set id on the structure being built.
    id: { notIn: [...awaitingIds] },
    // Run next step: ...scopes.taskScope,
    ...scopes.taskScope,
  };
  // Destructure value fields needed locally.
  const [pastDueInspectionOverflow, pastDueInspectionOverflowTotal] =
    // Wait for the async step before continuing.
    await Promise.all([
      // Persist or query via Prisma for durable state.
      prisma.cleaningTask.findMany({
        // Set where on the structure being built.
        where: pastDueInspectionWhere,
        // Set include on the structure being built.
        include: taskListInclude,
        // Set orderBy on the structure being built.
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        // Set take on the structure being built.
        take: NEEDS_ATTENTION_LIMIT,
      }),
      // Persist or query via Prisma for durable state.
      prisma.cleaningTask.count({ where: pastDueInspectionWhere }),
    ]);

  // Capture active sessions for use in this scope.
  const activeSessions = runningSessions.map((s) => {
    // Capture elapsed minutes for use in this scope.
    const elapsedMinutes = Math.floor(
      // Run next step: (now - s.startedAt.getTime()) / 60_000,
      (now - s.startedAt.getTime()) / 60_000,
    );
    // Destructure value fields needed locally.
    const { overdue, anomaly } = sessionElapsedFlags(
      // Run next step: elapsedMinutes,
      elapsedMinutes,
      // Run next step: overdueThresholdMinutes,
      overdueThresholdMinutes,
    );
    // Return the computed result to the caller.
    return {
      // Set sessionId on the structure being built.
      sessionId: s.id,
      // Set taskId on the structure being built.
      taskId: s.taskId,
      // Set startedAt on the structure being built.
      startedAt: s.startedAt.toISOString(),
      // Run next step: elapsedMinutes,
      elapsedMinutes,
      // Run next step: overdue,
      overdue,
      // Run next step: anomaly,
      anomaly,
      // Set employee on the structure being built.
      employee: employeePayload(s.employee),
      // Set location on the structure being built.
      location: locationPayload(s.task.location),
    };
  });

  // Capture recently completed for use in this scope.
  const recentlyCompleted = recentlyCompletedRaw.map((s) => {
    // Capture finished at for use in this scope.
    const finishedAt = s.finishedAt!;
    // Capture duration minutes for use in this scope.
    const durationMinutes = Math.floor(
      // Run next step: (finishedAt.getTime() - s.startedAt.getTime()) / 60_000,
      (finishedAt.getTime() - s.startedAt.getTime()) / 60_000,
    );
    // Return the computed result to the caller.
    return {
      // Set sessionId on the structure being built.
      sessionId: s.id,
      // Set taskId on the structure being built.
      taskId: s.taskId,
      // Set startedAt on the structure being built.
      startedAt: s.startedAt.toISOString(),
      // Set finishedAt on the structure being built.
      finishedAt: finishedAt.toISOString(),
      // Run next step: durationMinutes,
      durationMinutes,
      // Set employee on the structure being built.
      employee: employeePayload(s.employee),
      // Set location on the structure being built.
      location: locationPayload(s.task.location),
    };
  });

  // Capture needs attention for use in this scope.
  const needsAttention: NeedsItem[] = [];
  // Capture seen keys for use in this scope.
  const seenKeys = new Set<string>();

  // Define pushNeed — core behavior for this module.
  function pushNeed(item: NeedsItem) {
    // Capture key for use in this scope.
    const key = `${item.kind}:${item.id}`;
    // Branch when this condition holds so the right path runs.
    if (seenKeys.has(key)) return;
    // Branch when this condition holds so the right path runs.
    if (item.kind === "past_due" && seenKeys.has(`awaiting_inspection:${item.id}`)) {
      // Exit early; nothing more to do on this path.
      return;
    }
    // Branch when this condition holds so the right path runs.
    if (
      // Run next step: item.kind === "awaiting_inspection" &&
      item.kind === "awaiting_inspection" &&
      // Run next step: seenKeys.has(`past_due:${item.id}`)
      seenKeys.has(`past_due:${item.id}`)
    // Run next step: ) {
    ) {
      // Exit early; nothing more to do on this path.
      return;
    }
    // Run next step: seenKeys.add(key);
    seenKeys.add(key);
    // Append an entry to the accumulating collection.
    needsAttention.push(item);
  }

  // Iterate items to apply the same logic to each entry.
  for (const t of awaitingTasks) {
    // Run next step: pushNeed(taskToNeed(t, "awaiting_inspection"));
    pushNeed(taskToNeed(t, "awaiting_inspection"));
  }
  // Iterate items to apply the same logic to each entry.
  for (const t of pastDueTasks) {
    // Run next step: pushNeed(taskToNeed(t, "past_due"));
    pushNeed(taskToNeed(t, "past_due"));
  }
  // Iterate items to apply the same logic to each entry.
  for (const t of pastDueInspectionOverflow) {
    // Run next step: pushNeed(taskToNeed(t, "past_due"));
    pushNeed(taskToNeed(t, "past_due"));
  }

  // Capture blocking meta for use in this scope.
  const blockingMeta = ATTENTION_KIND_META.blocking_ticket;
  // Iterate items to apply the same logic to each entry.
  for (const ticket of blockingTickets) {
    // Run next step: pushNeed({
    pushNeed({
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
    });
  }

  // Collect location ids list for later processing.
  const locationIds = [
    // Run next step: ...new Set(
    ...new Set(
      // Run next step: recentAuditEvents
      recentAuditEvents
        // Continue the chained call from the previous expression.
        .map((e) => e.locationId)
        // Continue the chained call from the previous expression.
        .filter((id): id is string => !!id),
    ),
  ];
  // Capture locations by id for use in this scope.
  const locationsById = new Map(
    // Run next step: (
    (
      // Wait for the async step before continuing.
      await prisma.location.findMany({
        // Set where on the structure being built.
        where: { id: { in: locationIds } },
        // Set select on the structure being built.
        select: { id: true, number: true },
      })
    // Run next step: ).map((l) => [l.id, l.number]),
    ).map((l) => [l.id, l.number]),
  );

  // Capture audit feed for use in this scope.
  const auditFeed = recentAuditEvents.map((ev) => ({
    // Set at on the structure being built.
    at: ev.occurredAt.toISOString(),
    // Set type on the structure being built.
    type: ev.action,
    // Set summary on the structure being built.
    summary:
      // Run next step: ev.summary ||
      ev.summary ||
      // Run next step: `${ev.actor?.fullName ?? "System"} · ${ev.action} · ${ev.ent…
      `${ev.actor?.fullName ?? "System"} · ${ev.action} · ${ev.entityType}`,
    // Set locationNumber on the structure being built.
    locationNumber: ev.locationId
      // Complete the ternary or optional chain started above.
      ? locationsById.get(ev.locationId) ?? null
      // Complete the ternary or optional chain started above.
      : null,
    // Set entityId on the structure being built.
    entityId: ev.entityId,
    // Set actorName on the structure being built.
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

  // Capture attention for use in this scope.
  const attention: {
    // Set awaitingInspection on the structure being built.
    awaitingInspection: AttentionPageMeta;
    // Set pastDue on the structure being built.
    pastDue: AttentionPageMeta;
    // Set blockingTickets on the structure being built.
    blockingTickets: AttentionPageMeta;
  // Run next step: } = {
  } = {
    // Set awaitingInspection on the structure being built.
    awaitingInspection: {
      // Set total on the structure being built.
      total: awaitingInspectionTotal,
      // Set returned on the structure being built.
      returned: awaitingTasks.length,
      // Set hasMore on the structure being built.
      hasMore: awaitingTasks.length < awaitingInspectionTotal,
      // Set nextCursor on the structure being built.
      nextCursor: awaitingLast
        // Complete the ternary or optional chain started above.
        ? encodeCursor(awaitingLast.updatedAt, awaitingLast.id)
        // Complete the ternary or optional chain started above.
        : null,
    },
    // Set pastDue on the structure being built.
    pastDue: (() => {
      // Capture overflow returned for use in this scope.
      const overflowReturned = pastDueInspectionOverflow.length;
      // Capture work returned for use in this scope.
      const workReturned = pastDueTasks.length;
      // Capture total for use in this scope.
      const total = pastDueTotal + pastDueInspectionOverflowTotal;
      // Capture returned for use in this scope.
      const returned = workReturned + overflowReturned;
      // Capture overflow last for use in this scope.
      const overflowLast =
        // Run next step: pastDueInspectionOverflow[pastDueInspectionOverflow.length -…
        pastDueInspectionOverflow[pastDueInspectionOverflow.length - 1];
      // Capture next cursor for use in this scope.
      let nextCursor: string | null = null;
      // Branch when this condition holds so the right path runs.
      if (overflowReturned < pastDueInspectionOverflowTotal && overflowLast?.dueAt) {
        // Update next cursor as control flow progresses.
        nextCursor = encodeCursor(overflowLast.dueAt, overflowLast.id);
      // Run next step: } else if (workReturned < pastDueTotal && pastDueLast?.dueAt…
      } else if (workReturned < pastDueTotal && pastDueLast?.dueAt) {
        // Update next cursor as control flow progresses.
        nextCursor = encodeCursor(pastDueLast.dueAt, pastDueLast.id);
      }
      // Return the computed result to the caller.
      return {
        // Run next step: total,
        total,
        // Run next step: returned,
        returned,
        // Set hasMore on the structure being built.
        hasMore: returned < total,
        // Run next step: nextCursor,
        nextCursor,
      };
    // Run next step: })(),
    })(),
    // Set blockingTickets on the structure being built.
    blockingTickets: {
      // Set total on the structure being built.
      total: blockingTicketsTotal,
      // Set returned on the structure being built.
      returned: blockingTickets.length,
      // Set hasMore on the structure being built.
      hasMore: blockingTickets.length < blockingTicketsTotal,
      // Set nextCursor on the structure being built.
      nextCursor: blockingLast
        // Complete the ternary or optional chain started above.
        ? encodeCursor(blockingLast.openedAt, blockingLast.id)
        // Complete the ternary or optional chain started above.
        : null,
    },
  };

  // Return the computed result to the caller.
  return {
    // Set updatedAt on the structure being built.
    updatedAt: new Date(now).toISOString(),
    // Run next step: overdueThresholdMinutes,
    overdueThresholdMinutes,
    // Run next step: anomalyThresholdMinutes,
    anomalyThresholdMinutes,
    // Run next step: activeSessions,
    activeSessions,
    // Run next step: recentlyCompleted,
    recentlyCompleted,
    // Run next step: needsAttention,
    needsAttention,
    // Run next step: attention,
    attention,
    // Run next step: auditFeed,
    auditFeed,
    // Set counts on the structure being built.
    counts: {
      // Set active on the structure being built.
      active: activeSessions.length,
      // Set overdue on the structure being built.
      overdue: overdueCount,
      // Set anomalies on the structure being built.
      anomalies: anomaliesCount,
      // Set awaitingInspection on the structure being built.
      awaitingInspection: awaitingInspectionTotal,
      // Set blockingTickets on the structure being built.
      blockingTickets: blockingTicketsTotal,
    },
  };
}
