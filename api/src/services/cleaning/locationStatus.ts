/**
 * Apply location.cleaningStatus only when the task still owns the cleaning cycle.
 */
import { CleaningStatus } from "@prisma/client";
// Import ./cycles for cleaning/locationStatus.ts.
import { assertTaskOwnsCleaningCycle } from "./cycles";
// Import ./locks for cleaning/locationStatus.ts.
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
    // Parameter/field in the surrounding signature or type.
    requireCurrent?: boolean;
    // Parameter/field in the surrounding signature or type.
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
      // Restrict the query to the relevant rows only.
      where: { id: locationId },
    });
    // Cycle moved on — another task owns the room; skip the status write.
    if (location.cleaningCycle !== taskCleaningCycle) {
      // Early return of a terminal empty/boolean result.
      return false;
    }
    // Optional: only transition when current status matches the expected from-state.
    if (
      // Execute: opts?.onlyIfStatus !== undefined &&
      opts?.onlyIfStatus !== undefined &&
      // Execute: location.cleaningStatus !== opts.onlyIfStatus
      location.cleaningStatus !== opts.onlyIfStatus
    ) {
      // Early return of a terminal empty/boolean result.
      return false;
    }
    // Soft path succeeded — write the new cleaningStatus.
    await tx.location.update({
      // Restrict the query to the relevant rows only.
      where: { id: locationId },
      // Fields written by this create/update.
      data: { cleaningStatus },
    });
    // Early return of a terminal empty/boolean result.
    return true;
  }

  // After assertTaskOwnsCleaningCycle the location is already locked.
  const location = await tx.location.findUniqueOrThrow({
    // Restrict the query to the relevant rows only.
    where: { id: locationId },
  });
  // Optional guard: only transition from a specific current cleaningStatus.
  if (
    // Execute: opts?.onlyIfStatus !== undefined &&
    opts?.onlyIfStatus !== undefined &&
    // Execute: location.cleaningStatus !== opts.onlyIfStatus
    location.cleaningStatus !== opts.onlyIfStatus
  ) {
    // Early return of a terminal empty/boolean result.
    return false;
  }
  // Strict path: cycle ownership asserted — apply the status update.
  await tx.location.update({
    // Restrict the query to the relevant rows only.
    where: { id: locationId },
    // Fields written by this create/update.
    data: { cleaningStatus },
  });
  // Early return of a terminal empty/boolean result.
  return true;
}
