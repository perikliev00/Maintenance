import { CleaningStatus, Prisma, TaskStatus } from "@prisma/client";
import { AppError } from "../../errors";
import { todayHotelDateYmd } from "../hotelTime";
import { lockLocation, type Tx } from "./locks";

/** Active work that should keep owning the cycle after an intentional dirty bump. */
const REBINDABLE_TASK_STATUSES: TaskStatus[] = [
  TaskStatus.assigned,
  TaskStatus.in_progress,
  TaskStatus.rework,
];

/** Unbound cycle for planned future tasks — not yet activated on the location. */
export const UNBOUND_CLEANING_CYCLE = 0;

/** Hotel-date YMD from a Date column stored as UTC midnight. */
export function formatCleaningHotelDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** True when the task's hotel date is after today (hotel timezone YMD). */
export function isFutureHotelDate(hotelDate: Date, todayYmd: string): boolean {
  return formatCleaningHotelDate(hotelDate) > todayYmd;
}

/**
 * Resolve cleaningCycle for a newly created task.
 * Future hotel dates stay unbound (0) and do not bump location readiness.
 * Today/past allocates a new cycle and may mark dirty if clean/pending.
 */
export async function resolveCycleForNewTask(
  tx: Tx,
  locationId: string,
  hotelDate: Date,
  todayYmd?: string,
): Promise<number> {
  const today = todayYmd ?? (await todayHotelDateYmd());
  if (isFutureHotelDate(hotelDate, today)) {
    await lockLocation(tx, locationId);
    return UNBOUND_CLEANING_CYCLE;
  }
  return allocateCleaningCycle(tx, locationId, {
    setDirtyIfCleanOrPending: true,
  });
}

/**
 * Bind a task to a fresh location cleaning cycle at start when unbound or stale.
 * Rejects starting tasks whose hotelDate is still in the future.
 */
export async function ensureTaskCycleForStart(
  tx: Tx,
  task: { id: string; locationId: string; hotelDate: Date; cleaningCycle: number },
  todayYmd?: string,
): Promise<number> {
  const today = todayYmd ?? (await todayHotelDateYmd());
  if (isFutureHotelDate(task.hotelDate, today)) {
    throw new AppError(
      409,
      "invalid_state",
      "Cannot start a cleaning task before its hotel date",
    );
  }

  await lockLocation(tx, task.locationId);
  const location = await tx.location.findUniqueOrThrow({
    where: { id: task.locationId },
  });

  if (
    task.cleaningCycle !== UNBOUND_CLEANING_CYCLE &&
    task.cleaningCycle === location.cleaningCycle
  ) {
    return task.cleaningCycle;
  }

  const next = await allocateCleaningCycle(tx, task.locationId, {
    setDirtyIfCleanOrPending: true,
  });
  await tx.cleaningTask.update({
    where: { id: task.id },
    data: { cleaningCycle: next },
  });
  return next;
}

/**
 * Allocate a new cleaning cycle for a location (new task ownership).
 * Optionally force dirty, or dirty only when currently clean / pending inspection.
 */
export async function allocateCleaningCycle(
  tx: Tx,
  locationId: string,
  opts?: {
    forceDirty?: boolean;
    setDirtyIfCleanOrPending?: boolean;
    extra?: Prisma.LocationUpdateInput;
  },
): Promise<number> {
  await lockLocation(tx, locationId);
  const location = await tx.location.findUniqueOrThrow({
    where: { id: locationId },
  });
  const next = location.cleaningCycle + 1;
  const data: Prisma.LocationUpdateInput = {
    cleaningCycle: next,
    ...(opts?.extra ?? {}),
  };
  if (opts?.forceDirty) {
    data.cleaningStatus = CleaningStatus.dirty;
  } else if (
    opts?.setDirtyIfCleanOrPending &&
    (location.cleaningStatus === CleaningStatus.verified_clean ||
      location.cleaningStatus === CleaningStatus.pending_inspection)
  ) {
    data.cleaningStatus = CleaningStatus.dirty;
  }
  await tx.location.update({ where: { id: locationId }, data });
  return next;
}

/**
 * Mark dirty with a new cycle. Re-binds assigned/in_progress/rework tasks so
 * ongoing work can still update status; leaves awaiting_inspection on the old
 * cycle so a stale approve cannot restore verified_clean.
 */
export async function bumpDirtyAndRebindWork(
  tx: Tx,
  locationId: string,
  extra?: Prisma.LocationUpdateInput,
): Promise<number> {
  const next = await allocateCleaningCycle(tx, locationId, {
    forceDirty: true,
    extra,
  });
  await tx.cleaningTask.updateMany({
    where: {
      locationId,
      status: { in: REBINDABLE_TASK_STATUSES },
    },
    data: { cleaningCycle: next },
  });
  return next;
}

/**
 * Ensure the task owns the location's current cleaning cycle.
 * Locks the location. Throws 409 stale_cleaning_cycle on mismatch.
 */
export async function assertTaskOwnsCleaningCycle(
  tx: Tx,
  locationId: string,
  taskCleaningCycle: number,
): Promise<void> {
  await lockLocation(tx, locationId);
  const location = await tx.location.findUniqueOrThrow({
    where: { id: locationId },
  });
  if (location.cleaningCycle !== taskCleaningCycle) {
    throw new AppError(
      409,
      "stale_cleaning_cycle",
      "Cleaning task belongs to a superseded cleaning cycle",
    );
  }
}
