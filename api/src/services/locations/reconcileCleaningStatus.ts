/**
 * Heal orphan location.cleaningStatus values that no longer match active work.
 * Decision helper is pure; persistence is lock + CAS only (never on GET).
 */
import { CleaningStatus, TaskStatus } from "@prisma/client";
// Import module ../../constants for this service.
import { ACTIVE_TASK_STATUSES } from "../../constants";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../cleaning/locks for this service.
import { lockLocation, type Tx } from "../cleaning/locks";

// Declare type ActiveTaskSnapshot for callers and internals.
export type ActiveTaskSnapshot = {
  // Set status on the structure being built.
  status: TaskStatus;
  // Set hasRunningSession on the structure being built.
  hasRunningSession: boolean;
// Run next step: } | null;
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
  // Set cleaningStatus on the structure being built.
  cleaningStatus: CleaningStatus,
  // Set activeTask on the structure being built.
  activeTask: ActiveTaskSnapshot,
// Run next step: ): CleaningStatus | null {
): CleaningStatus | null {
  // Branch when this condition holds so the right path runs.
  if (cleaningStatus === CleaningStatus.in_progress) {
    // Branch when this condition holds so the right path runs.
    if (
      // Run next step: activeTask?.status === TaskStatus.in_progress &&
      activeTask?.status === TaskStatus.in_progress &&
      // Run next step: activeTask.hasRunningSession
      activeTask.hasRunningSession
    // Run next step: ) {
    ) {
      // Return the computed result to the caller.
      return null;
    }
    // Branch when this condition holds so the right path runs.
    if (activeTask?.status === TaskStatus.awaiting_inspection) {
      // Return the computed result to the caller.
      return CleaningStatus.pending_inspection;
    }
    // Return the computed result to the caller.
    return CleaningStatus.dirty;
  }

  // Branch when this condition holds so the right path runs.
  if (cleaningStatus === CleaningStatus.pending_inspection) {
    // Branch when this condition holds so the right path runs.
    if (activeTask?.status === TaskStatus.awaiting_inspection) {
      // Return the computed result to the caller.
      return null;
    }
    // Branch when this condition holds so the right path runs.
    if (
      // Run next step: activeTask?.status === TaskStatus.in_progress &&
      activeTask?.status === TaskStatus.in_progress &&
      // Run next step: activeTask.hasRunningSession
      activeTask.hasRunningSession
    // Run next step: ) {
    ) {
      // Return the computed result to the caller.
      return CleaningStatus.in_progress;
    }
    // Return the computed result to the caller.
    return CleaningStatus.dirty;
  }

  // Return the computed result to the caller.
  return null;
}

/**
 * Under an existing or new location lock, re-read active work and CAS-update
 * cleaningStatus only when the pre-heal status still matches.
 * Returns the new status when updated, or null when no write occurred.
 */
export async function reconcileOrphanCleaningStatusLocked(
  // Set tx on the structure being built.
  tx: Tx,
  // Set locationId on the structure being built.
  locationId: string,
  // Run next step: opts?: { alreadyLocked?: boolean },
  opts?: { alreadyLocked?: boolean },
// Run next step: ): Promise<CleaningStatus | null> {
): Promise<CleaningStatus | null> {
  // Branch when this condition holds so the right path runs.
  if (!opts?.alreadyLocked) {
    // Wait for the async step before continuing.
    await lockLocation(tx, locationId);
  }

  // Load location asynchronously for the next steps.
  const location = await tx.location.findUniqueOrThrow({
    // Set where on the structure being built.
    where: { id: locationId },
    // Set select on the structure being built.
    select: { id: true, cleaningStatus: true },
  });

  // Load active task row asynchronously for the next steps.
  const activeTaskRow = await tx.cleaningTask.findFirst({
    // Set where on the structure being built.
    where: {
      // Run next step: locationId,
      locationId,
      // Set status on the structure being built.
      status: { in: ACTIVE_TASK_STATUSES },
    },
    // Set orderBy on the structure being built.
    orderBy: { createdAt: "desc" },
    // Set select on the structure being built.
    select: {
      // Set status on the structure being built.
      status: true,
      // Set sessions on the structure being built.
      sessions: {
        // Set where on the structure being built.
        where: { status: "running" },
        // Set select on the structure being built.
        select: { id: true },
        // Set take on the structure being built.
        take: 1,
      },
    },
  });

  // Capture active task for use in this scope.
  const activeTask: ActiveTaskSnapshot = activeTaskRow
    // Complete the ternary or optional chain started above.
    ? {
        // Set status on the structure being built.
        status: activeTaskRow.status,
        // Set hasRunningSession on the structure being built.
        hasRunningSession: activeTaskRow.sessions.length > 0,
      }
    // Complete the ternary or optional chain started above.
    : null;

  // Capture from status for use in this scope.
  const fromStatus = location.cleaningStatus;
  // Capture next for use in this scope.
  const next = resolveOrphanCleaningStatus(fromStatus, activeTask);
  // Branch when this condition holds so the right path runs.
  if (!next || next === fromStatus) {
    // Return the computed result to the caller.
    return null;
  }

  // CAS: refuse to overwrite if another txn already changed cleaningStatus.
  const result = await tx.location.updateMany({
    // Set where on the structure being built.
    where: { id: locationId, cleaningStatus: fromStatus },
    // Set data on the structure being built.
    data: { cleaningStatus: next },
  });

  // Return the computed result to the caller.
  return result.count === 1 ? next : null;
}

/**
 * After a soft location-status apply returned false: heal orphans only when
 * this task still owns the location cycle (never stomp a newer cycle).
 * Caller must be inside the same transaction; re-locks safely.
 */
export async function healOrphanIfTaskCycleCurrent(
  // Set tx on the structure being built.
  tx: Tx,
  // Set locationId on the structure being built.
  locationId: string,
  // Set taskCleaningCycle on the structure being built.
  taskCleaningCycle: number,
// Run next step: ): Promise<CleaningStatus | null> {
): Promise<CleaningStatus | null> {
  // Wait for the async step before continuing.
  await lockLocation(tx, locationId);
  // Load location asynchronously for the next steps.
  const location = await tx.location.findUniqueOrThrow({
    // Set where on the structure being built.
    where: { id: locationId },
    // Set select on the structure being built.
    select: { cleaningCycle: true },
  });
  // Branch when this condition holds so the right path runs.
  if (location.cleaningCycle !== taskCleaningCycle) {
    // Return the computed result to the caller.
    return null;
  }
  // Return the computed result to the caller.
  return reconcileOrphanCleaningStatusLocked(tx, locationId, {
    // Set alreadyLocked on the structure being built.
    alreadyLocked: true,
  });
}

/**
 * Explicit reconcile entry for a single location (admin/ops mutation).
 * Opens its own transaction with lock + CAS.
 */
export async function reconcileOrphanCleaningStatusForLocation(
  // Set locationId on the structure being built.
  locationId: string,
// Run next step: ): Promise<{ updated: boolean; cleaningStatus: CleaningStatu…
): Promise<{ updated: boolean; cleaningStatus: CleaningStatus }> {
  // Return the computed result to the caller.
  return prisma.$transaction(async (tx) => {
    // Load before asynchronously for the next steps.
    const before = await tx.location.findUniqueOrThrow({
      // Set where on the structure being built.
      where: { id: locationId },
      // Set select on the structure being built.
      select: { cleaningStatus: true },
    });
    // Load next asynchronously for the next steps.
    const next = await reconcileOrphanCleaningStatusLocked(tx, locationId);
    // Return the computed result to the caller.
    return {
      // Set updated on the structure being built.
      updated: next != null,
      // Set cleaningStatus on the structure being built.
      cleaningStatus: next ?? before.cleaningStatus,
    };
  });
}
