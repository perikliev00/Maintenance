import {
  CleaningStatus,
  DailyPlanCategory,
  DailyPlanImportStatus,
  DailyPlanSource,
  LocationKind,
  Occupancy,
  Priority,
  Prisma,
  TaskStatus,
} from "@prisma/client";
import { prisma } from "../db";
import { ACTIVE_TASK_STATUSES } from "../constants";
import { todayHotelDateYmd, zonedDayStartUtc } from "./attendance";
import {
  AppError,
  bumpDirtyAndRebindWork,
  deriveCleaningServiceType,
  resolveCycleForNewTask,
} from "./cleaning";
import { assertActiveCleaningAssignee } from "./assignees";
import { sectorSnapshotForLocation } from "./dataScope";
import { assertActiveShiftId } from "./sectors";
import { getOperations } from "./settings";

const PRIORITY_RANK: Record<Priority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

const entryInclude = {
  location: { include: { floor: { include: { building: true } } } },
  cleaningTask: {
    include: {
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
    },
  },
  createdBy: true,
} satisfies Prisma.DailyPlanEntryInclude;

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

export type DailyPlanImportEntryInput = {
  buildingCode: string;
  roomNumber: string;
  category: DailyPlanCategory;
  notes?: string;
  externalId?: string;
};

export type DailyPlanImportPayload = {
  hotelDate: string;
  sourceLabel: string;
  entries: DailyPlanImportEntryInput[];
};

type ImportError = {
  index: number;
  room?: string;
  reason: string;
};

function parseHotelDate(hotelDate: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hotelDate)) {
    throw new AppError(400, "validation", "hotelDate must be YYYY-MM-DD");
  }
  return new Date(`${hotelDate}T00:00:00.000Z`);
}

function formatHotelDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mapEntry(entry: Prisma.DailyPlanEntryGetPayload<{ include: typeof entryInclude }>) {
  const loc = entry.location;
  const task = entry.cleaningTask;
  return {
    id: entry.id,
    hotelDate: formatHotelDate(entry.hotelDate),
    category: entry.category,
    notes: entry.notes,
    source: entry.source,
    externalId: entry.externalId,
    createdAt: entry.createdAt.toISOString(),
    createdBy: {
      id: entry.createdBy.id,
      fullName: entry.createdBy.fullName,
      employeeNumber: entry.createdBy.employeeNumber,
    },
    room: {
      id: loc.id,
      number: loc.number,
      buildingCode: loc.floor.building.code,
      buildingName: loc.floor.building.name,
      floor: loc.floor.number,
      occupancy: loc.occupancy,
      cleaningStatus: loc.cleaningStatus,
    },
    task: task
      ? {
          id: task.id,
          status: task.status,
          priority: task.priority,
          sector: task.sector
            ? {
                id: task.sector.id,
                code: task.sector.code,
                nameBg: task.sector.nameBg,
                nameEn: task.sector.nameEn,
              }
            : null,
          sectorSupervisor: task.sectorSupervisor
            ? {
                id: task.sectorSupervisor.id,
                fullName: task.sectorSupervisor.fullName,
                employeeNumber: task.sectorSupervisor.employeeNumber,
              }
            : null,
          assignedEmployee: task.assignedEmployee
            ? {
                id: task.assignedEmployee.id,
                fullName: task.assignedEmployee.fullName,
                employeeNumber: task.assignedEmployee.employeeNumber,
              }
            : null,
          shift: task.shift
            ? {
                id: task.shift.id,
                code: task.shift.code,
                nameBg: task.shift.nameBg,
                nameEn: task.shift.nameEn,
                startTime: task.shift.startTime,
                endTime: task.shift.endTime,
              }
            : null,
        }
      : null,
  };
}

function mapBatch(batch: {
  id: string;
  hotelDate: Date;
  sourceLabel: string;
  status: DailyPlanImportStatus;
  totalCount: number;
  createdCount: number;
  skippedCount: number;
  errorCount: number;
  errors: Prisma.JsonValue;
  createdByEmployeeId: string;
  createdAt: Date;
}) {
  return {
    id: batch.id,
    hotelDate: formatHotelDate(batch.hotelDate),
    sourceLabel: batch.sourceLabel,
    status: batch.status,
    totalCount: batch.totalCount,
    createdCount: batch.createdCount,
    skippedCount: batch.skippedCount,
    errorCount: batch.errorCount,
    errors: batch.errors,
    createdByEmployeeId: batch.createdByEmployeeId,
    createdAt: batch.createdAt.toISOString(),
  };
}

export async function getDailyPlan(
  hotelDate: string,
  locationFilter?: Prisma.LocationWhereInput,
) {
  const date = parseHotelDate(hotelDate);

  const entries = await prisma.dailyPlanEntry.findMany({
    where: {
      hotelDate: date,
      ...(locationFilter ? { location: locationFilter } : {}),
    },
    include: entryInclude,
    orderBy: [{ category: "asc" }, { createdAt: "asc" }],
  });

  const lastImport = await prisma.dailyPlanImportBatch.findFirst({
    where: { hotelDate: date },
    orderBy: { createdAt: "desc" },
  });

  const mapped = entries.map(mapEntry);
  return {
    date: hotelDate,
    departures: mapped.filter((e) => e.category === "departure"),
    arrivals: mapped.filter((e) => e.category === "arrival"),
    priority: mapped.filter((e) => e.category === "priority"),
    lastImport: lastImport ? mapBatch(lastImport) : null,
  };
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

async function applyPlanEntryEffects(
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

export async function createDailyPlanEntry(input: {
  hotelDate: string;
  locationId: string;
  category: DailyPlanCategory;
  notes?: string;
  assignedEmployeeId?: string;
  shiftId?: string | null;
  createdByEmployeeId: string;
}) {
  const hotelDate = parseHotelDate(input.hotelDate);
  const shiftId = await assertActiveShiftId(input.shiftId);

  const location = await prisma.location.findUnique({
    where: { id: input.locationId },
  });
  if (!location) {
    throw new AppError(404, "not_found", "Room not found");
  }
  if (location.kind !== LocationKind.room) {
    throw new AppError(400, "invalid_state", "Daily plan entries are for rooms only");
  }
  if (location.catalogStatus !== "active") {
    throw new AppError(400, "invalid_state", "Room is archived");
  }

  const existingEntry = await prisma.dailyPlanEntry.findUnique({
    where: {
      hotelDate_locationId_category: {
        hotelDate,
        locationId: input.locationId,
        category: input.category,
      },
    },
  });
  if (existingEntry) {
    throw new AppError(
      409,
      "conflict",
      "Plan entry already exists for this room/date/category",
    );
  }

  if (input.assignedEmployeeId) {
    await assertActiveCleaningAssignee(input.assignedEmployeeId);
  }

  const result = await prisma.$transaction(async (tx) => {
    const todayYmd = await todayHotelDateYmd();
    const effects = await applyPlanEntryEffects(
      tx,
      location,
      hotelDate,
      input.category,
      input.assignedEmployeeId,
      shiftId ?? undefined,
      todayYmd,
    );

    const entry = await tx.dailyPlanEntry.create({
      data: {
        hotelDate,
        locationId: location.id,
        category: input.category,
        notes: input.notes ?? null,
        source: DailyPlanSource.manual,
        cleaningTaskId: effects.cleaningTaskId,
        // Preserve for deferred departure confirm (even when task was skipped).
        assignedEmployeeId: input.assignedEmployeeId ?? null,
        shiftId: shiftId ?? null,
        roomEffectsAppliedAt: effects.roomEffectsApplied ? new Date() : null,
        createdByEmployeeId: input.createdByEmployeeId,
      },
      include: entryInclude,
    });

    return {
      entry: mapEntry(entry),
      effects: {
        occupancy: effects.occupancy,
        dirty: effects.dirty,
        task: effects.task,
        cleaningTaskId: effects.cleaningTaskId,
      },
    };
  });

  return result;
}

async function resolveRoomByBuildingAndNumber(
  buildingCode: string,
  roomNumber: string,
  locationFilter?: Prisma.LocationWhereInput,
): Promise<
  | { location: NonNullable<Awaited<ReturnType<typeof prisma.location.findFirst>>>; outOfScope: false }
  | { location: null; outOfScope: boolean }
> {
  const location = await prisma.location.findFirst({
    where: {
      number: roomNumber,
      kind: LocationKind.room,
      floor: { building: { code: buildingCode } },
    },
  });
  if (!location) {
    return { location: null, outOfScope: false };
  }
  if (locationFilter && Object.keys(locationFilter).length > 0) {
    const inScope = await prisma.location.findFirst({
      where: { id: location.id, ...locationFilter },
      select: { id: true },
    });
    if (!inScope) {
      return { location: null, outOfScope: true };
    }
  }
  return { location, outOfScope: false };
}

export async function importDailyPlan(
  payload: DailyPlanImportPayload,
  createdByEmployeeId: string,
  locationFilter?: Prisma.LocationWhereInput,
) {
  const hotelDate = parseHotelDate(payload.hotelDate);
  const sourceLabel = payload.sourceLabel.trim() || "clock";
  const entries = payload.entries;

  const batch = await prisma.dailyPlanImportBatch.create({
    data: {
      hotelDate,
      sourceLabel,
      status: DailyPlanImportStatus.failed,
      totalCount: entries.length,
      createdByEmployeeId,
      errors: [],
    },
  });

  let createdCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const errors: ImportError[] = [];
  const todayYmd = await todayHotelDateYmd();

  for (let index = 0; index < entries.length; index++) {
    const item = entries[index];
    const roomLabel = `${item.buildingCode} ${item.roomNumber}`;

    try {
      if (item.externalId) {
        const byExternal = await prisma.dailyPlanEntry.findUnique({
          where: {
            source_externalId: {
              source: DailyPlanSource.import,
              externalId: item.externalId,
            },
          },
        });
        if (byExternal) {
          skippedCount += 1;
          continue;
        }
      }

      const resolved = await resolveRoomByBuildingAndNumber(
        item.buildingCode,
        item.roomNumber,
        locationFilter,
      );
      if (!resolved.location) {
        errorCount += 1;
        errors.push({
          index,
          room: roomLabel,
          reason: resolved.outOfScope
            ? "Outside your permitted data scope"
            : "Room not found",
        });
        continue;
      }
      const location = resolved.location;
      if (location.catalogStatus !== "active") {
        errorCount += 1;
        errors.push({
          index,
          room: roomLabel,
          reason: "Room is archived",
        });
        continue;
      }

      const existing = await prisma.dailyPlanEntry.findUnique({
        where: {
          hotelDate_locationId_category: {
            hotelDate,
            locationId: location.id,
            category: item.category,
          },
        },
      });

      if (existing) {
        // manual wins; existing import is idempotent skip
        skippedCount += 1;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const effects = await applyPlanEntryEffects(
          tx,
          location,
          hotelDate,
          item.category,
          undefined,
          undefined,
          todayYmd,
        );

        await tx.dailyPlanEntry.create({
          data: {
            hotelDate,
            locationId: location.id,
            category: item.category,
            notes: item.notes ?? null,
            source: DailyPlanSource.import,
            externalId: item.externalId ?? null,
            importBatchId: batch.id,
            cleaningTaskId: effects.cleaningTaskId,
            roomEffectsAppliedAt: effects.roomEffectsApplied ? new Date() : null,
            createdByEmployeeId,
          },
        });
      });

      createdCount += 1;
    } catch (err) {
      errorCount += 1;
      const reason =
        err instanceof Error ? err.message : "Unexpected import error";
      errors.push({ index, room: roomLabel, reason });
    }
  }

  let status: DailyPlanImportStatus;
  if (createdCount === 0 && errorCount > 0) {
    status = DailyPlanImportStatus.failed;
  } else if (errorCount > 0) {
    status = DailyPlanImportStatus.partial;
  } else {
    status = DailyPlanImportStatus.completed;
  }

  const updated = await prisma.dailyPlanImportBatch.update({
    where: { id: batch.id },
    data: {
      status,
      createdCount,
      skippedCount,
      errorCount,
      errors,
    },
  });

  const plan = await getDailyPlan(payload.hotelDate, locationFilter);

  return {
    batch: mapBatch(updated),
    plan,
  };
}

export async function deleteDailyPlanEntry(id: string) {
  const existing = await prisma.dailyPlanEntry.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "not_found", "Plan entry not found");
  }
  await prisma.dailyPlanEntry.delete({ where: { id } });
  return { id, deleted: true };
}
