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
  // Carry this field through the payload or query.
  entry: Prisma.DailyPlanEntryGetPayload<{ include: typeof entryInclude }>,
// Begin block/object for the following statements.
) {
  // Local aliases for the nested location / optional linked task.
  const loc = entry.location;
  // Capture task for subsequent checks or writes.
  const task = entry.cleaningTask;
  // Flatten joins into the daily-plan list DTO (ISO dates, nested room/task).
  return {
    // Carry this field through the payload or query.
    id: entry.id,
    // Hotel calendar day as YYYY-MM-DD for clients.
    hotelDate: formatHotelDate(entry.hotelDate),
    // Carry this field through the payload or query.
    category: entry.category,
    // Carry this field through the payload or query.
    notes: entry.notes,
    // Carry this field through the payload or query.
    source: entry.source,
    // Carry this field through the payload or query.
    externalId: entry.externalId,
    // Carry this field through the payload or query.
    createdAt: entry.createdAt.toISOString(),
    // Who created the plan entry (manual / import actor).
    createdBy: {
      // Carry this field through the payload or query.
      id: entry.createdBy.id,
      // Carry this field through the payload or query.
      fullName: entry.createdBy.fullName,
      // Carry this field through the payload or query.
      employeeNumber: entry.createdBy.employeeNumber,
    },
    // Room card with building/floor + live occupancy/cleaning.
    room: {
      // Carry this field through the payload or query.
      id: loc.id,
      // Carry this field through the payload or query.
      number: loc.number,
      // Carry this field through the payload or query.
      buildingCode: loc.floor.building.code,
      // Carry this field through the payload or query.
      buildingName: loc.floor.building.name,
      // Carry this field through the payload or query.
      floor: loc.floor.number,
      // Carry this field through the payload or query.
      occupancy: loc.occupancy,
      // Carry this field through the payload or query.
      cleaningStatus: loc.cleaningStatus,
    },
    // Null until a cleaning task is linked/created for this entry.
    task: task
      // Begin block/object for the following statements.
      ? {
          // Carry this field through the payload or query.
          id: task.id,
          // Carry this field through the payload or query.
          status: task.status,
          // Carry this field through the payload or query.
          priority: task.priority,
          // Snapshotted sector at task create (may be null).
          sector: task.sector
            // Begin block/object for the following statements.
            ? {
                // Carry this field through the payload or query.
                id: task.sector.id,
                // Carry this field through the payload or query.
                code: task.sector.code,
                // Carry this field through the payload or query.
                nameBg: task.sector.nameBg,
                // Carry this field through the payload or query.
                nameEn: task.sector.nameEn,
              }
            // Continue the previous expression with this clause.
            : null,
          // Snapshotted sector supervisor for display / notify.
          sectorSupervisor: task.sectorSupervisor
            // Begin block/object for the following statements.
            ? {
                // Carry this field through the payload or query.
                id: task.sectorSupervisor.id,
                // Carry this field through the payload or query.
                fullName: task.sectorSupervisor.fullName,
                // Carry this field through the payload or query.
                employeeNumber: task.sectorSupervisor.employeeNumber,
              }
            // Continue the previous expression with this clause.
            : null,
          // Assignee may be null for unassigned plan-linked tasks.
          assignedEmployee: task.assignedEmployee
            // Begin block/object for the following statements.
            ? {
                // Carry this field through the payload or query.
                id: task.assignedEmployee.id,
                // Carry this field through the payload or query.
                fullName: task.assignedEmployee.fullName,
                // Carry this field through the payload or query.
                employeeNumber: task.assignedEmployee.employeeNumber,
              }
            // Continue the previous expression with this clause.
            : null,
          // Optional shift card for roster filtering.
          shift: task.shift
            // Begin block/object for the following statements.
            ? {
                // Carry this field through the payload or query.
                id: task.shift.id,
                // Carry this field through the payload or query.
                code: task.shift.code,
                // Carry this field through the payload or query.
                nameBg: task.shift.nameBg,
                // Carry this field through the payload or query.
                nameEn: task.shift.nameEn,
                // Carry this field through the payload or query.
                startTime: task.shift.startTime,
                // Carry this field through the payload or query.
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
  // Carry this field through the payload or query.
  id: string;
  // Carry this field through the payload or query.
  hotelDate: Date;
  // Carry this field through the payload or query.
  sourceLabel: string;
  // Carry this field through the payload or query.
  status: DailyPlanImportStatus;
  // Carry this field through the payload or query.
  totalCount: number;
  // Carry this field through the payload or query.
  createdCount: number;
  // Carry this field through the payload or query.
  skippedCount: number;
  // Carry this field through the payload or query.
  errorCount: number;
  // Carry this field through the payload or query.
  errors: Prisma.JsonValue;
  // Carry this field through the payload or query.
  createdByEmployeeId: string;
  // Carry this field through the payload or query.
  createdAt: Date;
// Begin block/object for the following statements.
}) {
  // Counters + opaque errors JSON for the last-import banner.
  return {
    // Carry this field through the payload or query.
    id: batch.id,
    // Normalize Prisma Date key to YYYY-MM-DD.
    hotelDate: formatHotelDate(batch.hotelDate),
    // Carry this field through the payload or query.
    sourceLabel: batch.sourceLabel,
    // Carry this field through the payload or query.
    status: batch.status,
    // Carry this field through the payload or query.
    totalCount: batch.totalCount,
    // Carry this field through the payload or query.
    createdCount: batch.createdCount,
    // Carry this field through the payload or query.
    skippedCount: batch.skippedCount,
    // Carry this field through the payload or query.
    errorCount: batch.errorCount,
    // Opaque JSON array/object of per-row import errors.
    errors: batch.errors,
    // Carry this field through the payload or query.
    createdByEmployeeId: batch.createdByEmployeeId,
    // Carry this field through the payload or query.
    createdAt: batch.createdAt.toISOString(),
  };
}
