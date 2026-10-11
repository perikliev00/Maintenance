import { CleaningStatus } from "@prisma/client";
import { assertTaskOwnsCleaningCycle } from "./cycles";
import { lockLocation, type Tx } from "./locks";

/**
 * Apply location cleaningStatus only when the task owns the current cycle.
 * When requireCurrent is true, mismatch throws 409 stale_cleaning_cycle.
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
  if (opts?.requireCurrent) {
    await assertTaskOwnsCleaningCycle(tx, locationId, taskCleaningCycle);
  } else {
    await lockLocation(tx, locationId);
    const location = await tx.location.findUniqueOrThrow({
      where: { id: locationId },
    });
    if (location.cleaningCycle !== taskCleaningCycle) {
      return false;
    }
    if (
      opts?.onlyIfStatus !== undefined &&
      location.cleaningStatus !== opts.onlyIfStatus
    ) {
      return false;
    }
    await tx.location.update({
      where: { id: locationId },
      data: { cleaningStatus },
    });
    return true;
  }

  const location = await tx.location.findUniqueOrThrow({
    where: { id: locationId },
  });
  if (
    opts?.onlyIfStatus !== undefined &&
    location.cleaningStatus !== opts.onlyIfStatus
  ) {
    return false;
  }
  await tx.location.update({
    where: { id: locationId },
    data: { cleaningStatus },
  });
  return true;
}
