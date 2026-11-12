/**
 * Shift catalog CRUD and per-hotel-date employee roster (full replace on upsert).
 */
import { Prisma } from "@prisma/client";
// Module dependency import.
import { prisma } from "../../db";
// Module dependency import.
import { AppError } from "../../errors";
// Import module ../db/prismaErrors for this service.
import { isP2002 } from "../db/prismaErrors";
// Import module ../audit for this service.
import { recordAudit } from "../audit";
// Import module ../dailyPlanEffects/hotelDate for this service.
import { parseHotelDate } from "../dailyPlanEffects/hotelDate";
// Import module ../hotelTime for this service.
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
  // Set id on the structure being built.
  id: string;
  // Set code on the structure being built.
  code: string;
  // Set nameBg on the structure being built.
  nameBg: string;
  // Set nameEn on the structure being built.
  nameEn: string;
  // Set startTime on the structure being built.
  startTime: string;
  // Set endTime on the structure being built.
  endTime: string;
  // Set sortOrder on the structure being built.
  sortOrder: number;
  // Set isActive on the structure being built.
  isActive: boolean;
  // Set createdAt on the structure being built.
  createdAt: Date;
  // Set updatedAt on the structure being built.
  updatedAt: Date;
// Run next step: }) {
}) {
  // Pass-through DTO — keeps list/create/update response shapes aligned.
  return {
    // Set id on the structure being built.
    id: shift.id,
    // Set code on the structure being built.
    code: shift.code,
    // Set nameBg on the structure being built.
    nameBg: shift.nameBg,
    // Set nameEn on the structure being built.
    nameEn: shift.nameEn,
    // Set startTime on the structure being built.
    startTime: shift.startTime,
    // Set endTime on the structure being built.
    endTime: shift.endTime,
    // Set sortOrder on the structure being built.
    sortOrder: shift.sortOrder,
    // Set isActive on the structure being built.
    isActive: shift.isActive,
    // Set createdAt on the structure being built.
    createdAt: shift.createdAt,
    // Set updatedAt on the structure being built.
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
    // Set where on the structure being built.
    where: includeInactive ? undefined : { isActive: true },
    // Set orderBy on the structure being built.
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });
  // Return the computed result to the caller.
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
  // Set code on the structure being built.
  code: string;
  // Set nameBg on the structure being built.
  nameBg: string;
  // Set nameEn on the structure being built.
  nameEn: string;
  // Set startTime on the structure being built.
  startTime: string;
  // Set endTime on the structure being built.
  endTime: string;
  // Run next step: sortOrder?: number;
  sortOrder?: number;
  // Run next step: isActive?: boolean;
  isActive?: boolean;
// Run next step: }) {
}) {
  // Validate wall-clock bounds before insert.
  assertHhMm(input.startTime, "startTime");
  // Run next step: assertHhMm(input.endTime, "endTime");
  assertHhMm(input.endTime, "endTime");
  // Codes are stored uppercase for uniqueness / display consistency.
  const code = input.code.trim().toUpperCase();
  // Branch when this condition holds so the right path runs.
  if (!code) {
    // Empty code after trim/uppercase is invalid.
    throw new AppError(400, "validation", "code is required");
  }
  // Attempt the fallible work so errors can be handled below.
  try {
    // Insert shift definition row (wall-clock bounds stored as strings).
    const shift = await prisma.shift.create({
      // Set data on the structure being built.
      data: {
        // Run next step: code,
        code,
        // Set nameBg on the structure being built.
        nameBg: input.nameBg.trim(),
        // Set nameEn on the structure being built.
        nameEn: input.nameEn.trim(),
        // Set startTime on the structure being built.
        startTime: input.startTime,
        // Set endTime on the structure being built.
        endTime: input.endTime,
        // Set sortOrder on the structure being built.
        sortOrder: input.sortOrder ?? 0,
        // Set isActive on the structure being built.
        isActive: input.isActive ?? true,
      },
    });
    // Return the computed result to the caller.
    return mapShift(shift);
  // Run next step: } catch (err) {
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
  // Set id on the structure being built.
  id: string,
  // Set input on the structure being built.
  input: {
    // Run next step: code?: string;
    code?: string;
    // Run next step: nameBg?: string;
    nameBg?: string;
    // Run next step: nameEn?: string;
    nameEn?: string;
    // Run next step: startTime?: string;
    startTime?: string;
    // Run next step: endTime?: string;
    endTime?: string;
    // Run next step: sortOrder?: number;
    sortOrder?: number;
    // Run next step: isActive?: boolean;
    isActive?: boolean;
  },
// Run next step: ) {
) {
  // 404 before patching unknown ids.
  const existing = await prisma.shift.findUnique({ where: { id } });
  // Branch when this condition holds so the right path runs.
  if (!existing) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", "Shift not found");
  }
  // Validate only fields present in the patch.
  // Partial patch — omitted fields keep existing values.
  if (input.startTime !== undefined) assertHhMm(input.startTime, "startTime");
  // Branch when this condition holds so the right path runs.
  if (input.endTime !== undefined) assertHhMm(input.endTime, "endTime");

  // Attempt the fallible work so errors can be handled below.
  try {
    // Partial metadata patch of defined fields only.
    const shift = await prisma.shift.update({
      // Set where on the structure being built.
      where: { id },
      // Set data on the structure being built.
      data: {
        // Set code on the structure being built.
        code:
          // Run next step: input.code !== undefined ? input.code.trim().toUpperCase() :…
          input.code !== undefined ? input.code.trim().toUpperCase() : undefined,
        // Set nameBg on the structure being built.
        nameBg: input.nameBg !== undefined ? input.nameBg.trim() : undefined,
        // Set nameEn on the structure being built.
        nameEn: input.nameEn !== undefined ? input.nameEn.trim() : undefined,
        // Set startTime on the structure being built.
        startTime: input.startTime,
        // Set endTime on the structure being built.
        endTime: input.endTime,
        // Set sortOrder on the structure being built.
        sortOrder: input.sortOrder,
        // Set isActive on the structure being built.
        isActive: input.isActive,
      },
    });
    // Return the computed result to the caller.
    return mapShift(shift);
  // Run next step: } catch (err) {
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
  // Set shiftId on the structure being built.
  shiftId: string | null | undefined,
// Run next step: ): Promise<string | null | undefined> {
): Promise<string | null | undefined> {
  // undefined = field omitted (leave unchanged); null/"" = clear assignment.
  if (shiftId === undefined) return undefined;
  // Branch when this condition holds so the right path runs.
  if (shiftId === null || shiftId === "") return null;
  // Load shift asynchronously for the next steps.
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  // Branch when this condition holds so the right path runs.
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
  // Set id on the structure being built.
  id: string;
  // Set employeeId on the structure being built.
  employeeId: string;
  // Set hotelDate on the structure being built.
  hotelDate: Date;
  // Set shiftId on the structure being built.
  shiftId: string;
  // Set createdAt on the structure being built.
  createdAt: Date;
  // Set updatedAt on the structure being built.
  updatedAt: Date;
  // Set employee on the structure being built.
  employee: { id: string; fullName: string; employeeNumber: string };
  // Set shift on the structure being built.
  shift: {
    // Set id on the structure being built.
    id: string;
    // Set code on the structure being built.
    code: string;
    // Set nameBg on the structure being built.
    nameBg: string;
    // Set nameEn on the structure being built.
    nameEn: string;
    // Set startTime on the structure being built.
    startTime: string;
    // Set endTime on the structure being built.
    endTime: string;
  };
// Run next step: }) {
}) {
  // Nested employee/shift objects for the roster UI.
  return {
    // Set id on the structure being built.
    id: row.id,
    // Set hotelDate on the structure being built.
    hotelDate: formatHotelDate(row.hotelDate),
    // Set employee on the structure being built.
    employee: {
      // Set id on the structure being built.
      id: row.employee.id,
      // Set fullName on the structure being built.
      fullName: row.employee.fullName,
      // Set employeeNumber on the structure being built.
      employeeNumber: row.employee.employeeNumber,
    },
    // Set shift on the structure being built.
    shift: {
      // Set id on the structure being built.
      id: row.shift.id,
      // Set code on the structure being built.
      code: row.shift.code,
      // Set nameBg on the structure being built.
      nameBg: row.shift.nameBg,
      // Set nameEn on the structure being built.
      nameEn: row.shift.nameEn,
      // Set startTime on the structure being built.
      startTime: row.shift.startTime,
      // Set endTime on the structure being built.
      endTime: row.shift.endTime,
    },
    // Set createdAt on the structure being built.
    createdAt: row.createdAt.toISOString(),
    // Set updatedAt on the structure being built.
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Prisma include for roster list/upsert responses. */
const rosterInclude = {
  // Set employee on the structure being built.
  employee: {
    // Set select on the structure being built.
    select: { id: true, fullName: true, employeeNumber: true },
  },
  // Set shift on the structure being built.
  shift: {
    // Set select on the structure being built.
    select: {
      // Set id on the structure being built.
      id: true,
      // Set code on the structure being built.
      code: true,
      // Set nameBg on the structure being built.
      nameBg: true,
      // Set nameEn on the structure being built.
      nameEn: true,
      // Set startTime on the structure being built.
      startTime: true,
      // Set endTime on the structure being built.
      endTime: true,
    },
  },
// Run next step: } satisfies Prisma.EmployeeShiftRosterInclude;
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
    // Set where on the structure being built.
    where: { hotelDate: date },
    // Set include on the structure being built.
    include: rosterInclude,
    // Set orderBy on the structure being built.
    orderBy: [
      // Run next step: { shift: { sortOrder: "asc" } },
      { shift: { sortOrder: "asc" } },
      // Run next step: { employee: { fullName: "asc" } },
      { employee: { fullName: "asc" } },
    ],
  });
  // Return the computed result to the caller.
  return {
    // Run next step: hotelDate,
    hotelDate,
    // Set entries on the structure being built.
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
  // Set hotelDate on the structure being built.
  hotelDate: string;
  // Set entries on the structure being built.
  entries: Array<{ employeeId: string; shiftId: string }>;
  // Run next step: actorEmployeeId?: string;
  actorEmployeeId?: string;
// Run next step: }) {
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
      // Run next step: 400,
      400,
      // Run next step: "validation",
      "validation",
      // Run next step: "Duplicate employeeId in roster entries",
      "Duplicate employeeId in roster entries",
    );
  }

  // Every employeeId must exist.
  const employees = await prisma.employee.findMany({
    // Set where on the structure being built.
    where: { id: { in: employeeIds } },
    // Set select on the structure being built.
    select: { id: true },
  });
  // Branch when this condition holds so the right path runs.
  if (employees.length !== employeeIds.length) {
    // Any missing id fails the whole replace (no partial roster).
    throw new AppError(400, "validation", "One or more employees not found");
  }

  // Every shiftId must exist and be active.
  const shifts = await prisma.shift.findMany({
    // Set where on the structure being built.
    where: { id: { in: shiftIds } },
  });
  // Branch when this condition holds so the right path runs.
  if (shifts.length !== shiftIds.length) {
    // Abort with an error so callers can react.
    throw new AppError(400, "validation", "One or more shifts not found");
  }
  // Capture inactive for use in this scope.
  const inactive = shifts.filter((s) => !s.isActive);
  // Branch when this condition holds so the right path runs.
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
    // Wait for the async step before continuing.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${rosterLockKey}))`;

    // Wipe prior rows for this hotelDate key.
    await tx.employeeShiftRoster.deleteMany({ where: { hotelDate } });
    // Branch when this condition holds so the right path runs.
    if (input.entries.length) {
      // Wait for the async step before continuing.
      await tx.employeeShiftRoster.createMany({
        // Set data on the structure being built.
        data: input.entries.map((e) => ({
          // Set employeeId on the structure being built.
          employeeId: e.employeeId,
          // Run next step: hotelDate,
          hotelDate,
          // Set shiftId on the structure being built.
          shiftId: e.shiftId,
        })),
      });
    }
    // Audit full replacement payload for the hotel date.
    await recordAudit({
      // Set actorEmployeeId on the structure being built.
      actorEmployeeId: input.actorEmployeeId,
      // Set action on the structure being built.
      action: "shift.roster.upsert",
      // Set entityType on the structure being built.
      entityType: "shift_roster",
      // Set entityId on the structure being built.
      entityId: input.hotelDate,
      // Set after on the structure being built.
      after: {
        // Set hotelDate on the structure being built.
        hotelDate: input.hotelDate,
        // Set entries on the structure being built.
        entries: input.entries,
      },
      // Set summary on the structure being built.
      summary: `Updated shift roster for ${input.hotelDate} (${input.entries.length} entries)`,
    // Run next step: }, tx);
    }, tx);
  });

  // Return the fresh mapped roster for the response.
  return listShiftRoster(input.hotelDate);
}
