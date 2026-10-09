import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { AppError } from "../errors";
import { recordAudit } from "./audit";

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

function assertHhMm(value: string, field: string) {
  if (!HH_MM.test(value)) {
    throw new AppError(400, "validation", `${field} must be HH:mm`);
  }
}

function mapShift(shift: {
  id: string;
  code: string;
  nameBg: string;
  nameEn: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: shift.id,
    code: shift.code,
    nameBg: shift.nameBg,
    nameEn: shift.nameEn,
    startTime: shift.startTime,
    endTime: shift.endTime,
    sortOrder: shift.sortOrder,
    isActive: shift.isActive,
    createdAt: shift.createdAt,
    updatedAt: shift.updatedAt,
  };
}

export async function listShifts(includeInactive = false) {
  const rows = await prisma.shift.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
  return rows.map(mapShift);
}

export async function createShift(input: {
  code: string;
  nameBg: string;
  nameEn: string;
  startTime: string;
  endTime: string;
  sortOrder?: number;
  isActive?: boolean;
}) {
  assertHhMm(input.startTime, "startTime");
  assertHhMm(input.endTime, "endTime");
  const code = input.code.trim().toUpperCase();
  if (!code) {
    throw new AppError(400, "validation", "code is required");
  }
  try {
    const shift = await prisma.shift.create({
      data: {
        code,
        nameBg: input.nameBg.trim(),
        nameEn: input.nameEn.trim(),
        startTime: input.startTime,
        endTime: input.endTime,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      },
    });
    return mapShift(shift);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new AppError(409, "conflict", "Shift code already exists");
    }
    throw err;
  }
}

export async function updateShift(
  id: string,
  input: {
    code?: string;
    nameBg?: string;
    nameEn?: string;
    startTime?: string;
    endTime?: string;
    sortOrder?: number;
    isActive?: boolean;
  },
) {
  const existing = await prisma.shift.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, "not_found", "Shift not found");
  }
  if (input.startTime !== undefined) assertHhMm(input.startTime, "startTime");
  if (input.endTime !== undefined) assertHhMm(input.endTime, "endTime");

  try {
    const shift = await prisma.shift.update({
      where: { id },
      data: {
        ...(input.code !== undefined
          ? { code: input.code.trim().toUpperCase() }
          : {}),
        ...(input.nameBg !== undefined ? { nameBg: input.nameBg.trim() } : {}),
        ...(input.nameEn !== undefined ? { nameEn: input.nameEn.trim() } : {}),
        ...(input.startTime !== undefined ? { startTime: input.startTime } : {}),
        ...(input.endTime !== undefined ? { endTime: input.endTime } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    return mapShift(shift);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new AppError(409, "conflict", "Shift code already exists");
    }
    throw err;
  }
}

/** Resolve an active shift id, or null when clearing. */
export async function assertActiveShiftId(
  shiftId: string | null | undefined,
): Promise<string | null | undefined> {
  if (shiftId === undefined) return undefined;
  if (shiftId === null || shiftId === "") return null;
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) {
    throw new AppError(404, "not_found", "Shift not found");
  }
  if (!shift.isActive) {
    throw new AppError(400, "invalid_state", "Shift is inactive");
  }
  return shift.id;
}

function parseHotelDate(hotelDate: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hotelDate)) {
    throw new AppError(400, "validation", "hotelDate must be YYYY-MM-DD");
  }
  return new Date(`${hotelDate}T00:00:00.000Z`);
}

function formatHotelDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mapRosterRow(row: {
  id: string;
  employeeId: string;
  hotelDate: Date;
  shiftId: string;
  createdAt: Date;
  updatedAt: Date;
  employee: { id: string; fullName: string; employeeNumber: string };
  shift: {
    id: string;
    code: string;
    nameBg: string;
    nameEn: string;
    startTime: string;
    endTime: string;
  };
}) {
  return {
    id: row.id,
    hotelDate: formatHotelDate(row.hotelDate),
    employee: {
      id: row.employee.id,
      fullName: row.employee.fullName,
      employeeNumber: row.employee.employeeNumber,
    },
    shift: {
      id: row.shift.id,
      code: row.shift.code,
      nameBg: row.shift.nameBg,
      nameEn: row.shift.nameEn,
      startTime: row.shift.startTime,
      endTime: row.shift.endTime,
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const rosterInclude = {
  employee: {
    select: { id: true, fullName: true, employeeNumber: true },
  },
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
} satisfies Prisma.EmployeeShiftRosterInclude;

export async function listShiftRoster(hotelDate: string) {
  const date = parseHotelDate(hotelDate);
  const rows = await prisma.employeeShiftRoster.findMany({
    where: { hotelDate: date },
    include: rosterInclude,
    orderBy: [
      { shift: { sortOrder: "asc" } },
      { employee: { fullName: "asc" } },
    ],
  });
  return {
    hotelDate,
    entries: rows.map(mapRosterRow),
  };
}

export async function upsertShiftRoster(input: {
  hotelDate: string;
  entries: Array<{ employeeId: string; shiftId: string }>;
  actorEmployeeId?: string;
}) {
  const hotelDate = parseHotelDate(input.hotelDate);

  const employeeIds = input.entries.map((e) => e.employeeId);
  const shiftIds = [...new Set(input.entries.map((e) => e.shiftId))];

  if (new Set(employeeIds).size !== employeeIds.length) {
    throw new AppError(
      400,
      "validation",
      "Duplicate employeeId in roster entries",
    );
  }

  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds } },
    select: { id: true },
  });
  if (employees.length !== employeeIds.length) {
    throw new AppError(400, "validation", "One or more employees not found");
  }

  const shifts = await prisma.shift.findMany({
    where: { id: { in: shiftIds } },
  });
  if (shifts.length !== shiftIds.length) {
    throw new AppError(400, "validation", "One or more shifts not found");
  }
  const inactive = shifts.filter((s) => !s.isActive);
  if (inactive.length) {
    throw new AppError(400, "invalid_state", "Cannot assign inactive shift");
  }

  await prisma.$transaction(async (tx) => {
    await tx.employeeShiftRoster.deleteMany({ where: { hotelDate } });
    if (input.entries.length) {
      await tx.employeeShiftRoster.createMany({
        data: input.entries.map((e) => ({
          employeeId: e.employeeId,
          hotelDate,
          shiftId: e.shiftId,
        })),
      });
    }
    await recordAudit({
      actorEmployeeId: input.actorEmployeeId,
      action: "shift.roster.upsert",
      entityType: "shift_roster",
      entityId: input.hotelDate,
      after: {
        hotelDate: input.hotelDate,
        entries: input.entries,
      },
      summary: `Updated shift roster for ${input.hotelDate} (${input.entries.length} entries)`,
    }, tx);
  });

  return listShiftRoster(input.hotelDate);
}

export async function getEmployeeRosterShiftId(
  employeeId: string,
  hotelDate: string | Date,
): Promise<string | null> {
  const date =
    typeof hotelDate === "string"
      ? parseHotelDate(hotelDate)
      : new Date(
          Date.UTC(
            hotelDate.getUTCFullYear(),
            hotelDate.getUTCMonth(),
            hotelDate.getUTCDate(),
          ),
        );
  const row = await prisma.employeeShiftRoster.findUnique({
    where: {
      employeeId_hotelDate: { employeeId, hotelDate: date },
    },
    select: { shiftId: true },
  });
  return row?.shiftId ?? null;
}
