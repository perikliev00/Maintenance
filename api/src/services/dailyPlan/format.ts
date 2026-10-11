import { DailyPlanImportStatus, Prisma } from "@prisma/client";
import { formatHotelDate } from "../dailyPlanEffects";
import { entryInclude } from "./types";

export function mapEntry(
  entry: Prisma.DailyPlanEntryGetPayload<{ include: typeof entryInclude }>,
) {
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

export function mapBatch(batch: {
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
