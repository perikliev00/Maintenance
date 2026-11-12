/**
 * Daily plan Prisma include shape and import payload types.
 */
import { DailyPlanCategory, Prisma } from "@prisma/client";

/** Relations returned with daily plan entry API payloads. */
export const entryInclude = {
  // Field value required by this payload or query.
  location: { include: { floor: { include: { building: true } } } },
  // Open nested structure for the next related fields.
  cleaningTask: {
    // Eager-load relations needed by the API response shape.
    include: {
      // Field value required by this payload or query.
      assignedEmployee: true,
      // Open nested structure for the next related fields.
      shift: {
        // Project only the columns the caller needs.
        select: {
          // Field value required by this payload or query.
          id: true,
          // Field value required by this payload or query.
          code: true,
          // Field value required by this payload or query.
          nameBg: true,
          // Field value required by this payload or query.
          nameEn: true,
          // Field value required by this payload or query.
          startTime: true,
          // Field value required by this payload or query.
          endTime: true,
        },
      },
      // Field value required by this payload or query.
      sector: { select: { id: true, code: true, nameBg: true, nameEn: true } },
      // Open nested structure for the next related fields.
      sectorSupervisor: {
        // Project only the columns the caller needs.
        select: { id: true, fullName: true, employeeNumber: true },
      },
    },
  },
  // Field value required by this payload or query.
  createdBy: true,
// Execute: } satisfies Prisma.DailyPlanEntryInclude;
} satisfies Prisma.DailyPlanEntryInclude;

/** One row in a bulk import payload (resolved by building code + room number). */
export type DailyPlanImportEntryInput = {
  // Carry this field through the payload or query.
  buildingCode: string;
  // Carry this field through the payload or query.
  roomNumber: string;
  // Carry this field through the payload or query.
  category: DailyPlanCategory;
  // Parameter/field in the surrounding signature or type.
  notes?: string;
  // Parameter/field in the surrounding signature or type.
  externalId?: string;
};

/** Bulk import request body for a single hotel date. */
export type DailyPlanImportPayload = {
  // Carry this field through the payload or query.
  hotelDate: string;
  // Carry this field through the payload or query.
  sourceLabel: string;
  // Carry this field through the payload or query.
  entries: DailyPlanImportEntryInput[];
};

/** Per-row failure recorded on the import batch. */
export type ImportError = {
  // Carry this field through the payload or query.
  index: number;
  // Parameter/field in the surrounding signature or type.
  room?: string;
  // Carry this field through the payload or query.
  reason: string;
};
