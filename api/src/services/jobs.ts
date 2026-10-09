import { Prisma, SessionStatus, TicketStatus } from "@prisma/client";
import { prisma } from "../db";
import { OPEN_TICKET_STATUSES } from "../constants";
import { getAccess, getOperations } from "./settings";
import { recordAudit } from "./audit";
import { publish } from "../events/bus";
import {
  createNotifications,
  recipientsForLocationOps,
} from "./notifications";
import { markStaleOpenIntervals } from "./attendance";

async function startJobRun(jobKey: string) {
  return prisma.jobRun.create({
    data: { jobKey, status: "running" },
  });
}

async function finishJobRun(
  id: string,
  status: "ok" | "error",
  summary?: Prisma.InputJsonValue,
  error?: string,
) {
  return prisma.jobRun.update({
    where: { id },
    data: {
      status,
      finishedAt: new Date(),
      summary: summary ?? undefined,
      error: error ?? null,
    },
  });
}

/** Latest non-null activity timestamp (max of dates — not nullish coalescing). */
export function latestActivityAt(
  dates: Array<Date | null | undefined>,
): Date {
  let latest: Date | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (!latest || d.getTime() > latest.getTime()) latest = d;
  }
  if (!latest) {
    throw new Error("latestActivityAt requires at least one date");
  }
  return latest;
}

export type LockInactiveActivityUser = {
  lastLoginAt: Date | null;
  activatedAt: Date | null;
  createdAt: Date;
  devices: { lastSeenAt: Date }[];
};

/** Established inactivity signals (AuthSession is intentionally excluded). */
export function activitySignalsOf(
  user: LockInactiveActivityUser,
): Array<Date | null | undefined> {
  return [
    user.lastLoginAt,
    user.devices[0]?.lastSeenAt,
    user.activatedAt,
    user.createdAt,
  ];
}

type LockInactiveClaimRow = LockInactiveActivityUser & {
  id: string;
  isActive: boolean;
};

/** DB surface needed to claim a single inactive-user lock. */
export type LockInactiveClaimDb = {
  user: {
    findUnique: (args: {
      where: { id: string };
      select: {
        id: true;
        isActive: true;
        lastLoginAt: true;
        activatedAt: true;
        createdAt: true;
        devices: {
          where: { revokedAt: null };
          orderBy: { lastSeenAt: "desc" };
          take: 1;
          select: { lastSeenAt: true };
        };
      };
    }) => Promise<LockInactiveClaimRow | null>;
    updateMany: (args: {
      where: {
        id: string;
        isActive: true;
        createdAt: { lte: Date };
        AND: [
          {
            OR: [
              { lastLoginAt: null },
              { lastLoginAt: { lte: Date } },
            ];
          },
          {
            OR: [
              { activatedAt: null },
              { activatedAt: { lte: Date } },
            ];
          },
          {
            devices: {
              none: {
                revokedAt: null;
                lastSeenAt: { gt: Date };
              };
            };
          },
        ];
      };
      data: { isActive: false };
    }) => Promise<{ count: number }>;
  };
};

export type LockInactiveClaimResult =
  | { claimed: false }
  | { claimed: true; lastActivity: Date };

/**
 * Re-read activity and lock only if the user is still idle at write time.
 * CAS updateMany refuses concurrent login/sync/activation after the snapshot.
 * @internal exported for unit tests with a fake DB
 */
export async function claimLockInactiveUser(
  db: LockInactiveClaimDb,
  userId: string,
  cutoff: Date,
): Promise<LockInactiveClaimResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isActive: true,
      lastLoginAt: true,
      activatedAt: true,
      createdAt: true,
      devices: {
        where: { revokedAt: null },
        orderBy: { lastSeenAt: "desc" },
        take: 1,
        select: { lastSeenAt: true },
      },
    },
  });
  if (!user || !user.isActive) return { claimed: false };

  const lastActivity = latestActivityAt(activitySignalsOf(user));
  if (lastActivity.getTime() > cutoff.getTime()) {
    return { claimed: false };
  }

  const result = await db.user.updateMany({
    where: {
      id: userId,
      isActive: true,
      createdAt: { lte: cutoff },
      AND: [
        {
          OR: [{ lastLoginAt: null }, { lastLoginAt: { lte: cutoff } }],
        },
        {
          OR: [{ activatedAt: null }, { activatedAt: { lte: cutoff } }],
        },
        {
          devices: {
            none: { revokedAt: null, lastSeenAt: { gt: cutoff } },
          },
        },
      ],
    },
    data: { isActive: false },
  });

  if (result.count === 0) return { claimed: false };
  return { claimed: true, lastActivity };
}

type LockInactiveCandidate = LockInactiveActivityUser & { id: string };

export type RunLockInactiveUsersDeps = {
  getAccess?: () => Promise<{
    lockInactiveUsers: boolean;
    sessionIdleDays: number;
  }>;
  findCandidates?: () => Promise<LockInactiveCandidate[]>;
  claimDb?: LockInactiveClaimDb;
  recordAudit?: typeof recordAudit;
  startJobRun?: (jobKey: string) => Promise<{ id: string }>;
  finishJobRun?: (
    id: string,
    status: "ok" | "error",
    summary?: Prisma.InputJsonValue,
    error?: string,
  ) => Promise<unknown>;
};

export async function runLockInactiveUsers(deps: RunLockInactiveUsersDeps = {}) {
  const accessFn = deps.getAccess ?? getAccess;
  const start = deps.startJobRun ?? startJobRun;
  const finish = deps.finishJobRun ?? finishJobRun;
  const audit = deps.recordAudit ?? recordAudit;
  const claimDb = deps.claimDb ?? prisma;
  const findCandidates =
    deps.findCandidates ??
    (() =>
      prisma.user.findMany({
        where: { isActive: true },
        include: {
          devices: {
            where: { revokedAt: null },
            orderBy: { lastSeenAt: "desc" },
            take: 1,
          },
        },
      }));

  const run = await start("lock_inactive_users");
  try {
    const access = await accessFn();
    if (!access.lockInactiveUsers) {
      await finish(run.id, "ok", { skipped: true, reason: "disabled" });
      return { locked: 0, skipped: true };
    }

    const cutoff = new Date(
      Date.now() - access.sessionIdleDays * 24 * 60 * 60 * 1000,
    );

    const candidates = await findCandidates();

    let locked = 0;
    for (const user of candidates) {
      const lastActivity = latestActivityAt(activitySignalsOf(user));
      if (lastActivity.getTime() > cutoff.getTime()) continue;

      const claim = await claimLockInactiveUser(claimDb, user.id, cutoff);
      if (!claim.claimed) continue;

      await audit({
        actorEmployeeId: null,
        action: "user.lock_inactive",
        entityType: "user",
        entityId: user.id,
        reason: `Idle beyond ${access.sessionIdleDays} days`,
        before: {
          isActive: true,
          lastActivity: claim.lastActivity.toISOString(),
        },
        after: { isActive: false },
      });
      locked += 1;
    }

    await finish(run.id, "ok", { locked, cutoff: cutoff.toISOString() });
    return { locked, skipped: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish(run.id, "error", undefined, message);
    throw err;
  }
}

export async function runOverdueSessions() {
  const run = await startJobRun("overdue_sessions");
  try {
    const operations = await getOperations();
    const cutoff = new Date(
      Date.now() - operations.overdueSessionMinutes * 60 * 1000,
    );

    const sessions = await prisma.cleaningSession.findMany({
      where: {
        status: SessionStatus.running,
        startedAt: { lte: cutoff },
      },
      select: {
        id: true,
        taskId: true,
        anomalyFlags: true,
        startedAt: true,
        employeeId: true,
        task: {
          select: {
            assignedEmployeeId: true,
            sectorSupervisorEmployeeId: true,
            locationId: true,
            location: { select: { number: true } },
          },
        },
      },
    });

    let flagged = 0;
    for (const session of sessions) {
      const flags = Array.isArray(session.anomalyFlags)
        ? (session.anomalyFlags as string[])
        : [];
      if (flags.includes("overdue")) continue;

      await prisma.cleaningSession.update({
        where: { id: session.id },
        data: {
          anomalyFlags: [...flags, "overdue"],
        },
      });
      await recordAudit({
        actorEmployeeId: null,
        action: "session.overdue_detected",
        entityType: "cleaning_session",
        entityId: session.id,
        after: {
          taskId: session.taskId,
          startedAt: session.startedAt.toISOString(),
          overdueMinutes: operations.overdueSessionMinutes,
        },
      });
      publish("cleaning.changed", { taskId: session.taskId });

      const recipients = [
        session.task.assignedEmployeeId,
        session.task.sectorSupervisorEmployeeId,
        session.employeeId,
      ].filter((id): id is string => Boolean(id));
      await createNotifications({
        type: "cleaning.session_overdue",
        title: "Cleaning session overdue",
        body: `Room ${session.task.location.number} session past due`,
        entityType: "cleaning_session",
        entityId: session.id,
        locationId: session.task.locationId,
        actorEmployeeId: null,
        recipientEmployeeIds: recipients,
        dedupeKey: `cleaning.session_overdue:${session.id}`,
        payload: {
          panel: "live",
          taskId: session.taskId,
          sessionId: session.id,
          locationId: session.task.locationId,
          locationNumber: session.task.location.number,
        },
      });

      flagged += 1;
    }

    await finishJobRun(run.id, "ok", {
      scanned: sessions.length,
      flagged,
      cutoff: cutoff.toISOString(),
    });
    return { scanned: sessions.length, flagged };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishJobRun(run.id, "error", undefined, message);
    throw err;
  }
}

export async function runTicketSlaBreach() {
  const run = await startJobRun("ticket_sla_breach");
  try {
    const now = new Date();
    const tickets = await prisma.maintenanceTicket.findMany({
      where: {
        status: { in: [...OPEN_TICKET_STATUSES] },
        dueAt: { lt: now },
        slaPausedAt: null,
      },
      select: {
        id: true,
        dueAt: true,
        status: true,
        locationId: true,
        title: true,
        assigneeId: true,
        location: { select: { number: true } },
      },
    });

    let notified = 0;
    for (const ticket of tickets) {
      const recent = await prisma.auditEvent.findFirst({
        where: {
          entityType: "maintenance_ticket",
          entityId: ticket.id,
          action: "ticket.sla_breach",
          occurredAt: { gte: new Date(now.getTime() - 12 * 60 * 60 * 1000) },
        },
        select: { id: true },
      });
      if (recent) continue;

      await recordAudit({
        actorEmployeeId: null,
        action: "ticket.sla_breach",
        entityType: "maintenance_ticket",
        entityId: ticket.id,
        after: {
          status: ticket.status,
          dueAt: ticket.dueAt?.toISOString() ?? null,
        },
      });
      publish("ticket.changed", {
        ticketId: ticket.id,
        locationId: ticket.locationId,
      });

      const supervisors = await recipientsForLocationOps(
        ticket.locationId,
        "tickets.assign",
      );
      const recipients = [
        ...(ticket.assigneeId ? [ticket.assigneeId] : []),
        ...supervisors,
      ];
      const result = await createNotifications({
        type: "ticket.sla_breach",
        title: "Ticket SLA breached",
        body: `${ticket.location.number}: ${ticket.title}`,
        entityType: "ticket",
        entityId: ticket.id,
        locationId: ticket.locationId,
        actorEmployeeId: null,
        recipientEmployeeIds: recipients,
        dedupeKey: `ticket.sla_breach:${ticket.id}:${now.toISOString().slice(0, 13)}`,
        payload: {
          panel: "repairs",
          ticketId: ticket.id,
          locationId: ticket.locationId,
          locationNumber: ticket.location.number,
        },
      });
      if (result.created > 0) notified += 1;
    }

    await finishJobRun(run.id, "ok", {
      breached: tickets.length,
      notified,
    });
    return { breached: tickets.length, notified };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishJobRun(run.id, "error", undefined, message);
    throw err;
  }
}

export async function runStaleOpenAttendance() {
  const run = await startJobRun("stale_open_attendance");
  try {
    const result = await markStaleOpenIntervals();
    await finishJobRun(run.id, "ok", result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishJobRun(run.id, "error", undefined, message);
    throw err;
  }
}

export async function runAllJobs() {
  const results: Record<string, unknown> = {};
  results.lock_inactive_users = await runLockInactiveUsers().catch((err) => ({
    error: err instanceof Error ? err.message : String(err),
  }));
  results.overdue_sessions = await runOverdueSessions().catch((err) => ({
    error: err instanceof Error ? err.message : String(err),
  }));
  results.ticket_sla_breach = await runTicketSlaBreach().catch((err) => ({
    error: err instanceof Error ? err.message : String(err),
  }));
  results.stale_open_attendance = await runStaleOpenAttendance().catch(
    (err) => ({
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  return results;
}

export async function listJobRuns(limit = 50) {
  return prisma.jobRun.findMany({
    orderBy: { startedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
  });
}

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

/** In-process scheduler — no Redis/Bull. */
export function startJobScheduler(intervalMs = 5 * 60 * 1000) {
  if (schedulerTimer) return;
  // Initial delay so boot + migrate settle
  setTimeout(() => {
    void runAllJobs().catch((err) =>
      console.warn("background jobs failed", err),
    );
  }, 15_000);
  schedulerTimer = setInterval(() => {
    void runAllJobs().catch((err) =>
      console.warn("background jobs failed", err),
    );
  }, intervalMs);
  schedulerTimer.unref?.();
}

export function stopJobScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
