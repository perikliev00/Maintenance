import {
  CleaningStatus,
  DailyPlanCategory,
  LocationKind,
  Occupancy,
  Priority,
  Prisma,
  TaskStatus,
} from "@prisma/client";
import { prisma } from "../db";
import { ACTIVE_TASK_STATUSES } from "../constants";
import { AppError } from "../errors";
import {
  bumpDirtyAndRebindWork,
  deriveCleaningServiceType,
  resolveCycleForNewTask,
} from "./cleaning";
import { sectorSnapshotForLocation } from "./dataScope";
import { todayHotelDateYmd, zonedDayStartUtc } from "./hotelTime";
import { getOperations } from "./settings";

const PRIORITY_RANK: Record<Priority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

type Tx = Prisma.TransactionClient;

type LocationRow = {
  id: string;
  kind: LocationKind;
  catalogStatus: string;
  cleaningStatus: CleaningStatus;
  occupancy: Occupancy;
};

type TaskEffect = "created" | "linked" | "bumped" | "skipped";

type PlanEffects = {
  occupancy: "vacant" | null;
  dirty: boolean;
  task: TaskEffect;
  cleaningTaskId: string | null;
  roomEffectsApplied: boolean;
};

async function createTaskWithSectorSnapshot(
  tx: Tx,
  data: {
    locationId: string;
    hotelDate: Date;
    priority: Priority;
    assignedEmployeeId?: string;
    shiftId?: string | null;
    locationKind: LocationKind;
    planCategory: DailyPlanCategory;
  },
) {
  const snap = await sectorSnapshotForLocation(data.locationId, tx);
  const serviceType = deriveCleaningServiceType({
    locationKind: data.locationKind,
    planCategory: data.planCategory,
  });
  const cleaningCycle = await resolveCycleForNewTask(
    tx,
    data.locationId,
    data.hotelDate,
  );
  try {
    return await tx.cleaningTask.create({
      data: {
        locationId: data.locationId,
        hotelDate: data.hotelDate,
        priority: data.priority,
        assignedEmployeeId: data.assignedEmployeeId,
        shiftId: data.shiftId ?? null,
        status: TaskStatus.assigned,
        serviceType,
        sectorId: snap.sectorId,
        sectorSupervisorEmployeeId: snap.sectorSupervisorEmployeeId,
        cleaningCycle,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const existing = await tx.cleaningTask.findFirst({
        where: {
          locationId: data.locationId,
          hotelDate: data.hotelDate,
          status: { in: [...ACTIVE_TASK_STATUSES] },
        },
      });
      if (existing) {
        return existing;
      }
    }
    throw err;
  }
}

export function parseHotelDate(hotelDate: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hotelDate)) {
    throw new AppError(400, "validation", "hotelDate must be YYYY-MM-DD");
  }
  return new Date(`${hotelDate}T00:00:00.000Z`);
}

export function formatHotelDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type DepartureRoomEffectsResult = {
  hotelDate: string;
  applied: number;
  skipped: number;
  deferred: number;
  deferredEntryIds: string[];
  total: number;
};

export type DepartureRoomEffectsDecision = "apply" | "protect" | "defer";

/**
 * Classify deferred departure room effects without using cleaningStatus.
 * Cleaning alone does not prove a newer stay (check-in keeps verified_clean).
 */
export function classifyDepartureRoomEffects(input: {
  occupancy: Occupancy;
  planYmd: string;
  todayYmd: string;
  hasNewerStayEvidence: boolean;
  confirmed: boolean;
}): DepartureRoomEffectsDecision {
  if (input.occupancy !== Occupancy.occupied) {
    return "apply";
  }
  if (input.hasNewerStayEvidence) {
    return "protect";
  }
  // Past plan + occupied without proof: do not auto-vacate; await confirm.
  if (input.planYmd < input.todayYmd) {
    return input.confirmed ? "apply" : "defer";
  }
  // Same hotel day, current stay — apply even if room is still verified_clean.
  return "apply";
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function emptyDepartureRoomEffectsResult(
  planYmd: string,
): DepartureRoomEffectsResult {
  return {
    hotelDate: planYmd,
    applied: 0,
    skipped: 0,
    deferred: 0,
    deferredEntryIds: [],
    total: 0,
  };
}

/**
 * Locations with proof of a newer stay after a departure plan day:
 * occupancy set to occupied after that hotel day (hotel timezone).
 * Planned arrivals are not evidence — they do not prove check-in.
 * Cleaning status alone is not evidence.
 */
async function locationsWithNewerStayEvidence(
  db: Tx | typeof prisma,
  locationIds: string[],
  planYmd: string,
): Promise<Set<string>> {
  if (locationIds.length === 0) {
    return new Set();
  }

  const ops = await getOperations();
  const afterPlanDayStart = zonedDayStartUtc(
    addDaysYmd(planYmd, 1),
    ops.hotelTimezone,
  );
  const reoccupyRows = await db.auditEvent.findMany({
    where: {
      locationId: { in: locationIds },
      action: "location.set_occupancy",
      occurredAt: { gte: afterPlanDayStart },
      after: { path: ["occupancy"], equals: Occupancy.occupied },
    },
    select: { locationId: true },
  });
  const withEvidence = new Set<string>();
  for (const row of reoccupyRows) {
    if (row.locationId) {
      withEvidence.add(row.locationId);
    }
  }
  return withEvidence;
}

/**
 * Link an active cleaning task or create a high-priority departure task,
 * reusing assignee/shift when the task is unbound.
 */
async function linkOrCreateDepartureTask(
  tx: Tx,
  input: {
    locationId: string;
    locationKind: LocationKind;
    hotelDate: Date;
    assignedEmployeeId?: string;
    shiftId?: string | null;
    existingCleaningTaskId?: string | null;
  },
): Promise<string | null> {
  const assignedEmployeeId = input.assignedEmployeeId;
  const shiftId = input.shiftId;

  const connectAssigneeAndShift = (
    data: Prisma.CleaningTaskUpdateInput,
    task: { assignedEmployeeId: string | null; shiftId: string | null },
  ) => {
    if (assignedEmployeeId && !task.assignedEmployeeId) {
      data.assignedEmployee = { connect: { id: assignedEmployeeId } };
    }
    if (shiftId && !task.shiftId) {
      data.shift = { connect: { id: shiftId } };
    }
  };

  if (input.existingCleaningTaskId) {
    const existing = await tx.cleaningTask.findFirst({
      where: {
        id: input.existingCleaningTaskId,
        status: { in: [...ACTIVE_TASK_STATUSES] },
      },
    });
    if (existing) {
      const data: Prisma.CleaningTaskUpdateInput = {};
      if (PRIORITY_RANK[existing.priority] < PRIORITY_RANK[Priority.high]) {
        data.priority = Priority.high;
      }
      connectAssigneeAndShift(data, existing);
      if (Object.keys(data).length) {
        await tx.cleaningTask.update({ where: { id: existing.id }, data });
      }
      return existing.id;
    }
  }

  const activeTask = await tx.cleaningTask.findFirst({
    where: {
      locationId: input.locationId,
      hotelDate: input.hotelDate,
      status: { in: [...ACTIVE_TASK_STATUSES] },
    },
  });

  if (activeTask) {
    const data: Prisma.CleaningTaskUpdateInput = {};
    if (PRIORITY_RANK[activeTask.priority] < PRIORITY_RANK[Priority.high]) {
      data.priority = Priority.high;
    }
    connectAssigneeAndShift(data, activeTask);
    if (Object.keys(data).length) {
      await tx.cleaningTask.update({ where: { id: activeTask.id }, data });
    }
    return activeTask.id;
  }

  const created = await createTaskWithSectorSnapshot(tx, {
    locationId: input.locationId,
    hotelDate: input.hotelDate,
    priority: Priority.high,
    assignedEmployeeId,
    shiftId,
    locationKind: input.locationKind,
    planCategory: DailyPlanCategory.departure,
  });
  return created.id;
}

/** Apply deferred departure room effects for a YYYY-MM-DD hotel date. */
export async function applyDepartureRoomEffects(
  hotelDate: string,
  locationFilter?: Prisma.LocationWhereInput,
  options?: { confirmEntryIds?: string[] },
): Promise<DepartureRoomEffectsResult> {
  return ensureDepartureRoomEffects(
    parseHotelDate(hotelDate),
    locationFilter,
    options,
  );
}

/**
 * Apply deferred vacant+dirty for departure plan entries once their hotelDate
 * has arrived (or is in the past). No-op for future hotel dates.
 * Scoped by locationFilter when provided. Protects rooms with a proven newer
 * stay; defers ambiguous past occupied rooms until confirmEntryIds.
 */
export async function ensureDepartureRoomEffects(
  hotelDate: Date,
  locationFilter?: Prisma.LocationWhereInput,
  options?: { confirmEntryIds?: string[] },
): Promise<DepartureRoomEffectsResult> {
  const todayYmd = await todayHotelDateYmd();
  const planYmd = formatHotelDate(hotelDate);
  const empty = emptyDepartureRoomEffectsResult(planYmd);
  if (planYmd > todayYmd) {
    return empty;
  }

  const pending = await prisma.dailyPlanEntry.findMany({
    where: {
      hotelDate,
      category: DailyPlanCategory.departure,
      roomEffectsAppliedAt: null,
      ...(locationFilter ? { location: locationFilter } : {}),
    },
    select: {
      id: true,
      locationId: true,
      assignedEmployeeId: true,
      shiftId: true,
      cleaningTaskId: true,
    },
  });
  if (pending.length === 0) {
    return empty;
  }

  const locationIds = [...new Set(pending.map((e) => e.locationId))];
  const confirmSet = new Set(options?.confirmEntryIds ?? []);
  const newerStayLocations = await locationsWithNewerStayEvidence(
    prisma,
    locationIds,
    planYmd,
  );

  const now = new Date();
  let applied = 0;
  let skipped = 0;
  const deferredEntryIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const entry of pending) {
      const location = await tx.location.findUniqueOrThrow({
        where: { id: entry.locationId },
        select: { occupancy: true, kind: true },
      });

      const hasNewerStayEvidence = newerStayLocations.has(entry.locationId);

      const decision = classifyDepartureRoomEffects({
        occupancy: location.occupancy,
        planYmd,
        todayYmd,
        hasNewerStayEvidence,
        confirmed: confirmSet.has(entry.id),
      });

      if (decision === "defer") {
        deferredEntryIds.push(entry.id);
        continue;
      }

      const claimed = await tx.dailyPlanEntry.updateMany({
        where: {
          id: entry.id,
          category: DailyPlanCategory.departure,
          roomEffectsAppliedAt: null,
        },
        data: { roomEffectsAppliedAt: now },
      });
      if (claimed.count === 0) continue;

      if (decision === "protect") {
        skipped += 1;
        continue;
      }

      await bumpDirtyAndRebindWork(tx, entry.locationId, {
        occupancy: Occupancy.vacant,
      });

      const cleaningTaskId = await linkOrCreateDepartureTask(tx, {
        locationId: entry.locationId,
        locationKind: location.kind,
        hotelDate,
        assignedEmployeeId: entry.assignedEmployeeId ?? undefined,
        shiftId: entry.shiftId,
        existingCleaningTaskId: entry.cleaningTaskId,
      });
      if (cleaningTaskId && cleaningTaskId !== entry.cleaningTaskId) {
        await tx.dailyPlanEntry.update({
          where: { id: entry.id },
          data: { cleaningTaskId },
        });
      }

      applied += 1;
    }
  });

  return {
    hotelDate: planYmd,
    applied,
    skipped,
    deferred: deferredEntryIds.length,
    deferredEntryIds,
    total: applied + skipped + deferredEntryIds.length,
  };
}

export async function applyPlanEntryEffects(
  tx: Tx,
  location: LocationRow,
  hotelDate: Date,
  category: DailyPlanCategory,
  assignedEmployeeId?: string,
  shiftId?: string | null,
  todayYmd?: string,
): Promise<PlanEffects> {
  let taskEffect: TaskEffect = "skipped";
  let cleaningTaskId: string | null = null;
  let occupancyEffect: "vacant" | null = null;
  let dirtyEffect = false;
  let roomEffectsApplied = false;

  const activeTask = await tx.cleaningTask.findFirst({
    where: {
      locationId: location.id,
      hotelDate,
      status: { in: [...ACTIVE_TASK_STATUSES] },
    },
  });

  const connectAssigneeAndShift = (
    data: Prisma.CleaningTaskUpdateInput,
    task: { assignedEmployeeId: string | null; shiftId: string | null },
  ) => {
    if (assignedEmployeeId && !task.assignedEmployeeId) {
      data.assignedEmployee = { connect: { id: assignedEmployeeId } };
    }
    if (shiftId && !task.shiftId) {
      data.shift = { connect: { id: shiftId } };
    }
  };

  if (category === DailyPlanCategory.departure) {
    const today = todayYmd ?? (await todayHotelDateYmd());
    const planYmd = formatHotelDate(hotelDate);
    // Room state only on/after checkout day; future departures stay planned.
    // Protect proven newer stays; defer ambiguous past occupied (no vacant/dirty
    // and no bound task that would bump cleaningCycle).
    let skipRoomAndBoundTask = false;
    if (planYmd <= today) {
      const live = await tx.location.findUniqueOrThrow({
        where: { id: location.id },
        select: { occupancy: true },
      });
      const newerStayLocations = await locationsWithNewerStayEvidence(
        tx,
        [location.id],
        planYmd,
      );
      const decision = classifyDepartureRoomEffects({
        occupancy: live.occupancy,
        planYmd,
        todayYmd: today,
        hasNewerStayEvidence: newerStayLocations.has(location.id),
        confirmed: false,
      });
      if (decision === "apply") {
        await bumpDirtyAndRebindWork(tx, location.id, {
          occupancy: Occupancy.vacant,
        });
        occupancyEffect = "vacant";
        dirtyEffect = true;
        roomEffectsApplied = true;
      } else if (decision === "protect") {
        roomEffectsApplied = true;
        skipRoomAndBoundTask = true;
      } else {
        // defer: keep roomEffectsAppliedAt null for later confirm; preserve stay
        skipRoomAndBoundTask = true;
      }
    }

    if (!skipRoomAndBoundTask) {
      if (activeTask) {
        cleaningTaskId = activeTask.id;
        const data: Prisma.CleaningTaskUpdateInput = {};
        if (PRIORITY_RANK[activeTask.priority] < PRIORITY_RANK[Priority.high]) {
          data.priority = Priority.high;
          taskEffect = "bumped";
        } else {
          taskEffect = "linked";
        }
        connectAssigneeAndShift(data, activeTask);
        if (Object.keys(data).length) {
          await tx.cleaningTask.update({
            where: { id: activeTask.id },
            data,
          });
        }
      } else {
        const created = await createTaskWithSectorSnapshot(tx, {
          locationId: location.id,
          hotelDate,
          priority: Priority.high,
          assignedEmployeeId,
          shiftId,
          locationKind: location.kind,
          planCategory: category,
        });
        cleaningTaskId = created.id;
        taskEffect = "created";
      }
    }
  } else if (category === DailyPlanCategory.priority) {
    if (activeTask) {
      cleaningTaskId = activeTask.id;
      const data: Prisma.CleaningTaskUpdateInput = {};
      if (PRIORITY_RANK[activeTask.priority] < PRIORITY_RANK[Priority.urgent]) {
        data.priority = Priority.urgent;
        taskEffect = "bumped";
      } else {
        taskEffect = "linked";
      }
      connectAssigneeAndShift(data, activeTask);
      if (Object.keys(data).length) {
        await tx.cleaningTask.update({
          where: { id: activeTask.id },
          data,
        });
      }
    } else {
      dirtyEffect =
        location.cleaningStatus === CleaningStatus.verified_clean ||
        location.cleaningStatus === CleaningStatus.pending_inspection;
      const created = await createTaskWithSectorSnapshot(tx, {
        locationId: location.id,
        hotelDate,
        priority: Priority.urgent,
        assignedEmployeeId,
        shiftId,
        locationKind: location.kind,
        planCategory: category,
      });
      cleaningTaskId = created.id;
      taskEffect = "created";
    }
  } else {
    // arrival — no occupancy change; task only if not verified_clean
    if (location.cleaningStatus !== CleaningStatus.verified_clean) {
      if (activeTask) {
        cleaningTaskId = activeTask.id;
        const data: Prisma.CleaningTaskUpdateInput = {};
        if (PRIORITY_RANK[activeTask.priority] < PRIORITY_RANK[Priority.high]) {
          data.priority = Priority.high;
          taskEffect = "bumped";
        } else {
          taskEffect = "linked";
        }
        connectAssigneeAndShift(data, activeTask);
        if (Object.keys(data).length) {
          await tx.cleaningTask.update({
            where: { id: activeTask.id },
            data,
          });
        }
      } else {
        const created = await createTaskWithSectorSnapshot(tx, {
          locationId: location.id,
          hotelDate,
          priority: Priority.high,
          assignedEmployeeId,
          shiftId,
          locationKind: location.kind,
          planCategory: category,
        });
        cleaningTaskId = created.id;
        taskEffect = "created";
      }
    } else {
      taskEffect = "skipped";
    }
  }

  return {
    occupancy: occupancyEffect,
    dirty: dirtyEffect,
    task: taskEffect,
    cleaningTaskId,
    roomEffectsApplied,
  };
}
