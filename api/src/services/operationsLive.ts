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
/** Cap per needs-attention source query. */
const NEEDS_ATTENTION_LIMIT = 50;

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
  // Flatten nested floor.building into buildingCode + floor number.
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
  // Strip unused employee columns from the live payload.
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
  // Snapshot clock used for elapsed/overdue and window cutoffs.
  const now = Date.now();
  // Overdue minutes from operations settings.
  const operations = await getOperations();
  const overdueThresholdMinutes = operations.overdueSessionMinutes;
  // Double the overdue window marks sessions as anomalies for supervisor triage.
  const anomalyThresholdMinutes = overdueThresholdMinutes * 2;

  // Completions within the last hour appear in the recent strip.
  const recentCompletedSince = new Date(
    now - RECENTLY_COMPLETED_MINUTES * 60 * 1000,
  );
  // Audit feed covers the last AUDIT_HOURS hours.
  const auditSince = new Date(now - AUDIT_HOURS * 60 * 60 * 1000);

  // Normalize optional data-scope fragments (empty object = hotel-wide).
  const taskScope: Prisma.CleaningTaskWhereInput = {
    AND: [scopeWhere?.task ?? {}, { location: { catalogStatus: "active" } }],
  };
  const ticketScope: Prisma.MaintenanceTicketWhereInput = {
    AND: [scopeWhere?.ticket ?? {}, { location: { catalogStatus: "active" } }],
  };
  const sessionScope: Prisma.CleaningSessionWhereInput = {
    AND: [scopeWhere?.session ?? {}, { task: { location: { catalogStatus: "active" } } }],
  };
  const locationScope = scopeWhere?.location ?? {};
  const hasLocationScope = Object.keys(locationScope).length > 0;

  // Resolve location ids once so the audit query can filter by locationId IN.
  const scopedLocationIds = hasLocationScope
    ? (
        await prisma.location.findMany({
          where: locationScope,
          select: { id: true },
        })
      ).map((l) => l.id)
    : null;

  // Fan-out the six live queries in parallel.
  const [
    runningSessions,
    recentlyCompletedRaw,
    awaitingTasks,
    pastDueTasks,
    blockingTickets,
    recentAuditEvents,
  ] = await Promise.all([
    // All currently running cleaning sessions (scoped).
    prisma.cleaningSession.findMany({
      where: { status: SessionStatus.running, ...sessionScope },
      include: {
        employee: true,
        task: { include: { location: { include: locationInclude } } },
      },
      orderBy: { startedAt: "asc" },
    }),
    // Recently finished sessions for the completions strip.
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
    // Tasks waiting on inspection (needs-attention source).
    prisma.cleaningTask.findMany({
      where: { status: TaskStatus.awaiting_inspection, ...taskScope },
      include: {
        location: { include: locationInclude },
        assignedEmployee: true,
      },
      orderBy: { updatedAt: "desc" },
      take: NEEDS_ATTENTION_LIMIT,
    }),
    // Active tasks past their dueAt (needs-attention source).
    prisma.cleaningTask.findMany({
      where: {
        status: {
          in: [
            TaskStatus.assigned,
            TaskStatus.in_progress,
            TaskStatus.awaiting_inspection,
            TaskStatus.rework,
          ],
        },
        dueAt: { lt: new Date(now) },
        ...taskScope,
      },
      include: {
        location: { include: locationInclude },
        assignedEmployee: true,
      },
      orderBy: { dueAt: "asc" },
      take: NEEDS_ATTENTION_LIMIT,
    }),
    // Open tickets that block rooms (needs-attention source).
    prisma.maintenanceTicket.findMany({
      where: {
        blocksRoom: true,
        status: { in: [...OPEN_TICKET_STATUSES] },
        ...ticketScope,
      },
      include: {
        location: { include: locationInclude },
        assignee: true,
      },
      orderBy: [{ priority: "desc" }, { openedAt: "asc" }],
      take: NEEDS_ATTENTION_LIMIT,
    }),
    // Recent ops-relevant audit events (optionally location-scoped).
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
  ]);

  // Map running sessions to DTOs with live overdue/anomaly flags.
  const activeSessions = runningSessions.map((s) => {
    // Elapsed whole minutes since session start (floor, not round).
    const elapsedMinutes = Math.floor(
      (now - s.startedAt.getTime()) / 60_000,
    );
    // Overdue once elapsed hits the configured operations threshold.
    const overdue = elapsedMinutes >= overdueThresholdMinutes;
    // Anomaly = 2× overdue threshold for supervisor triage.
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

  // Map recent completions with duration minutes.
  const recentlyCompleted = recentlyCompletedRaw.map((s) => {
    // finishedAt is non-null for completed sessions.
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

  type NeedsItem = {
    kind: "awaiting_inspection" | "past_due" | "blocking_ticket";
    id: string;
    title: string;
    location: ReturnType<typeof locationPayload>;
    employee: ReturnType<typeof employeePayload> | null;
    dueAt: string | null;
    priority: string | null;
    status: string;
  };

  // Accumulator for the needs-attention queue (capped sources above).
  const needsAttention: NeedsItem[] = [];
  // Deduplicate across awaiting / past-due / blocking sources.
  const seenKeys = new Set<string>();

  /** Deduplicate needs-attention rows by kind+id. */
  function pushNeed(item: NeedsItem) {
    const key = `${item.kind}:${item.id}`;
    // Skip if this kind+id was already pushed.
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    needsAttention.push(item);
  }

  // Inspection queue first (higher visual priority in the UI).
  for (const t of awaitingTasks) {
    pushNeed({
      kind: "awaiting_inspection",
      id: t.id,
      title: `Inspection needed · ${t.location.number}`,
      location: locationPayload(t.location),
      employee: t.assignedEmployee
        ? employeePayload(t.assignedEmployee)
        : null,
      dueAt: t.dueAt?.toISOString() ?? null,
      priority: t.priority,
      status: t.status,
    });
  }

  // Past-due active tasks; skip those already listed as awaiting_inspection.
  for (const t of pastDueTasks) {
    // Avoid duplicating pure awaiting_inspection rows already listed
    if (t.status === TaskStatus.awaiting_inspection) continue;
    pushNeed({
      kind: "past_due",
      id: t.id,
      title: `Past due · ${t.location.number}`,
      location: locationPayload(t.location),
      employee: t.assignedEmployee
        ? employeePayload(t.assignedEmployee)
        : null,
      dueAt: t.dueAt?.toISOString() ?? null,
      priority: t.priority,
      status: t.status,
    });
  }

  // Blocking open tickets last among needs-attention kinds.
  for (const ticket of blockingTickets) {
    pushNeed({
      kind: "blocking_ticket",
      id: ticket.id,
      title: ticket.title,
      location: locationPayload(ticket.location),
      employee: ticket.assignee ? employeePayload(ticket.assignee) : null,
      dueAt: ticket.dueAt?.toISOString() ?? null,
      priority: ticket.priority,
      status: ticket.status,
    });
  }

  // Resolve room numbers for audit rows that carry a locationId.
  const locationIds = [
    ...new Set(
      recentAuditEvents
        .map((e) => e.locationId)
        .filter((id): id is string => !!id),
    ),
  ];
  // Batch-load numbers so the feed can show room without N+1 queries.
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

  // Flatten audit events into the feed DTO with fallback summaries.
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

  // Aggregate banner counts from the mapped session DTOs.
  const overdueCount = activeSessions.filter((s) => s.overdue).length;
  const anomaliesCount = activeSessions.filter((s) => s.anomaly).length;

  return {
    updatedAt: new Date(now).toISOString(),
    overdueThresholdMinutes,
    anomalyThresholdMinutes,
    activeSessions,
    recentlyCompleted,
    needsAttention,
    auditFeed,
    counts: {
      active: activeSessions.length,
      overdue: overdueCount,
      anomalies: anomaliesCount,
      awaitingInspection: awaitingTasks.length,
      blockingTickets: blockingTickets.length,
    },
  };
}
