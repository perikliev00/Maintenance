/**
 * Daily plan Prisma include shape and import payload types.
 */
import { DailyPlanCategory, Prisma } from "@prisma/client";

/** Relations returned with daily plan entry API payloads. */
export const entryInclude = {
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

/** One row in a bulk import payload (resolved by building code + room number). */
export type DailyPlanImportEntryInput = {
  buildingCode: string;
  roomNumber: string;
  category: DailyPlanCategory;
  notes?: string;
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
  room?: string;
  reason: string;
};
