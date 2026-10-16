/**
 * Apply location.cleaningStatus only when the task still owns the cleaning cycle.
 */
import { CleaningStatus } from "@prisma/client";
import { assertTaskOwnsCleaningCycle } from "./cycles";
import { lockLocation, type Tx } from "./locks";

/**
 * Apply location cleaningStatus only when the task owns the current cycle.
 * When requireCurrent is true, mismatch throws 409 stale_cleaning_cycle.
 * Soft path returns false on cycle/status mismatch instead of throwing.
 */
export async function applyLocationCleaningStatusIfCurrent(
  tx: Tx,
  locationId: string,
  taskCleaningCycle: number,
  cleaningStatus: CleaningStatus,
  opts?: {
    requireCurrent?: boolean;
    onlyIfStatus?: CleaningStatus;
  },
): Promise<boolean> {
  // Strict path: throw 409 when the task no longer owns the location cycle.
  if (opts?.requireCurrent) {
    await assertTaskOwnsCleaningCycle(tx, locationId, taskCleaningCycle);
  } else {
    // Soft path: lock, then return false on cycle/status mismatch (no throw).
    await lockLocation(tx, locationId);
    // Reload location under the lock for cycle/status checks.
    const location = await tx.location.findUniqueOrThrow({
      where: { id: locationId },
    });
    // Cycle moved on — another task owns the room; skip the status write.
    if (location.cleaningCycle !== taskCleaningCycle) {
      return false;
    }
    // Optional: only transition when current status matches the expected from-state.
    if (
      opts?.onlyIfStatus !== undefined &&
      location.cleaningStatus !== opts.onlyIfStatus
    ) {
      return false;
    }
    // Soft path succeeded — write the new cleaningStatus.
    await tx.location.update({
      where: { id: locationId },
      data: { cleaningStatus },
    });
    return true;
  }

  // After assertTaskOwnsCleaningCycle the location is already locked.
  const location = await tx.location.findUniqueOrThrow({
    where: { id: locationId },
  });
  // Optional guard: only transition from a specific current cleaningStatus.
  if (
    opts?.onlyIfStatus !== undefined &&
    location.cleaningStatus !== opts.onlyIfStatus
  ) {
    return false;
  }
  // Strict path: cycle ownership asserted — apply the status update.
  await tx.location.update({
    where: { id: locationId },
    data: { cleaningStatus },
  });
  return true;
}
