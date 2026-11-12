/**
 * Daily plan Prisma include shape and import payload types.
 */
import { DailyPlanCategory, Prisma } from "@prisma/client";

/** Relations returned with daily plan entry API payloads. */
export const entryInclude = {
  location: { include: { floor: { include: { building: true } } } },
  // Open nested structure for the next related fields.
  cleaningTask: {
    // Eager-load relations needed by the API response shape.
    include: {
      assignedEmployee: true,
      // Open nested structure for the next related fields.
      shift: {
        // Project only the columns the caller needs.
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
      // Open nested structure for the next related fields.
      sectorSupervisor: {
        // Project only the columns the caller needs.
        select: { id: true, fullName: true, employeeNumber: true },
      },
    },
  },
  createdBy: true,
// Execute: } satisfies Prisma.DailyPlanEntryInclude;
} satisfies Prisma.DailyPlanEntryInclude;

/** One row in a bulk import payload (resolved by building code + room number). */
export type DailyPlanImportEntryInput = {
  buildingCode: string;
  roomNumber: string;
  category: DailyPlanCategory;
  // Parameter/field in the surrounding signature or type.
  notes?: string;
  // Parameter/field in the surrounding signature or type.
  externalId?: string;
};

/** Bulk import request body for a single hotel date. */
export type DailyPlanImportPayload = {
  hotelDate: string;
  sourceLabel: string;
  entries: DailyPlanImportEntryInput[];
};

/** Per-row failure recorded on the import batch. */
export type ImportError = {
  index: number;
  // Parameter/field in the surrounding signature or type.
  room?: string;
  reason: string;
};
