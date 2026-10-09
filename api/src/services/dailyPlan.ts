import {
  DailyPlanCategory,
  DailyPlanImportStatus,
  DailyPlanSource,
  LocationKind,
  Prisma,
} from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { assertActiveCleaningAssignee } from "./assignees";
import {
  applyPlanEntryEffects,
  formatHotelDate,
  parseHotelDate,
} from "./dailyPlanEffects";
import { todayHotelDateYmd } from "./hotelTime";
import { assertActiveShiftId } from "./shifts";

export {
  applyDepartureRoomEffects,
  classifyDepartureRoomEffects,
  ensureDepartureRoomEffects,
  type DepartureRoomEffectsDecision,
  type DepartureRoomEffectsResult,
} from "./dailyPlanEffects";


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
