import { DailyPlanCategory, Prisma } from "@prisma/client";

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

export type ImportError = {
  index: number;
  room?: string;
  reason: string;
};
