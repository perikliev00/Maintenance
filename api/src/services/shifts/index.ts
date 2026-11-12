/**
 * Shift catalog CRUD and per-hotel-date employee roster (full replace on upsert).
 */
import { Prisma } from "@prisma/client";
// Module dependency import.
import { prisma } from "../../db";
// Module dependency import.
import { AppError } from "../../errors";
import { isP2002 } from "../db/prismaErrors";
import { recordAudit } from "../audit";
import { parseHotelDate } from "../dailyPlanEffects/hotelDate";
import { formatHotelDate } from "../hotelTime";

// Capture hh mm for use in this scope.
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Reject non-HH:mm 24h clock strings.
 *
 * @param value - Raw time string from the API body.
 * @param field - Field name for validation error messages.
 */
function assertHhMm(value: string, field: string) {
  // Strict 24h HH:mm — used for startTime/endTime validation.
  if (!HH_MM.test(value)) {
    // Reject free-text times — roster UI sends HH:mm only.
    throw new AppError(400, "validation", `${field} must be HH:mm`);
  }
}

/**
 * Map a Prisma Shift row to the API DTO (Date fields pass through).
 *
 * @param shift - Shift row from list/create/update queries.
 */
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
  // Pass-through DTO — keeps list/create/update response shapes aligned.
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

/**
 * List shifts ordered by sortOrder/code; inactive excluded unless requested.
 *
 * @param includeInactive - When true, returns deactivated shift definitions.
 */
export async function listShifts(includeInactive = false) {
  // Default catalog view hides inactive shifts.
  const rows = await prisma.shift.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
  return rows.map(mapShift);
}

/**
 * Create a shift; codes are uppercased and must be unique.
 *
 * @param input.code - Short uppercase identifier (unique).
 * @param input.startTime - Inclusive shift start (HH:mm).
 * @param input.endTime - Shift end (HH:mm, may cross midnight in UI).
 */
export async function createShift(input: {
  code: string;
  nameBg: string;
  nameEn: string;
  startTime: string;
  endTime: string;
  sortOrder?: number;
  isActive?: boolean;
}) {
  // Validate wall-clock bounds before insert.
  assertHhMm(input.startTime, "startTime");
  assertHhMm(input.endTime, "endTime");
  // Codes are stored uppercase for uniqueness / display consistency.
  const code = input.code.trim().toUpperCase();
  if (!code) {
    // Empty code after trim/uppercase is invalid.
    throw new AppError(400, "validation", "code is required");
  }
  try {
    // Insert shift definition row (wall-clock bounds stored as strings).
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
    // Unique code conflict → 409 for the client.
    if (isP2002(err)) {
      // Abort with an error so callers can react.
      throw new AppError(409, "conflict", "Shift code already exists");
    }
    // Abort with an error so callers can react.
    throw err;
  }
}

/**
 * Patch a shift; P2002 on code maps to conflict.
 *
 * @param id - Shift primary key.
 * @param input - Partial metadata patch.
 */
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
  // 404 before patching unknown ids.
  const existing = await prisma.shift.findUnique({ where: { id } });
  if (!existing) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", "Shift not found");
  }
  // Validate only fields present in the patch.
  // Partial patch — omitted fields keep existing values.
  if (input.startTime !== undefined) assertHhMm(input.startTime, "startTime");
  if (input.endTime !== undefined) assertHhMm(input.endTime, "endTime");

  try {
    // Partial metadata patch of defined fields only.
    const shift = await prisma.shift.update({
      where: { id },
      data: {
        code:
          input.code !== undefined ? input.code.trim().toUpperCase() : undefined,
        nameBg: input.nameBg !== undefined ? input.nameBg.trim() : undefined,
        nameEn: input.nameEn !== undefined ? input.nameEn.trim() : undefined,
        startTime: input.startTime,
        endTime: input.endTime,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
      },
    });
    return mapShift(shift);
  } catch (err) {
    // Unique code conflict → 409.
    if (isP2002(err)) {
      // Abort with an error so callers can react.
      throw new AppError(409, "conflict", "Shift code already exists");
    }
    // Abort with an error so callers can react.
    throw err;
  }
}

/**
 * Resolve an active shift id, or null when clearing.
 *
 * @param shiftId - undefined omit, null/"" clear, otherwise must be active.
 */
export async function assertActiveShiftId(
  shiftId: string | null | undefined,
): Promise<string | null | undefined> {
  // undefined = field omitted (leave unchanged); null/"" = clear assignment.
  if (shiftId === undefined) return undefined;
  if (shiftId === null || shiftId === "") return null;
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", "Shift not found");
  }
  // Inactive shifts cannot be newly assigned.
  if (!shift.isActive) {
    // Historical roster rows may still reference inactive shifts.
    throw new AppError(400, "invalid_state", "Shift is inactive");
  }
  // Resolved canonical shift id for roster/attendance writes.
  return shift.id;
}

/** Flatten roster join (employee + shift) into the API entry shape. */
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
  // Nested employee/shift objects for the roster UI.
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

/** Prisma include for roster list/upsert responses. */
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

/**
 * Roster entries for one hotel date (YYYY-MM-DD), ordered by shift then name.
 *
 * @param hotelDate - Hotel calendar day key (YYYY-MM-DD).
 */
export async function listShiftRoster(hotelDate: string) {
  // Normalize to UTC-midnight Date key.
  const date = parseHotelDate(hotelDate);
  // All assignments for that hotel day, ordered for the roster board.
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

/**
 * Replace the entire roster for a hotel date (deleteMany + createMany).
 * Empty entries clears the day. Audits as shift.roster.upsert.
 *
 * @param input.hotelDate - Hotel calendar day key (YYYY-MM-DD).
 * @param input.entries - Full replacement set (one row per employee).
 * @param input.actorEmployeeId - Optional audit actor.
 */
export async function upsertShiftRoster(input: {
  hotelDate: string;
  entries: Array<{ employeeId: string; shiftId: string }>;
  actorEmployeeId?: string;
}) {
  // Normalize hotel date key for the replace.
  const hotelDate = parseHotelDate(input.hotelDate);

  // Capture employee ids for use in this scope.
  const employeeIds = input.entries.map((e) => e.employeeId);
  // Deduplicate shift ids for the existence query.
  const shiftIds = [...new Set(input.entries.map((e) => e.shiftId))];

  // One assignment per employee per day — duplicates would make delete/create ambiguous.
  if (new Set(employeeIds).size !== employeeIds.length) {
    // One row per employee per hotelDate — duplicates are ambiguous.
    throw new AppError(
      400,
      "validation",
      "Duplicate employeeId in roster entries",
    );
  }

  // Every employeeId must exist.
  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds } },
    select: { id: true },
  });
  if (employees.length !== employeeIds.length) {
    // Any missing id fails the whole replace (no partial roster).
    throw new AppError(400, "validation", "One or more employees not found");
  }

  // Every shiftId must exist and be active.
  const shifts = await prisma.shift.findMany({
    where: { id: { in: shiftIds } },
  });
  if (shifts.length !== shiftIds.length) {
    // Abort with an error so callers can react.
    throw new AppError(400, "validation", "One or more shifts not found");
  }
  const inactive = shifts.filter((s) => !s.isActive);
  if (inactive.length) {
    // New assignments must target active shift definitions only.
    throw new AppError(400, "invalid_state", "Cannot assign inactive shift");
  }

  // Full replace for the day: clear then insert (empty entries → clear only).
  // Serialize per hotelDate so concurrent PUTs cannot both delete then insert
  // overlapping (employeeId, hotelDate) rows (P2002 → HTTP 500). Second writer
  // waits, then LWW-replaces — same pattern as ticket duplicate advisory locks.
  await prisma.$transaction(async (tx) => {
    // Capture roster lock key for use in this scope.
    const rosterLockKey = `shift-roster:${input.hotelDate}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${rosterLockKey}))`;

    // Wipe prior rows for this hotelDate key.
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
    // Audit full replacement payload for the hotel date.
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

  // Return the fresh mapped roster for the response.
  return listShiftRoster(input.hotelDate);
}
