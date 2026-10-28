/**
 * Heal orphan location.cleaningStatus values that no longer match active work.
 * Decision helper is pure; persistence is lock + CAS only (never on GET).
 */
import { CleaningStatus, TaskStatus } from "@prisma/client";
import { ACTIVE_TASK_STATUSES } from "../../constants";
import { prisma } from "../../db";
import { lockLocation, type Tx } from "../cleaning/locks";

export type ActiveTaskSnapshot = {
  status: TaskStatus;
  hasRunningSession: boolean;
} | null;

/**
 * Decide the reconciled cleaning status for a location given its active task.
 * Returns null when no change is needed.
 *
 * Rules:
 * - in_progress requires an in_progress task with a running session
 * - pending_inspection requires an awaiting_inspection task
 * - otherwise heal toward dirty (or the status implied by the active task)
 */
export function resolveOrphanCleaningStatus(
  cleaningStatus: CleaningStatus,
  activeTask: ActiveTaskSnapshot,
): CleaningStatus | null {
  if (cleaningStatus === CleaningStatus.in_progress) {
    if (
      activeTask?.status === TaskStatus.in_progress &&
      activeTask.hasRunningSession
    ) {
      return null;
    }
    if (activeTask?.status === TaskStatus.awaiting_inspection) {
      return CleaningStatus.pending_inspection;
    }
    return CleaningStatus.dirty;
  }

  if (cleaningStatus === CleaningStatus.pending_inspection) {
    if (activeTask?.status === TaskStatus.awaiting_inspection) {
      return null;
    }
    if (
      activeTask?.status === TaskStatus.in_progress &&
      activeTask.hasRunningSession
    ) {
      return CleaningStatus.in_progress;
    }
    return CleaningStatus.dirty;
  }

  return null;
}

/**
 * Under an existing or new location lock, re-read active work and CAS-update
 * cleaningStatus only when the pre-heal status still matches.
 * Returns the new status when updated, or null when no write occurred.
 */
export async function reconcileOrphanCleaningStatusLocked(
  tx: Tx,
  locationId: string,
  opts?: { alreadyLocked?: boolean },
): Promise<CleaningStatus | null> {
  if (!opts?.alreadyLocked) {
    await lockLocation(tx, locationId);
  }

  const location = await tx.location.findUniqueOrThrow({
    where: { id: locationId },
    select: { id: true, cleaningStatus: true },
  });

  const activeTaskRow = await tx.cleaningTask.findFirst({
    where: {
      locationId,
      status: { in: ACTIVE_TASK_STATUSES },
    },
    orderBy: { createdAt: "desc" },
    select: {
      status: true,
      sessions: {
        where: { status: "running" },
        select: { id: true },
        take: 1,
      },
    },
  });

  const activeTask: ActiveTaskSnapshot = activeTaskRow
    ? {
        status: activeTaskRow.status,
        hasRunningSession: activeTaskRow.sessions.length > 0,
      }
    : null;

  const fromStatus = location.cleaningStatus;
  const next = resolveOrphanCleaningStatus(fromStatus, activeTask);
  if (!next || next === fromStatus) {
    return null;
  }

  // CAS: refuse to overwrite if another txn already changed cleaningStatus.
  const result = await tx.location.updateMany({
    where: { id: locationId, cleaningStatus: fromStatus },
    data: { cleaningStatus: next },
  });

  return result.count === 1 ? next : null;
}

/**
 * After a soft location-status apply returned false: heal orphans only when
 * this task still owns the location cycle (never stomp a newer cycle).
 * Caller must be inside the same transaction; re-locks safely.
 */
export async function healOrphanIfTaskCycleCurrent(
  tx: Tx,
  locationId: string,
  taskCleaningCycle: number,
): Promise<CleaningStatus | null> {
  await lockLocation(tx, locationId);
  const location = await tx.location.findUniqueOrThrow({
    where: { id: locationId },
    select: { cleaningCycle: true },
  });
  if (location.cleaningCycle !== taskCleaningCycle) {
    return null;
  }
  return reconcileOrphanCleaningStatusLocked(tx, locationId, {
    alreadyLocked: true,
  });
}

/**
 * Explicit reconcile entry for a single location (admin/ops mutation).
 * Opens its own transaction with lock + CAS.
 */
export async function reconcileOrphanCleaningStatusForLocation(
  locationId: string,
): Promise<{ updated: boolean; cleaningStatus: CleaningStatus }> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.location.findUniqueOrThrow({
      where: { id: locationId },
      select: { cleaningStatus: true },
    });
    const next = await reconcileOrphanCleaningStatusLocked(tx, locationId);
    return {
      updated: next != null,
      cleaningStatus: next ?? before.cleaningStatus,
    };
  });
}
