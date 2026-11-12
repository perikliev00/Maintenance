/**
 * Cleaning-cycle allocation and ownership for tasks vs location.cleaningCycle.
 */
import { CleaningStatus, Prisma, TaskStatus } from "@prisma/client";
// Import ../../errors for cleaning/cycles.ts.
import { AppError } from "../../errors";
// Import ../hotelTime for cleaning/cycles.ts.
import { formatHotelDate, todayHotelDateYmd } from "../hotelTime";
// Import ./locks for cleaning/cycles.ts.
import { lockLocation, type Tx } from "./locks";

/** Active work that should keep owning the cycle after an intentional dirty bump. */
const REBINDABLE_TASK_STATUSES: TaskStatus[] = [
  // Execute: TaskStatus.assigned,
  TaskStatus.assigned,
  // Execute: TaskStatus.in_progress,
  TaskStatus.in_progress,
  // Execute: TaskStatus.rework,
  TaskStatus.rework,
];

/** Unbound cycle for planned future tasks — not yet activated on the location. */
export const UNBOUND_CLEANING_CYCLE = 0;

/** Hotel-date YMD from a Date column stored as UTC midnight. */
export function formatCleaningHotelDate(d: Date): string {
  return formatHotelDate(d);
}

/** True when the task's hotel date is after today (hotel timezone YMD). */
export function isFutureHotelDate(hotelDate: Date, todayYmd: string): boolean {
  // String compare works for zero-padded YYYY-MM-DD.
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
  // Parameter/field in the surrounding signature or type.
  todayYmd?: string,
): Promise<number> {
  // Allow callers to pass today once when creating many tasks in a loop.
  const today = todayYmd ?? (await todayHotelDateYmd());
  // Future plans must not dirty the room or consume a cycle yet.
  if (isFutureHotelDate(hotelDate, today)) {
    await lockLocation(tx, locationId);
    return UNBOUND_CLEANING_CYCLE;
  }
  // Today/past: new cycle; dirty only if currently clean or pending inspection.
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
  // Parameter/field in the surrounding signature or type.
  todayYmd?: string,
): Promise<number> {
  // Load today needed for the next decision or write.
  const today = todayYmd ?? (await todayHotelDateYmd());
  // Block early starts of tomorrow's planned tasks.
  if (isFutureHotelDate(task.hotelDate, today)) {
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(
      // Execute: 409,
      409,
      // Execute: "invalid_state",
      "invalid_state",
      // Execute: "Cannot start a cleaning task before its hotel date",
      "Cannot start a cleaning task before its hotel date",
    );
  }

  await lockLocation(tx, task.locationId);
  // Load location needed for the next decision or write.
  const location = await tx.location.findUniqueOrThrow({
    // Restrict the query to the relevant rows only.
    where: { id: task.locationId },
  });

  // Already bound to the current location cycle — nothing to do.
  if (
    // Execute: task.cleaningCycle !== UNBOUND_CLEANING_CYCLE &&
    task.cleaningCycle !== UNBOUND_CLEANING_CYCLE &&
    // Execute: task.cleaningCycle === location.cleaningCycle
    task.cleaningCycle === location.cleaningCycle
  ) {
    return task.cleaningCycle;
  }

  // Unbound or stale: allocate a fresh cycle and stamp it onto the task.
  const next = await allocateCleaningCycle(tx, task.locationId, {
    setDirtyIfCleanOrPending: true,
  });
  // Persist the mutation inside the current transaction/context.
  await tx.cleaningTask.update({
    // Restrict the query to the relevant rows only.
    where: { id: task.id },
    // Fields written by this create/update.
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
    // Parameter/field in the surrounding signature or type.
    forceDirty?: boolean;
    // Parameter/field in the surrounding signature or type.
    setDirtyIfCleanOrPending?: boolean;
    // Parameter/field in the surrounding signature or type.
    extra?: Prisma.LocationUpdateInput;
  },
): Promise<number> {
  await lockLocation(tx, locationId);
  // Load location needed for the next decision or write.
  const location = await tx.location.findUniqueOrThrow({
    // Restrict the query to the relevant rows only.
    where: { id: locationId },
  });
  // Monotonic cycle id — supersedes any prior task ownership.
  const next = location.cleaningCycle + 1;
  const data: Prisma.LocationUpdateInput = {
    cleaningCycle: next,
    // Spread remaining fields without dropping caller data.
    ...(opts?.extra ?? {}),
  };
  // markRoomDirty / departure always force dirty.
  if (opts?.forceDirty) {
    // Execute: data.cleaningStatus = CleaningStatus.dirty;
    data.cleaningStatus = CleaningStatus.dirty;
  // Execute: } else if (
  } else if (
    // New work only dirties when the room looked clean or was waiting inspection.
    opts?.setDirtyIfCleanOrPending &&
    // Execute: (location.cleaningStatus === CleaningStatus.verified_clean ||
    (location.cleaningStatus === CleaningStatus.verified_clean ||
      // Execute: location.cleaningStatus === CleaningStatus.pending_inspection)
      location.cleaningStatus === CleaningStatus.pending_inspection)
  ) {
    // Execute: data.cleaningStatus = CleaningStatus.dirty;
    data.cleaningStatus = CleaningStatus.dirty;
  }
  // Persist the mutation inside the current transaction/context.
  await tx.location.update({ where: { id: locationId }, data });
  return next;
}

/**
 * Acquire rebindable CleaningTask rows then Location (same order as
 * {@link bumpDirtyAndRebindWork} / startCleaningTask) so callers can decide
 * under those locks before mutating.
 */
export async function lockRebindableTasksAndLocation(
  tx: Tx,
  locationId: string,
): Promise<void> {
  // Lock rebindable tasks before Location. startCleaningTask holds Task then
  // Location; acquiring Location first here deadlocks against that path.
  await tx.$queryRaw`
    SELECT id FROM "CleaningTask"
    WHERE "locationId" = ${locationId}
      AND status IN (
        'assigned'::"TaskStatus",
        'in_progress'::"TaskStatus",
        'rework'::"TaskStatus"
      )
    ORDER BY id
    FOR UPDATE
  `;
  await lockLocation(tx, locationId);
}

/**
 * Mark dirty with a new cycle. Re-binds assigned/in_progress/rework tasks so
 * ongoing work can still update status; leaves awaiting_inspection on the old
 * cycle so a stale approve cannot restore verified_clean.
 *
 * Pass `alreadyLocked: true` when the caller already held
 * {@link lockRebindableTasksAndLocation} for this location in `tx`.
 */
export async function bumpDirtyAndRebindWork(
  tx: Tx,
  locationId: string,
  // Parameter/field in the surrounding signature or type.
  extra?: Prisma.LocationUpdateInput,
  // Parameter/field in the surrounding signature or type.
  opts?: { alreadyLocked?: boolean },
): Promise<number> {
  // Guard: handle missing/invalid state before continuing.
  if (!opts?.alreadyLocked) {
    await lockRebindableTasksAndLocation(tx, locationId);
  }
  // New cycle + force dirty; `extra` may also set occupancy (departure path).
  // allocateCleaningCycle re-takes Location FOR UPDATE (safe when already held).
  const next = await allocateCleaningCycle(tx, locationId, {
    forceDirty: true,
    extra,
  });
  // Rebind active work so it can still mutate cleaningStatus on the new cycle.
  // awaiting_inspection stays on the old cycle (stale approve cannot re-verify).
  await tx.cleaningTask.updateMany({
    // Restrict the query to the relevant rows only.
    where: {
      locationId,
      status: { in: REBINDABLE_TASK_STATUSES },
    },
    // Fields written by this create/update.
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
  // Load location needed for the next decision or write.
  const location = await tx.location.findUniqueOrThrow({
    // Restrict the query to the relevant rows only.
    where: { id: locationId },
  });
  // Mismatch means a newer dirty bump superseded this task's cycle.
  if (location.cleaningCycle !== taskCleaningCycle) {
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(
      // Execute: 409,
      409,
      // Execute: "stale_cleaning_cycle",
      "stale_cleaning_cycle",
      // Execute: "Cleaning task belongs to a superseded cleaning cycle",
      "Cleaning task belongs to a superseded cleaning cycle",
    );
  }
}
