/**
 * Map daily plan entries and import batches to API response shapes.
 */
import { DailyPlanImportStatus, Prisma } from "@prisma/client";
// Import ../dailyPlanEffects for dailyPlan/format.ts.
import { formatHotelDate } from "../dailyPlanEffects";
// Import ./types for dailyPlan/format.ts.
import { entryInclude } from "./types";

/**
 * Map a Prisma entry (+ location/task) to the daily-plan list DTO.
 * Flattens floor/building joins and nests the optional linked cleaning task.
 */
export function mapEntry(
  entry: Prisma.DailyPlanEntryGetPayload<{ include: typeof entryInclude }>,
) {
  // Local aliases for the nested location / optional linked task.
  const loc = entry.location;
  const task = entry.cleaningTask;
  // Flatten joins into the daily-plan list DTO (ISO dates, nested room/task).
  return {
    id: entry.id,
    // Hotel calendar day as YYYY-MM-DD for clients.
    hotelDate: formatHotelDate(entry.hotelDate),
    category: entry.category,
    notes: entry.notes,
    source: entry.source,
    externalId: entry.externalId,
    createdAt: entry.createdAt.toISOString(),
    // Who created the plan entry (manual / import actor).
    createdBy: {
      id: entry.createdBy.id,
      fullName: entry.createdBy.fullName,
      employeeNumber: entry.createdBy.employeeNumber,
    },
    // Room card with building/floor + live occupancy/cleaning.
    room: {
      id: loc.id,
      number: loc.number,
      buildingCode: loc.floor.building.code,
      buildingName: loc.floor.building.name,
      floor: loc.floor.number,
      occupancy: loc.occupancy,
      cleaningStatus: loc.cleaningStatus,
    },
    // Null until a cleaning task is linked/created for this entry.
    task: task
      ? {
          id: task.id,
          status: task.status,
          priority: task.priority,
          // Snapshotted sector at task create (may be null).
          sector: task.sector
            ? {
                id: task.sector.id,
                code: task.sector.code,
                nameBg: task.sector.nameBg,
                nameEn: task.sector.nameEn,
              }
            // Continue the previous expression with this clause.
            : null,
          // Snapshotted sector supervisor for display / notify.
          sectorSupervisor: task.sectorSupervisor
            ? {
                id: task.sectorSupervisor.id,
                fullName: task.sectorSupervisor.fullName,
                employeeNumber: task.sectorSupervisor.employeeNumber,
              }
            // Continue the previous expression with this clause.
            : null,
          // Assignee may be null for unassigned plan-linked tasks.
          assignedEmployee: task.assignedEmployee
            ? {
                id: task.assignedEmployee.id,
                fullName: task.assignedEmployee.fullName,
                employeeNumber: task.assignedEmployee.employeeNumber,
              }
            // Continue the previous expression with this clause.
            : null,
          // Optional shift card for roster filtering.
          shift: task.shift
            ? {
                id: task.shift.id,
                code: task.shift.code,
                nameBg: task.shift.nameBg,
                nameEn: task.shift.nameEn,
                startTime: task.shift.startTime,
                endTime: task.shift.endTime,
              }
            // Continue the previous expression with this clause.
            : null,
        }
      // Continue the previous expression with this clause.
      : null,
  };
}

/**
 * Map an import batch row to the API DTO (ISO timestamps, YMD hotelDate).
 * Counters + opaque errors JSON power the last-import banner.
 */
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
  // Counters + opaque errors JSON for the last-import banner.
  return {
    id: batch.id,
    // Normalize Prisma Date key to YYYY-MM-DD.
    hotelDate: formatHotelDate(batch.hotelDate),
    sourceLabel: batch.sourceLabel,
    status: batch.status,
    totalCount: batch.totalCount,
    createdCount: batch.createdCount,
    skippedCount: batch.skippedCount,
    errorCount: batch.errorCount,
    // Opaque JSON array/object of per-row import errors.
    errors: batch.errors,
    createdByEmployeeId: batch.createdByEmployeeId,
    createdAt: batch.createdAt.toISOString(),
  };
}
