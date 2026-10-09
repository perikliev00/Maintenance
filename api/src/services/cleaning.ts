import {
  CleaningServiceType,
  CleaningStatus,
  DailyPlanCategory,
  InspectionResult,
  LocationKind,
  Prisma,
  SessionStatus,
  TaskStatus,
} from "@prisma/client";
import { prisma } from "../db";
import { ACTIVE_TASK_STATUSES } from "../constants";
import { AppError } from "../errors";
import { todayHotelDateYmd } from "./hotelTime";
import { getFlags, getOperations } from "./settings";
import { publish } from "../events/bus";
import {
  sectorSnapshotForLocation,
  sectorSupervisorForSector,
} from "./dataScope";
import { recordAudit } from "./audit";
import {
  createNotifications,
  recipientsForLocationOps,
} from "./notifications";
import { assertActiveCleaningAssignee } from "./assignees";

export { AppError };

/** Resolve an active shift id, or null when clearing. */
async function resolveActiveShiftId(
  shiftId: string | null | undefined,
): Promise<string | null | undefined> {
  if (shiftId === undefined) return undefined;
  if (shiftId === null || shiftId === "") return null;
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) {
    throw new AppError(404, "not_found", "Shift not found");
  }
  if (!shift.isActive) {
    throw new AppError(400, "invalid_state", "Shift is inactive");
  }
  return shift.id;
}

/** Derive work type for comparable analytics (референция §6.1 / §9). */
export function deriveCleaningServiceType(input: {
  locationKind: LocationKind;
  serviceType?: CleaningServiceType;
  planCategory?: DailyPlanCategory;
}): CleaningServiceType {
  if (input.serviceType) return input.serviceType;
  if (input.locationKind !== LocationKind.room) {
    return CleaningServiceType.common_area;
  }
  if (input.planCategory === DailyPlanCategory.departure) {
    return CleaningServiceType.departure;
  }
  if (input.planCategory === DailyPlanCategory.arrival) {
    return CleaningServiceType.arrival;
  }
  return CleaningServiceType.stayover;
}

type Tx = Prisma.TransactionClient;

const taskInclude = {
  location: { include: { floor: { include: { building: true } } } },
  assignedEmployee: true,
  shift: {
    select: {
      id: true,
      code: true,
      nameBg: true,
      nameEn: true,
      startTime: true,
      endTime: true,
    },
  },
  sector: { select: { id: true, code: true, nameBg: true, nameEn: true } },
  sectorSupervisor: {
    select: { id: true, fullName: true, employeeNumber: true },
  },
  sessions: true,
  inspections: true,
} satisfies Prisma.CleaningTaskInclude;

function p2002Targets(err: Prisma.PrismaClientKnownRequestError): string[] {
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.map(String);
  if (typeof target === "string") return [target];
  return [];
}

function isP2002(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

function targetsMatch(err: Prisma.PrismaClientKnownRequestError, needles: string[]) {
  const targets = p2002Targets(err).map((t) => t.toLowerCase());
  return needles.some((n) => targets.some((t) => t.includes(n.toLowerCase())));
}

function mapStartUniqueConflict(err: Prisma.PrismaClientKnownRequestError): never {
  // Prisma reports partial-unique targets as column names (and sometimes index names).
  if (
    targetsMatch(err, [
      "CleaningSession_one_running_per_task",
      "taskId",
    ])
  ) {
    throw new AppError(409, "conflict", "Task already has a running session");
  }
  if (
    targetsMatch(err, [
      "CleaningSession_one_running_per_employee",
      "employeeId",
    ])
  ) {
    throw new AppError(409, "conflict", "Employee already has a running session");
  }
  throw err;
}

function mapCreateTaskUniqueConflict(
  err: Prisma.PrismaClientKnownRequestError,
): never {
  const targets = p2002Targets(err);
  const isActiveTaskUnique =
    targetsMatch(err, ["CleaningTask_one_active_per_room_date"]) ||
    (targets.includes("locationId") && targets.includes("hotelDate"));
  if (isActiveTaskUnique) {
    throw new AppError(
      409,
      "conflict",
      "Active cleaning task already exists for this room/date",
    );
  }
  throw err;
}

async function lockTask(tx: Tx, taskId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "CleaningTask" WHERE id = ${taskId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new AppError(404, "not_found", "Task not found");
  }
}

async function lockSession(tx: Tx, sessionId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "CleaningSession" WHERE id = ${sessionId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new AppError(404, "not_found", "Session not found");
  }
}

async function lockLocation(tx: Tx, locationId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Location" WHERE id = ${locationId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new AppError(404, "not_found", "Room not found");
  }
}

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
async function ensureTaskCycleForStart(
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
async function assertTaskOwnsCleaningCycle(
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

/**
 * Apply location cleaningStatus only when the task owns the current cycle.
 * When requireCurrent is true, mismatch throws 409 stale_cleaning_cycle.
 */
async function applyLocationCleaningStatusIfCurrent(
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

export type TaskConflictDetails = {
  expectedVersion?: number;
  currentVersion: number;
  status: string;
  assignedEmployeeId: string | null;
};

export function taskConflictDetails(
  task: {
    version: number;
    status: string;
    assignedEmployeeId: string | null;
  },
  expectedVersion?: number,
): TaskConflictDetails {
  return {
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    currentVersion: task.version,
    status: task.status,
    assignedEmployeeId: task.assignedEmployeeId,
  };
}

function assertTaskVersion(
  task: {
    version: number;
    status: string;
    assignedEmployeeId: string | null;
  },
  expectedVersion?: number,
) {
  if (
    expectedVersion !== undefined &&
    task.version !== expectedVersion
  ) {
    throw new AppError(
      409,
      "version_conflict",
      "Task was updated by another user",
      taskConflictDetails(task, expectedVersion),
    );
  }
}

async function claimRunningSession(
  tx: Tx,
  sessionId: string,
  data: Prisma.CleaningSessionUpdateManyMutationInput,
) {
  const claimed = await tx.cleaningSession.updateMany({
    where: { id: sessionId, status: SessionStatus.running },
    data,
  });
  if (claimed.count === 0) {
    throw new AppError(
      409,
      "invalid_state",
      "Session is no longer running",
    );
  }
}

async function claimTaskStatus(
  tx: Tx,
  taskId: string,
  fromStatuses: TaskStatus[],
  data: Prisma.CleaningTaskUncheckedUpdateManyInput,
  expectedVersion?: number,
) {
  const claimed = await tx.cleaningTask.updateMany({
    where: {
      id: taskId,
      status: { in: fromStatuses },
      ...(expectedVersion !== undefined ? { version: expectedVersion } : {}),
    },
    data: {
      ...data,
      version: { increment: 1 },
    },
  });
  if (claimed.count === 0) {
    const task = await tx.cleaningTask.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new AppError(404, "not_found", "Task not found");
    }
    if (
      expectedVersion !== undefined &&
      task.version !== expectedVersion
    ) {
      throw new AppError(
        409,
        "version_conflict",
        "Task was updated by another user",
        taskConflictDetails(task, expectedVersion),
      );
    }
    throw new AppError(
      409,
      "invalid_state",
      `Cannot transition task from status ${task.status}`,
      taskConflictDetails(task, expectedVersion),
    );
  }
}

export async function createCleaningTask(input: {
  locationId: string;
  hotelDate: string;
  priority?: "low" | "normal" | "high" | "urgent";
  assignedEmployeeId?: string;
  shiftId?: string | null;
  dueAt?: string;
  serviceType?: CleaningServiceType;
  actorEmployeeId?: string;
}) {
  const hotelDate = new Date(`${input.hotelDate}T00:00:00.000Z`);
  const sectorSnap = await sectorSnapshotForLocation(input.locationId);
  const shiftId = await resolveActiveShiftId(input.shiftId);

  if (input.assignedEmployeeId) {
    await assertActiveCleaningAssignee(input.assignedEmployeeId);
  }

  try {
    const task = await prisma.$transaction(async (tx) => {
      await lockLocation(tx, input.locationId);

      const location = await tx.location.findUnique({
        where: { id: input.locationId },
      });
      if (!location) {
        throw new AppError(404, "not_found", "Room not found");
      }
      if (location.catalogStatus !== "active") {
        throw new AppError(400, "invalid_state", "Room is archived");
      }

      const existing = await tx.cleaningTask.findFirst({
        where: {
          locationId: input.locationId,
          hotelDate,
          status: { in: [...ACTIVE_TASK_STATUSES] },
        },
      });
      if (existing) {
        throw new AppError(
          409,
          "conflict",
          "Active cleaning task already exists for this room/date",
        );
      }

      const cleaningCycle = await resolveCycleForNewTask(
        tx,
        location.id,
        hotelDate,
      );

      const serviceType = deriveCleaningServiceType({
        locationKind: location.kind,
        serviceType: input.serviceType,
      });

      const created = await tx.cleaningTask.create({
        data: {
          locationId: input.locationId,
          sectorId: sectorSnap.sectorId,
          sectorSupervisorEmployeeId: sectorSnap.sectorSupervisorEmployeeId,
          hotelDate,
          serviceType,
          priority: input.priority ?? "normal",
          assignedEmployeeId: input.assignedEmployeeId,
          shiftId: shiftId ?? null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          status: TaskStatus.assigned,
          cleaningCycle,
        },
        include: taskInclude,
      });

      await recordAudit(tx, {
        actorEmployeeId: input.actorEmployeeId,
        action: "cleaning.task.create",
        entityType: "cleaning_task",
        entityId: created.id,
        locationId: created.locationId,
        after: {
          status: created.status,
          serviceType: created.serviceType,
          priority: created.priority,
          assignedEmployeeId: created.assignedEmployeeId,
          shiftId: created.shiftId,
          hotelDate: input.hotelDate,
        },
        summary: `Created cleaning task for ${created.location.number}`,
      });

      return created;
    });

    publish("cleaning.changed", {
      locationId: task.locationId,
      taskId: task.id,
    });
    if (task.assignedEmployeeId) {
      await createNotifications({
        type: "cleaning.assigned",
        title: "Cleaning task assigned",
        body: `Room ${task.location.number} assigned to you`,
        entityType: "cleaning_task",
        entityId: task.id,
        locationId: task.locationId,
        actorEmployeeId: input.actorEmployeeId ?? null,
        recipientEmployeeIds: [task.assignedEmployeeId],
        dedupeKey: `cleaning.assigned:${task.id}:${task.assignedEmployeeId}`,
        payload: {
          panel: "mywork",
          taskId: task.id,
          locationId: task.locationId,
          locationNumber: task.location.number,
        },
      });
    }
    return task;
  } catch (err) {
    if (isP2002(err)) {
      mapCreateTaskUniqueConflict(err);
    }
    throw err;
  }
}

export async function startCleaningTask(input: {
  taskId: string;
  employeeId: string;
  commandId: string;
  expectedVersion?: number;
  /** Owner may start a task assigned to someone else. */
  bypassAssigneeCheck?: boolean;
}) {
  const existingByCommand = await prisma.cleaningSession.findUnique({
    where: { startCommandId: input.commandId },
    include: { task: { include: taskInclude } },
  });
  if (existingByCommand) {
    return { session: existingByCommand, task: existingByCommand.task, idempotent: true };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockTask(tx, input.taskId);

      const task = await tx.cleaningTask.findUnique({
        where: { id: input.taskId },
      });
      if (!task) {
        throw new AppError(404, "not_found", "Task not found");
      }
      if (
        task.status !== TaskStatus.assigned &&
        task.status !== TaskStatus.rework &&
        task.status !== TaskStatus.in_progress
      ) {
        throw new AppError(
          409,
          "invalid_state",
          `Cannot start task in status ${task.status}`,
          taskConflictDetails(task, input.expectedVersion),
        );
      }
      assertTaskVersion(task, input.expectedVersion);
      if (
        !input.bypassAssigneeCheck &&
        task.assignedEmployeeId &&
        task.assignedEmployeeId !== input.employeeId
      ) {
        throw new AppError(
          409,
          "assignee_conflict",
          "Task was reassigned to another employee",
          taskConflictDetails(task, input.expectedVersion),
        );
      }

      // Bind unbound/future-planned tasks; reject hotelDate still in the future.
      const cleaningCycle = await ensureTaskCycleForStart(tx, task);

      const runningOnTask = await tx.cleaningSession.findFirst({
        where: { taskId: task.id, status: SessionStatus.running },
      });
      if (runningOnTask) {
        throw new AppError(409, "conflict", "Task already has a running session");
      }

      // DB always enforces one running session per employee (partial unique index).
      const runningByEmployee = await tx.cleaningSession.findFirst({
        where: { employeeId: input.employeeId, status: SessionStatus.running },
      });
      if (runningByEmployee) {
        throw new AppError(409, "conflict", "Employee already has a running session");
      }

      const session = await tx.cleaningSession.create({
        data: {
          taskId: task.id,
          employeeId: input.employeeId,
          startedAt: new Date(),
          status: SessionStatus.running,
          startCommandId: input.commandId,
        },
      });

      await claimTaskStatus(
        tx,
        task.id,
        [TaskStatus.assigned, TaskStatus.rework, TaskStatus.in_progress],
        {
          status: TaskStatus.in_progress,
          assignedEmployeeId: input.employeeId,
        },
        input.expectedVersion,
      );

      const updatedTask = await tx.cleaningTask.findUniqueOrThrow({
        where: { id: task.id },
        include: taskInclude,
      });

      await applyLocationCleaningStatusIfCurrent(
        tx,
        task.locationId,
        cleaningCycle,
        CleaningStatus.in_progress,
        { requireCurrent: true },
      );

      await recordAudit(tx, {
        actorEmployeeId: input.employeeId,
        action: "cleaning.task.start",
        entityType: "cleaning_task",
        entityId: task.id,
        locationId: task.locationId,
        before: { status: task.status },
        after: {
          status: TaskStatus.in_progress,
          sessionId: session.id,
        },
        summary: `Started cleaning ${updatedTask.location.number}`,
      });

      return { session, task: updatedTask, idempotent: false };
    });
    if (!result.idempotent) {
      publish("cleaning.changed", {
        locationId: result.task.locationId,
        taskId: result.task.id,
      });
    }
    return result;
  } catch (err) {
    if (isP2002(err)) {
      const again = await prisma.cleaningSession.findUnique({
        where: { startCommandId: input.commandId },
        include: { task: { include: taskInclude } },
      });
      if (again) {
        return { session: again, task: again.task, idempotent: true };
      }
      mapStartUniqueConflict(err);
    }
    throw err;
  }
}

export async function completeCleaningSession(input: {
  sessionId: string;
  employeeId: string;
  commandId: string;
  notes?: string;
  expectedVersion?: number;
  /** Owner may complete a session started by someone else. */
  bypassSessionOwnerCheck?: boolean;
}) {
  const existingByCommand = await prisma.cleaningSession.findUnique({
    where: { completeCommandId: input.commandId },
    include: { task: { include: taskInclude } },
  });
  if (existingByCommand) {
    return { session: existingByCommand, task: existingByCommand.task, idempotent: true };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const sessionPeek = await tx.cleaningSession.findUnique({
        where: { id: input.sessionId },
      });
      if (!sessionPeek) {
        throw new AppError(404, "not_found", "Session not found");
      }

      // Lock order: task → session → location writes
      await lockTask(tx, sessionPeek.taskId);
      await lockSession(tx, sessionPeek.id);

      const session = await tx.cleaningSession.findUniqueOrThrow({
        where: { id: input.sessionId },
      });
      if (
        !input.bypassSessionOwnerCheck &&
        session.employeeId !== input.employeeId
      ) {
        const taskPeek = await tx.cleaningTask.findUnique({
          where: { id: session.taskId },
        });
        throw new AppError(
          409,
          "assignee_conflict",
          "Session belongs to another employee",
          taskPeek
            ? taskConflictDetails(taskPeek, input.expectedVersion)
            : undefined,
        );
      }
      if (session.status === SessionStatus.completed) {
        throw new AppError(409, "invalid_state", "Session already completed");
      }
      if (session.status !== SessionStatus.running) {
        throw new AppError(
          409,
          "invalid_state",
          `Cannot complete session in status ${session.status}`,
        );
      }

      const task = await tx.cleaningTask.findUniqueOrThrow({
        where: { id: session.taskId },
      });
      assertTaskVersion(task, input.expectedVersion);

      const finishedAt = new Date();
      if (finishedAt < session.startedAt) {
        throw new AppError(400, "invalid_time", "Finish time before start time");
      }

      const operations = await getOperations();
      const durationMinutes =
        (finishedAt.getTime() - session.startedAt.getTime()) / 60000;
      const existingFlags = Array.isArray(session.anomalyFlags)
        ? (session.anomalyFlags as string[]).filter(
            (f): f is string => typeof f === "string",
          )
        : [];
      const anomalyFlags =
        durationMinutes >= operations.overdueSessionMinutes &&
        !existingFlags.includes("overdue")
          ? [...existingFlags, "overdue"]
          : existingFlags;

      await claimRunningSession(tx, session.id, {
        status: SessionStatus.completed,
        finishedAt,
        notes: input.notes?.trim() || null,
        completeCommandId: input.commandId,
        anomalyFlags,
      });

      const updatedSession = await tx.cleaningSession.findUniqueOrThrow({
        where: { id: session.id },
      });

      const flags = await getFlags();
      const nextTaskStatus = flags.require_inspection
        ? TaskStatus.awaiting_inspection
        : TaskStatus.completed;
      const nextCleaningStatus = flags.require_inspection
        ? CleaningStatus.pending_inspection
        : CleaningStatus.verified_clean;

      await claimTaskStatus(
        tx,
        session.taskId,
        [TaskStatus.in_progress],
        {
          status: nextTaskStatus,
          ...(nextTaskStatus === TaskStatus.completed
            ? { completedAt: finishedAt }
            : {}),
        },
        input.expectedVersion,
      );

      const updatedTask = await tx.cleaningTask.findUniqueOrThrow({
        where: { id: session.taskId },
        include: taskInclude,
      });

      // Soft cycle guard: close the session even if superseded; never overwrite a newer cycle.
      await applyLocationCleaningStatusIfCurrent(
        tx,
        updatedTask.locationId,
        task.cleaningCycle,
        nextCleaningStatus,
      );

      await recordAudit(tx, {
        actorEmployeeId: input.employeeId,
        action: "cleaning.session.complete",
        entityType: "cleaning_session",
        entityId: updatedSession.id,
        locationId: updatedTask.locationId,
        after: {
          taskStatus: nextTaskStatus,
          completedAt:
            nextTaskStatus === TaskStatus.completed
              ? finishedAt.toISOString()
              : null,
          notes: input.notes?.trim() || null,
        },
        summary: `Completed cleaning ${updatedTask.location.number}`,
      });

      return { session: updatedSession, task: updatedTask, idempotent: false };
    });
    if (!result.idempotent) {
      publish("cleaning.changed", {
        locationId: result.task.locationId,
        taskId: result.task.id,
      });
      if (result.task.status === TaskStatus.awaiting_inspection) {
        const recipients = await recipientsForLocationOps(
          result.task.locationId,
          "cleaning.inspect",
        );
        if (result.task.sectorSupervisorEmployeeId) {
          recipients.push(result.task.sectorSupervisorEmployeeId);
        }
        await createNotifications({
          type: "cleaning.needs_inspection",
          title: "Inspection needed",
          body: `Room ${result.task.location.number} awaiting inspection`,
          entityType: "cleaning_task",
          entityId: result.task.id,
          locationId: result.task.locationId,
          actorEmployeeId: input.employeeId,
          recipientEmployeeIds: recipients,
          dedupeKey: `cleaning.needs_inspection:${result.task.id}`,
          payload: {
            panel: "cleaning",
            taskId: result.task.id,
            locationId: result.task.locationId,
            locationNumber: result.task.location.number,
          },
        });
      }
    }
    return result;
  } catch (err) {
    if (isP2002(err)) {
      const again = await prisma.cleaningSession.findUnique({
        where: { completeCommandId: input.commandId },
        include: { task: { include: taskInclude } },
      });
      if (again) {
        return { session: again, task: again.task, idempotent: true };
      }
    }
    throw err;
  }
}

export async function cancelCleaningSession(input: {
  sessionId: string;
  employeeId: string;
  commandId: string;
  notes?: string;
  expectedVersion?: number;
  /** Reviewer / owner may cancel a session started by someone else. */
  bypassSessionOwnerCheck?: boolean;
}) {
  const existingByCommand = await prisma.cleaningSession.findUnique({
    where: { cancelCommandId: input.commandId },
    include: { task: { include: taskInclude } },
  });
  if (existingByCommand) {
    return { session: existingByCommand, task: existingByCommand.task, idempotent: true };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const sessionPeek = await tx.cleaningSession.findUnique({
        where: { id: input.sessionId },
      });
      if (!sessionPeek) {
        throw new AppError(404, "not_found", "Session not found");
      }

      await lockTask(tx, sessionPeek.taskId);
      await lockSession(tx, sessionPeek.id);

      const session = await tx.cleaningSession.findUniqueOrThrow({
        where: { id: input.sessionId },
      });
      if (
        !input.bypassSessionOwnerCheck &&
        session.employeeId !== input.employeeId
      ) {
        const taskPeek = await tx.cleaningTask.findUnique({
          where: { id: session.taskId },
        });
        throw new AppError(
          409,
          "assignee_conflict",
          "Session belongs to another employee",
          taskPeek
            ? taskConflictDetails(taskPeek, input.expectedVersion)
            : undefined,
        );
      }
      if (session.status === SessionStatus.cancelled) {
        throw new AppError(409, "invalid_state", "Session already cancelled");
      }
      if (session.status !== SessionStatus.running) {
        throw new AppError(
          409,
          "invalid_state",
          `Cannot cancel session in status ${session.status}`,
        );
      }

      const task = await tx.cleaningTask.findUniqueOrThrow({
        where: { id: session.taskId },
      });
      assertTaskVersion(task, input.expectedVersion);

      const finishedAt = new Date();
      if (finishedAt < session.startedAt) {
        throw new AppError(400, "invalid_time", "Finish time before start time");
      }

      await claimRunningSession(tx, session.id, {
        status: SessionStatus.cancelled,
        finishedAt,
        notes: input.notes?.trim() || null,
        cancelCommandId: input.commandId,
      });

      const updatedSession = await tx.cleaningSession.findUniqueOrThrow({
        where: { id: session.id },
      });

      let updatedTask = await tx.cleaningTask.findUniqueOrThrow({
        where: { id: task.id },
        include: taskInclude,
      });

      // At most one running session per task (DB invariant) — cancel always reverts.
      if (task.status === TaskStatus.in_progress) {
        await claimTaskStatus(
          tx,
          task.id,
          [TaskStatus.in_progress],
          { status: TaskStatus.assigned },
          input.expectedVersion,
        );
        updatedTask = await tx.cleaningTask.findUniqueOrThrow({
          where: { id: task.id },
          include: taskInclude,
        });

        // Soft cycle guard: never overwrite a newer location cycle/status.
        await applyLocationCleaningStatusIfCurrent(
          tx,
          task.locationId,
          task.cleaningCycle,
          CleaningStatus.dirty,
          { onlyIfStatus: CleaningStatus.in_progress },
        );
      }

      await recordAudit(tx, {
        actorEmployeeId: input.employeeId,
        action: "cleaning.session.cancel",
        entityType: "cleaning_session",
        entityId: updatedSession.id,
        locationId: updatedTask.locationId,
        after: {
          taskStatus: updatedTask.status,
          notes: input.notes?.trim() || null,
        },
        summary: `Cancelled cleaning session for ${updatedTask.location.number}`,
      });

      return { session: updatedSession, task: updatedTask, idempotent: false };
    });
    if (!result.idempotent) {
      publish("cleaning.changed", {
        locationId: result.task.locationId,
        taskId: result.task.id,
      });
    }
    return result;
  } catch (err) {
    if (isP2002(err)) {
      const again = await prisma.cleaningSession.findUnique({
        where: { cancelCommandId: input.commandId },
        include: { task: { include: taskInclude } },
      });
      if (again) {
        return { session: again, task: again.task, idempotent: true };
      }
    }
    throw err;
  }
}

export async function inspectCleaningTask(input: {
  taskId: string;
  inspectorEmployeeId: string;
  commandId: string;
  result: "approved" | "rejected";
  findings?: string;
  expectedVersion?: number;
}) {
  const existing = await prisma.inspection.findUnique({
    where: { commandId: input.commandId },
    include: { task: { include: taskInclude } },
  });
  if (existing) {
    return { inspection: existing, task: existing.task, idempotent: true };
  }

  if (input.result === "rejected" && !input.findings?.trim()) {
    throw new AppError(400, "validation", "Findings/reason required when rejecting");
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockTask(tx, input.taskId);

      const task = await tx.cleaningTask.findUnique({
        where: { id: input.taskId },
      });
      if (!task) {
        throw new AppError(404, "not_found", "Task not found");
      }
      if (task.status !== TaskStatus.awaiting_inspection) {
        throw new AppError(
          409,
          "invalid_state",
          `Cannot inspect task in status ${task.status}`,
        );
      }
      assertTaskVersion(task, input.expectedVersion);

      const inspection = await tx.inspection.create({
        data: {
          taskId: task.id,
          inspectorEmployeeId: input.inspectorEmployeeId,
          inspectedAt: new Date(),
          result:
            input.result === "approved"
              ? InspectionResult.approved
              : InspectionResult.rejected,
          findings: input.findings?.trim() || null,
          commandId: input.commandId,
        },
      });

      if (input.result === "approved") {
        const completedAt = inspection.inspectedAt;
        await claimTaskStatus(
          tx,
          task.id,
          [TaskStatus.awaiting_inspection],
          { status: TaskStatus.completed, completedAt },
          input.expectedVersion,
        );
        const updatedTask = await tx.cleaningTask.findUniqueOrThrow({
          where: { id: task.id },
          include: taskInclude,
        });
        const locationUpdated = await applyLocationCleaningStatusIfCurrent(
          tx,
          task.locationId,
          task.cleaningCycle,
          CleaningStatus.verified_clean,
        );
        await recordAudit(tx, {
          actorEmployeeId: input.inspectorEmployeeId,
          action: "cleaning.inspect",
          entityType: "inspection",
          entityId: inspection.id,
          locationId: task.locationId,
          reason: input.findings,
          after: {
            result: "approved",
            taskId: task.id,
            completedAt: completedAt.toISOString(),
            locationUpdated,
            cleaningCycle: task.cleaningCycle,
          },
          summary: locationUpdated
            ? `Approved cleaning ${updatedTask.location.number}`
            : `Approved cleaning ${updatedTask.location.number} (stale cycle; location unchanged)`,
        });
        return { inspection, task: updatedTask, idempotent: false };
      }

      await claimTaskStatus(
        tx,
        task.id,
        [TaskStatus.awaiting_inspection],
        { status: TaskStatus.rework },
        input.expectedVersion,
      );
      const updatedTask = await tx.cleaningTask.findUniqueOrThrow({
        where: { id: task.id },
        include: taskInclude,
      });
      const locationUpdated = await applyLocationCleaningStatusIfCurrent(
        tx,
        task.locationId,
        task.cleaningCycle,
        CleaningStatus.dirty,
      );
      await recordAudit(tx, {
        actorEmployeeId: input.inspectorEmployeeId,
        action: "cleaning.inspect",
        entityType: "inspection",
        entityId: inspection.id,
        locationId: task.locationId,
        reason: input.findings,
        after: {
          result: "rejected",
          taskId: task.id,
          locationUpdated,
          cleaningCycle: task.cleaningCycle,
        },
        summary: locationUpdated
          ? `Rejected cleaning ${updatedTask.location.number}${
              input.findings?.trim() ? ` — ${input.findings.trim()}` : ""
            }`
          : `Rejected cleaning ${updatedTask.location.number} (stale cycle; location unchanged)${
              input.findings?.trim() ? ` — ${input.findings.trim()}` : ""
            }`,
      });
      return { inspection, task: updatedTask, idempotent: false };
    });
    if (!result.idempotent) {
      publish("cleaning.changed", {
        locationId: result.task.locationId,
        taskId: result.task.id,
      });
      const recipients: string[] = [];
      if (result.task.assignedEmployeeId) {
        recipients.push(result.task.assignedEmployeeId);
      }
      await createNotifications({
        type: "cleaning.inspected",
        title:
          input.result === "approved"
            ? "Cleaning approved"
            : "Cleaning rejected — rework",
        body: `Room ${result.task.location.number}: ${input.result}`,
        entityType: "cleaning_task",
        entityId: result.task.id,
        locationId: result.task.locationId,
        actorEmployeeId: input.inspectorEmployeeId,
        recipientEmployeeIds: recipients,
        dedupeKey: `cleaning.inspected:${result.inspection.id}`,
        payload: {
          panel: "mywork",
          taskId: result.task.id,
          locationId: result.task.locationId,
          locationNumber: result.task.location.number,
        },
      });
    }
    return result;
  } catch (err) {
    if (isP2002(err)) {
      const again = await prisma.inspection.findUnique({
        where: { commandId: input.commandId },
        include: { task: { include: taskInclude } },
      });
      if (again) {
        return { inspection: again, task: again.task, idempotent: true };
      }
    }
    throw err;
  }
}

export async function reassignCleaningTask(input: {
  taskId: string;
  assignedEmployeeId: string;
  reason: string;
  shiftId?: string | null;
  expectedVersion?: number;
  actorEmployeeId?: string;
}) {
  if (!input.reason.trim()) {
    throw new AppError(400, "validation", "Reassign reason is required");
  }

  await assertActiveCleaningAssignee(input.assignedEmployeeId);

  const shiftId = await resolveActiveShiftId(input.shiftId);

  const updated = await prisma.$transaction(async (tx) => {
    await lockTask(tx, input.taskId);

    const task = await tx.cleaningTask.findUnique({
      where: { id: input.taskId },
    });
    if (!task) {
      throw new AppError(404, "not_found", "Task not found");
    }
    if (
      task.status !== TaskStatus.assigned &&
      task.status !== TaskStatus.rework &&
      task.status !== TaskStatus.awaiting_inspection
    ) {
      throw new AppError(
        409,
        "invalid_state",
        `Cannot reassign task in status ${task.status}`,
      );
    }
    assertTaskVersion(task, input.expectedVersion);

    const running = await tx.cleaningSession.findFirst({
      where: { taskId: task.id, status: SessionStatus.running },
    });
    if (running) {
      throw new AppError(
        409,
        "conflict",
        "Cannot reassign while a session is running",
      );
    }

    const data: Prisma.CleaningTaskUncheckedUpdateManyInput = {
      assignedEmployeeId: input.assignedEmployeeId,
      reassignReason: input.reason.trim(),
    };
    if (shiftId !== undefined) {
      data.shiftId = shiftId;
    }

    // Backfill sector snapshot only when missing — do not overwrite history.
    if (!task.sectorId) {
      const snap = await sectorSnapshotForLocation(task.locationId, tx);
      if (snap.sectorId) {
        data.sectorId = snap.sectorId;
        if (snap.sectorSupervisorEmployeeId) {
          data.sectorSupervisorEmployeeId = snap.sectorSupervisorEmployeeId;
        }
      }
    } else if (!task.sectorSupervisorEmployeeId) {
      const supervisorId = await sectorSupervisorForSector(task.sectorId, tx);
      if (supervisorId) {
        data.sectorSupervisorEmployeeId = supervisorId;
      }
    }

    await claimTaskStatus(
      tx,
      task.id,
      [
        TaskStatus.assigned,
        TaskStatus.rework,
        TaskStatus.awaiting_inspection,
      ],
      data,
      input.expectedVersion,
    );

    const result = await tx.cleaningTask.findUniqueOrThrow({
      where: { id: task.id },
      include: taskInclude,
    });

    await recordAudit(tx, {
      actorEmployeeId: input.actorEmployeeId,
      action: "cleaning.task.reassign",
      entityType: "cleaning_task",
      entityId: result.id,
      locationId: result.locationId,
      reason: input.reason,
      before: {
        assignedEmployeeId: task.assignedEmployeeId,
        shiftId: task.shiftId,
      },
      after: {
        assignedEmployeeId: input.assignedEmployeeId,
        shiftId: result.shiftId,
      },
      summary: `Reassigned cleaning ${result.location.number}`,
    });

    return result;
  });

  publish("cleaning.changed", {
    locationId: updated.locationId,
    taskId: updated.id,
  });
  await createNotifications({
    type: "cleaning.assigned",
    title: "Cleaning task reassigned",
    body: `Room ${updated.location.number} assigned to you`,
    entityType: "cleaning_task",
    entityId: updated.id,
    locationId: updated.locationId,
    actorEmployeeId: input.actorEmployeeId ?? null,
    recipientEmployeeIds: [input.assignedEmployeeId],
    dedupeKey: `cleaning.reassigned:${updated.id}:${input.assignedEmployeeId}:${updated.updatedAt.toISOString()}`,
    payload: {
      panel: "mywork",
      taskId: updated.id,
      locationId: updated.locationId,
      locationNumber: updated.location.number,
    },
  });
  return updated;
}

export async function listOverdueSessions(scopeWhere?: Prisma.CleaningSessionWhereInput) {
  const operations = await getOperations();
  const overdueMinutes = operations.overdueSessionMinutes;
  const cutoff = new Date(Date.now() - overdueMinutes * 60 * 1000);
  const sessions = await prisma.cleaningSession.findMany({
    where: {
      status: SessionStatus.running,
      startedAt: { lte: cutoff },
      ...(scopeWhere ?? {}),
    },
    include: {
      employee: true,
      task: {
        include: {
          location: { include: { floor: { include: { building: true } } } },
        },
      },
    },
    orderBy: { startedAt: "asc" },
  });

  return sessions.map((s) => {
    const elapsedMinutes = Math.floor(
      (Date.now() - s.startedAt.getTime()) / 60000,
    );
    return {
      sessionId: s.id,
      taskId: s.taskId,
      startedAt: s.startedAt,
      elapsedMinutes,
      employee: {
        id: s.employee.id,
        fullName: s.employee.fullName,
        employeeNumber: s.employee.employeeNumber,
      },
      room: {
        id: s.task.location.id,
        number: s.task.location.number,
        buildingCode: s.task.location.floor.building.code,
        floor: s.task.location.floor.number,
      },
    };
  });
}

export async function markRoomDirty(
  locationId: string,
  actorEmployeeId?: string,
) {
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) {
    throw new AppError(404, "not_found", "Room not found");
  }
  const updated = await prisma.$transaction(async (tx) => {
    const nextCycle = await bumpDirtyAndRebindWork(tx, locationId);
    const row = await tx.location.findUniqueOrThrow({
      where: { id: locationId },
      include: {
        floor: { include: { building: true } },
        cleaningTasks: {
          where: { status: { in: [...ACTIVE_TASK_STATUSES] } },
          include: {
            assignedEmployee: true,
            sessions: {
              include: { employee: true },
              orderBy: { startedAt: "desc" },
            },
            inspections: {
              include: { inspector: true },
              orderBy: { inspectedAt: "desc" },
              take: 1,
            },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        maintenanceTickets: {
          where: {
            status: { in: ["new", "in_progress"] },
            blocksRoom: true,
          },
          take: 5,
          orderBy: { openedAt: "desc" },
        },
      },
    });
    await recordAudit(tx, {
      actorEmployeeId,
      action: "location.mark_dirty",
      entityType: "location",
      entityId: locationId,
      locationId,
      before: {
        cleaningStatus: location.cleaningStatus,
        cleaningCycle: location.cleaningCycle,
      },
      after: {
        cleaningStatus: CleaningStatus.dirty,
        cleaningCycle: nextCycle,
      },
      summary: `Marked ${row.number} dirty`,
    });
    return row;
  });
  publish("location.changed", { locationId: updated.id });
  {
    const recipients = await recipientsForLocationOps(
      locationId,
      "cleaning.create",
    );
    await createNotifications({
      type: "location.marked_dirty",
      title: "Room marked dirty",
      body: `Room ${updated.number} needs cleaning`,
      entityType: "location",
      entityId: locationId,
      locationId,
      actorEmployeeId: actorEmployeeId ?? null,
      recipientEmployeeIds: recipients,
      dedupeKey: `location.marked_dirty:${locationId}:${updated.updatedAt.toISOString()}`,
      payload: {
        panel: "rooms",
        locationId,
        locationNumber: updated.number,
      },
    });
  }
  return updated;
}
