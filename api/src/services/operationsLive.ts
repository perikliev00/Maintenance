import {
  Prisma,
  SessionStatus,
  TaskStatus,
} from "@prisma/client";
import { prisma } from "../db";
import { OPEN_TICKET_STATUSES } from "../constants";
import { getOperations } from "./settings";
import { LIVE_AUDIT_ACTIONS } from "./audit";

const RECENTLY_COMPLETED_MINUTES = 60;
const AUDIT_HOURS = 24;
const AUDIT_LIMIT = 40;
const NEEDS_ATTENTION_LIMIT = 50;

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

const locationInclude = {
  floor: { include: { building: true } },
} as const;

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

  const taskScope = scopeWhere?.task ?? {};
  const ticketScope = scopeWhere?.ticket ?? {};
  const sessionScope = scopeWhere?.session ?? {};
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

  const [
    runningSessions,
    recentlyCompletedRaw,
    awaitingTasks,
    pastDueTasks,
    blockingTickets,
    recentAuditEvents,
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
      where: { status: TaskStatus.awaiting_inspection, ...taskScope },
      include: {
        location: { include: locationInclude },
        assignedEmployee: true,
      },
      orderBy: { updatedAt: "desc" },
      take: NEEDS_ATTENTION_LIMIT,
    }),
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

  const needsAttention: NeedsItem[] = [];
  const seenKeys = new Set<string>();

  function pushNeed(item: NeedsItem) {
    const key = `${item.kind}:${item.id}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    needsAttention.push(item);
  }

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
