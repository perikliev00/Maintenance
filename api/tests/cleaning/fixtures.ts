/**
 * Shared world + helpers for cleaning lifecycle integration tests (P1-11…P1-30).
 * Lives under api/tests/cleaning/ so it is outside the parallel npm test glob.
 */
import assert from "node:assert/strict";
// Import bindings from crypto.
import { randomUUID } from "crypto";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  AttendanceIntervalStatus,
  // Execute the next setup or assertion step for this scenario.
  CleaningStatus,
  // Execute the next setup or assertion step for this scenario.
  Prisma,
  // Execute the next setup or assertion step for this scenario.
  PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  Role,
  // Session/CSRF step exercising auth lifecycle.
  SessionStatus,
  // Execute the next setup or assertion step for this scenario.
  TaskStatus,
  // Execute the next setup or assertion step for this scenario.
  TicketStatus,
// Execute the next setup or assertion step for this scenario.
} from "@prisma/client";
// Import bindings from ../../src/errors.
import { AppError } from "../../src/errors";
// Import module bindings used by this suite.
import {
  // Session/CSRF step exercising auth lifecycle.
  cancelCleaningSession,
  // Execute the next setup or assertion step for this scenario.
  createCleaningTask,
  // Execute the next setup or assertion step for this scenario.
  startCleaningTask,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/cleaning";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  hotelDateString,
  // Execute the next setup or assertion step for this scenario.
  todayHotelDateYmd,
  // Execute the next setup or assertion step for this scenario.
  withHotelNowForTests,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/hotelTime";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  getFlags,
  // Execute the next setup or assertion step for this scenario.
  getOperations,
  // Execute the next setup or assertion step for this scenario.
  updateSetting,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/settings";
// Type-only import for compile-time contracts.
import type {
  // Delivery/replay step for async notification paths.
  FlagsSettings,
  // Delivery/replay step for async notification paths.
  OperationsSettings,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/settings/schema";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupEmployeeGraph,
  // Execute the next setup or assertion step for this scenario.
  createEmployeeWithUser,
  // Shape EmployeeUserFixture documents the fixture/response fields this suite touches.
  type EmployeeUserFixture,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../fixtures";

// Export CLN_PASSWORD for shared test/setup consumers.
export const CLN_PASSWORD = "test-password-cln";

// Export CleaningWorld for shared test/setup consumers.
export type CleaningWorld = {
  // Execute the next setup or assertion step for this scenario.
  stamp: string;
  // Execute the next setup or assertion step for this scenario.
  propertyId: string;
  // Execute the next setup or assertion step for this scenario.
  buildingId: string;
  // Execute the next setup or assertion step for this scenario.
  floorId: string;
  // Execute the next setup or assertion step for this scenario.
  locationAId: string;
  // Execute the next setup or assertion step for this scenario.
  locationBId: string;
  /** Full-day active shift used to mark housekeepers available for reassign. */
  availabilityShiftId: string;
  // Execute the next setup or assertion step for this scenario.
  hk1: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  hk2: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  owner: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  manager: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  reception: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  technician: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  employeeIds: string[];
};

// Export DualDayRunningSetup for shared test/setup consumers.
export type DualDayRunningSetup = {
  // Execute the next setup or assertion step for this scenario.
  day1Ymd: string;
  // Execute the next setup or assertion step for this scenario.
  day2Ymd: string;
  // Execute the next setup or assertion step for this scenario.
  day1TaskId: string;
  // Execute the next setup or assertion step for this scenario.
  day2TaskId: string;
  // Session/CSRF step exercising auth lifecycle.
  day1SessionId: string;
  // Session/CSRF step exercising auth lifecycle.
  day2SessionId: string;
  // Execute the next setup or assertion step for this scenario.
  day1Version: number;
  // Execute the next setup or assertion step for this scenario.
  day2Version: number;
};

// Export helper isAppError for reuse across related tests.
export function isAppError(
  // Execute the next setup or assertion step for this scenario.
  err: unknown,
// Execute the next setup or assertion step for this scenario.
): err is AppError {
  // Return the arranged value/result to the caller.
  return err instanceof AppError;
}

// Export helper errCode for reuse across related tests.
export function errCode(err: unknown): string | null {
  // Return the arranged value/result to the caller.
  return isAppError(err) ? err.code : null;
}

// Export helper hotelTodayYmd for reuse across related tests.
export async function hotelTodayYmd(): Promise<string> {
  // Return the arranged value/result to the caller.
  return todayHotelDateYmd();
}

// Export helper ymdOffset for reuse across related tests.
export function ymdOffset(ymd: string, days: number): string {
  // Bind d for later setup or assertions in this scope.
  const d = new Date(`${ymd}T00:00:00.000Z`);
  // Execute the next setup or assertion step for this scenario.
  d.setUTCDate(d.getUTCDate() + days);
  // Return the arranged value/result to the caller.
  return d.toISOString().slice(0, 10);
}

/** Create isolated two-room world with HK×2, owner, manager, reception, technician. */
export async function createCleaningWorld(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
// Execute the next setup or assertion step for this scenario.
): Promise<CleaningWorld> {
  // stamp: unique stamp so parallel runs do not collide.
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // hk1: seeded entity required before the mutation under test.
  const hk1 = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `CLN-HK1-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `cln-hk1-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.housekeeper,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "CLN Housekeeper 1",
    // Fixture field password for the seeded actor/entity.
    password: CLN_PASSWORD,
  });
  // hk2: seeded entity required before the mutation under test.
  const hk2 = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `CLN-HK2-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `cln-hk2-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.housekeeper,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "CLN Housekeeper 2",
    // Fixture field password for the seeded actor/entity.
    password: CLN_PASSWORD,
  });
  // owner: seeded entity required before the mutation under test.
  const owner = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `CLN-OWN-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `cln-own-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.owner,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "CLN Owner",
    // Fixture field password for the seeded actor/entity.
    password: CLN_PASSWORD,
  });
  // manager: seeded entity required before the mutation under test.
  const manager = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `CLN-MGR-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `cln-mgr-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.manager,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "CLN Manager",
    // Fixture field password for the seeded actor/entity.
    password: CLN_PASSWORD,
  });
  // reception: seeded entity required before the mutation under test.
  const reception = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `CLN-REC-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `cln-rec-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.reception,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "CLN Reception",
    // Fixture field password for the seeded actor/entity.
    password: CLN_PASSWORD,
  });
  // technician: seeded entity required before the mutation under test.
  const technician = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `CLN-TEC-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `cln-tec-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.technician,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "CLN Technician",
    // Fixture field password for the seeded actor/entity.
    password: CLN_PASSWORD,
  });

  // property: seeded entity required before the mutation under test.
  const property = await prisma.property.create({
    // Execute the next setup or assertion step for this scenario.
    data: { name: `CLN Property ${stamp}` },
  });
  // building: seeded entity required before the mutation under test.
  const building = await prisma.building.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      propertyId: property.id,
      // Fixture field name for the seeded actor/entity.
      name: "CLN Building",
      // Execute the next setup or assertion step for this scenario.
      code: `CLNB-${stamp}`.slice(0, 32),
    },
  });
  // floor: seeded entity required before the mutation under test.
  const floor = await prisma.floor.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      buildingId: building.id,
      // Execute the next setup or assertion step for this scenario.
      number: 77,
      // Fixture field name for the seeded actor/entity.
      name: "CLN Floor",
    },
  });
  // locationA: seeded entity required before the mutation under test.
  const locationA = await prisma.location.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      floorId: floor.id,
      // Execute the next setup or assertion step for this scenario.
      number: `CLA-${stamp}`.slice(0, 24),
      // Execute the next setup or assertion step for this scenario.
      kind: "room",
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: CleaningStatus.dirty,
    },
  });
  // locationB: seeded entity required before the mutation under test.
  const locationB = await prisma.location.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      floorId: floor.id,
      // Execute the next setup or assertion step for this scenario.
      number: `CLB-${stamp}`.slice(0, 24),
      // Execute the next setup or assertion step for this scenario.
      kind: "room",
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: CleaningStatus.dirty,
    },
  });

  // Bind employeeIds for later setup or assertions in this scope.
  const employeeIds = [
    // Execute the next setup or assertion step for this scenario.
    hk1.employeeId,
    // Execute the next setup or assertion step for this scenario.
    hk2.employeeId,
    // Execute the next setup or assertion step for this scenario.
    owner.employeeId,
    // Execute the next setup or assertion step for this scenario.
    manager.employeeId,
    // Execute the next setup or assertion step for this scenario.
    reception.employeeId,
    // Execute the next setup or assertion step for this scenario.
    technician.employeeId,
  ];

  // Full-day shift so housekeepers are on-shift regardless of wall-clock hour.
  const availabilityShift = await prisma.shift.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      code: `CLN-AV-${stamp}`.slice(0, 32),
      // Execute the next setup or assertion step for this scenario.
      nameBg: "CLN Availability",
      // Execute the next setup or assertion step for this scenario.
      nameEn: "CLN Availability",
      // Execute the next setup or assertion step for this scenario.
      startTime: "00:00",
      // Execute the next setup or assertion step for this scenario.
      endTime: "00:00",
      // Execute the next setup or assertion step for this scenario.
      sortOrder: 99,
      // Execute the next setup or assertion step for this scenario.
      isActive: true,
    },
  });

  // Await async work before asserting or releasing locks.
  await makeHousekeepersAvailable(prisma, {
    // Execute the next setup or assertion step for this scenario.
    employeeIds: [hk1.employeeId, hk2.employeeId],
    // Execute the next setup or assertion step for this scenario.
    shiftId: availabilityShift.id,
  });

  // Return the arranged value/result to the caller.
  return {
    // Execute the next setup or assertion step for this scenario.
    stamp,
    // Execute the next setup or assertion step for this scenario.
    propertyId: property.id,
    // Execute the next setup or assertion step for this scenario.
    buildingId: building.id,
    // Execute the next setup or assertion step for this scenario.
    floorId: floor.id,
    // Execute the next setup or assertion step for this scenario.
    locationAId: locationA.id,
    // Execute the next setup or assertion step for this scenario.
    locationBId: locationB.id,
    // Execute the next setup or assertion step for this scenario.
    availabilityShiftId: availabilityShift.id,
    // Execute the next setup or assertion step for this scenario.
    hk1,
    // Execute the next setup or assertion step for this scenario.
    hk2,
    // Execute the next setup or assertion step for this scenario.
    owner,
    // Execute the next setup or assertion step for this scenario.
    manager,
    // Execute the next setup or assertion step for this scenario.
    reception,
    // Execute the next setup or assertion step for this scenario.
    technician,
    // Execute the next setup or assertion step for this scenario.
    employeeIds,
  };
}

/**
 * Roster + open attendance so reassignment availability checks pass.
 * Uses a full-day shift window (00:00–00:00) when creating roster rows.
 */
export async function makeHousekeepersAvailable(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  input: { employeeIds: string[]; shiftId: string; hotelDateYmd?: string },
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // ymd: HTTP response captured for status/body checks.
  const ymd = input.hotelDateYmd ?? (await todayHotelDateYmd());
  // Bind hotelDate for later setup or assertions in this scope.
  const hotelDate = new Date(`${ymd}T00:00:00.000Z`);
  // Bind startedAt for later setup or assertions in this scope.
  const startedAt = new Date();

  // Iterate to cover variants or wait until a condition holds.
  for (const employeeId of input.employeeIds) {
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await prisma.employeeShiftRoster.upsert({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        employeeId_hotelDate: { employeeId, hotelDate },
      },
      // Execute the next setup or assertion step for this scenario.
      create: {
        // Execute the next setup or assertion step for this scenario.
        employeeId,
        // Execute the next setup or assertion step for this scenario.
        hotelDate,
        // Execute the next setup or assertion step for this scenario.
        shiftId: input.shiftId,
      },
      // SQL fragment used to observe locks or assert DB state.
      update: { shiftId: input.shiftId },
    });

    // Close any prior open intervals for this employee/day, then open a fresh one.
    await prisma.attendanceInterval.updateMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        employeeId,
        // Execute the next setup or assertion step for this scenario.
        hotelDate,
        // Fixture field status for the seeded actor/entity.
        status: AttendanceIntervalStatus.open,
        // Execute the next setup or assertion step for this scenario.
        endedAt: null,
      },
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Fixture field status for the seeded actor/entity.
        status: AttendanceIntervalStatus.closed,
        // Execute the next setup or assertion step for this scenario.
        endedAt: startedAt,
      },
    });

    // Await async work before asserting or releasing locks.
    await prisma.attendanceInterval.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        employeeId,
        // Execute the next setup or assertion step for this scenario.
        hotelDate,
        // Execute the next setup or assertion step for this scenario.
        startedAt,
        // Fixture field status for the seeded actor/entity.
        status: AttendanceIntervalStatus.open,
        // Execute the next setup or assertion step for this scenario.
        breakMinutes: 0,
        // Execute the next setup or assertion step for this scenario.
        anomalyFlags: [],
      },
    });
  }
}

/** Cancel active cleaning work on the world's locations (and our employees' sessions). */
export async function resetCleaningWork(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  world: CleaningWorld,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Bind locationIds for later setup or assertions in this scope.
  const locationIds = [world.locationAId, world.locationBId];

  // Await async work before asserting or releasing locks.
  await prisma.cleaningSession.updateMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // SQL fragment used to observe locks or assert DB state.
      OR: [
        // Execute the next setup or assertion step for this scenario.
        { task: { locationId: { in: locationIds } } },
        // Execute the next setup or assertion step for this scenario.
        { employeeId: { in: world.employeeIds } },
      ],
      // Fixture field status for the seeded actor/entity.
      status: SessionStatus.running,
    },
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Fixture field status for the seeded actor/entity.
      status: SessionStatus.cancelled,
      // Execute the next setup or assertion step for this scenario.
      finishedAt: new Date(),
      // Execute the next setup or assertion step for this scenario.
      notes: "cln test reset",
    },
  });

  // Await async work before asserting or releasing locks.
  await prisma.cleaningTask.updateMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Execute the next setup or assertion step for this scenario.
      locationId: { in: locationIds },
      // Fixture field status for the seeded actor/entity.
      status: {
        // Execute the next setup or assertion step for this scenario.
        in: [
          // Execute the next setup or assertion step for this scenario.
          TaskStatus.assigned,
          // Execute the next setup or assertion step for this scenario.
          TaskStatus.in_progress,
          // Execute the next setup or assertion step for this scenario.
          TaskStatus.awaiting_inspection,
          // Execute the next setup or assertion step for this scenario.
          TaskStatus.rework,
        ],
      },
    },
    // Execute the next setup or assertion step for this scenario.
    data: { status: TaskStatus.cancelled },
  });

  // Clear open tickets so option-based duplicate detection does not leak across cases.
  await prisma.ticketReopenEvent.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { ticket: { locationId: { in: locationIds } } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.ticketEvent.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { ticket: { locationId: { in: locationIds } } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.maintenanceTicket.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { locationId: { in: locationIds } },
  });
}

// Export helper cleanupCleaningWorld for reuse across related tests.
export async function cleanupCleaningWorld(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  world: CleaningWorld,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Bind locationIds for later setup or assertions in this scope.
  const locationIds = [world.locationAId, world.locationBId];

  // Await async work before asserting or releasing locks.
  await prisma.inspection.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { task: { locationId: { in: locationIds } } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.cleaningSession.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // SQL fragment used to observe locks or assert DB state.
      OR: [
        // Execute the next setup or assertion step for this scenario.
        { task: { locationId: { in: locationIds } } },
        // Execute the next setup or assertion step for this scenario.
        { employeeId: { in: world.employeeIds } },
      ],
    },
  });
  // Await async work before asserting or releasing locks.
  await prisma.cleaningTask.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { locationId: { in: locationIds } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.maintenanceTicket.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { locationId: { in: locationIds } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.attendanceInterval.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { employeeId: { in: world.employeeIds } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.attendanceEvent.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { employeeId: { in: world.employeeIds } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.employeeShiftRoster.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { employeeId: { in: world.employeeIds } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.location.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: { in: locationIds } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.floor.deleteMany({ where: { id: world.floorId } });
  // Await async work before asserting or releasing locks.
  await prisma.building.deleteMany({ where: { id: world.buildingId } });
  // Await async work before asserting or releasing locks.
  await prisma.property.deleteMany({ where: { id: world.propertyId } });
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (world.availabilityShiftId) {
    // Await async work before asserting or releasing locks.
    await prisma.shift.deleteMany({ where: { id: world.availabilityShiftId } });
  }
  // Await async work before asserting or releasing locks.
  await cleanupEmployeeGraph(prisma, world.employeeIds);
}

/**
 * Read-modify-write flags patch with restore in finally.
 * Required for require_inspection / allow_reception_reassign isolation.
 */
export async function withFlagsPatch<T>(
  // Execute the next setup or assertion step for this scenario.
  actorEmployeeId: string,
  // Delivery/replay step for async notification paths.
  partial: Partial<FlagsSettings>,
  // Execute the next setup or assertion step for this scenario.
  fn: () => Promise<T>,
// Execute the next setup or assertion step for this scenario.
): Promise<T> {
  // original: HTTP response captured for status/body checks.
  const original = await getFlags();
  // Delivery/replay step for async notification paths.
  const next: FlagsSettings = { ...original, ...partial };
  // Await async work before asserting or releasing locks.
  await updateSetting({
    // Execute the next setup or assertion step for this scenario.
    key: "flags",
    // Execute the next setup or assertion step for this scenario.
    value: next,
    // Execute the next setup or assertion step for this scenario.
    actorEmployeeId,
    // Execute the next setup or assertion step for this scenario.
    reason: "cln test flags patch",
  });
  // Try path where partial failure must not leak suite state.
  try {
    // Return the arranged value/result to the caller.
    return await fn();
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Await async work before asserting or releasing locks.
    await updateSetting({
      // Execute the next setup or assertion step for this scenario.
      key: "flags",
      // Execute the next setup or assertion step for this scenario.
      value: original,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId,
      // Execute the next setup or assertion step for this scenario.
      reason: "cln test flags restore",
    });
  }
}

/**
 * Read-modify-write operations patch with restore in finally.
 * Used for hotelTimezone midnight-boundary start tests.
 */
export async function withOperationsPatch<T>(
  // Execute the next setup or assertion step for this scenario.
  actorEmployeeId: string,
  // Delivery/replay step for async notification paths.
  partial: Partial<OperationsSettings>,
  // Execute the next setup or assertion step for this scenario.
  fn: () => Promise<T>,
// Execute the next setup or assertion step for this scenario.
): Promise<T> {
  // original: HTTP response captured for status/body checks.
  const original = await getOperations();
  // Delivery/replay step for async notification paths.
  const next: OperationsSettings = { ...original, ...partial };
  // Await async work before asserting or releasing locks.
  await updateSetting({
    // Execute the next setup or assertion step for this scenario.
    key: "operations",
    // Execute the next setup or assertion step for this scenario.
    value: next,
    // Execute the next setup or assertion step for this scenario.
    actorEmployeeId,
    // Execute the next setup or assertion step for this scenario.
    reason: "cln test operations patch",
  });
  // Try path where partial failure must not leak suite state.
  try {
    // Return the arranged value/result to the caller.
    return await fn();
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Await async work before asserting or releasing locks.
    await updateSetting({
      // Execute the next setup or assertion step for this scenario.
      key: "operations",
      // Execute the next setup or assertion step for this scenario.
      value: original,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId,
      // Execute the next setup or assertion step for this scenario.
      reason: "cln test operations restore",
    });
  }
}

/** Hotel calendar YMD for a fixed UTC instant in a given IANA zone. */
export function hotelYmdAt(instant: Date, timeZone: string): string {
  // Return the arranged value/result to the caller.
  return hotelDateString(instant, timeZone);
}

/** Re-export test clock freeze used by T-CLN-13b midnight-boundary starts. */
export { withHotelNowForTests };

// Shape Tx documents the fixture/response fields this suite touches.
type Tx = Prisma.TransactionClient;

/**
 * Poll until another backend is blocked on a Lock wait event.
 * Row-level FOR UPDATE waiters show up here (often as transactionid), not as
 * ungranted relation locks on the table name.
 */
export async function waitForLockWaiter(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  timeoutMs = 5_000,
  // Execute the next setup or assertion step for this scenario.
  minWaiters = 1,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // deadline: bound how long the wait/poll may run.
  const deadline = Date.now() + timeoutMs;
  // Repeat/poll to widen the race window or wait for lock waiters.
  while (Date.now() < deadline) {
    // rows: synchronize actors so the race window is observable.
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n
      FROM pg_stat_activity
      WHERE wait_event_type = 'Lock'
        AND pid <> pg_backend_pid()
        AND datname = current_database()
    `;
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (rows[0] && rows[0].n >= BigInt(minWaiters)) return;
    // Also catch ungranted lock entries (covers some drivers/pool timings).
    const lockRows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n
      FROM pg_locks
      WHERE NOT granted
    `;
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (lockRows[0] && lockRows[0].n >= BigInt(minWaiters)) return;
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise((r) => setTimeout(r, 20));
  }
  // Fail fast when the expected race/waiter condition never appears.
  assert.fail("timed out waiting for a backend blocked on Lock");
}

/**
 * Queue an eligibility mutation ahead of an operation's in-transaction user
 * recheck. A FOR SHARE holder keeps both waiters ordered without forcing the
 * operation to hold a user lock while the mutation is attempted.
 */
export async function runEligibilityChangeBeforeRace<T>(opts: {
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient;
  // Concurrency/isolation step for the race under test.
  acquireLock: (tx: Tx) => Promise<void>;
  // Execute the next setup or assertion step for this scenario.
  startMutation: () => Promise<unknown>;
  // Concurrency/isolation step for the race under test.
  startRace: () => Promise<T>;
// Execute the next setup or assertion step for this scenario.
}): Promise<T> {
  // Execute the next setup or assertion step for this scenario.
  let release!: () => void;
  // Bind gate for later setup or assertions in this scope.
  const gate = new Promise<void>((resolve) => { release = resolve; });
  // Bind lockHeld for later setup or assertions in this scope.
  let lockHeld = false;
  // Bind holder for later setup or assertions in this scope.
  const holder = opts.prisma.$transaction(async (tx) => {
    // Await async work before asserting or releasing locks.
    await opts.acquireLock(tx);
    // Concurrency/isolation step for the race under test.
    lockHeld = true;
    // Await async work before asserting or releasing locks.
    await gate;
  // Runner option controlling stability or isolation of the suite.
  }, { timeout: 20_000, maxWait: 20_000 });

  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let i = 0; i < 50 && !lockHeld; i += 1) {
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise((r) => setTimeout(r, 20));
  }
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (!lockHeld) {
    // Execute the next setup or assertion step for this scenario.
    release();
    // Await async work before asserting or releasing locks.
    await holder.catch(() => undefined);
    // Assert we are on the isolated test DB, not a seed/prod database.
    assert.fail("expected eligibility holder to acquire row lock");
  }

  // Execute the next setup or assertion step for this scenario.
  let mutation: Promise<unknown> | undefined;
  // Concurrency/isolation step for the race under test.
  let race: Promise<T> | undefined;
  // Try path where partial failure must not leak suite state.
  try {
    // Execute the next setup or assertion step for this scenario.
    mutation = opts.startMutation();
    // Fire-and-await side effect required before the next assertion.
    void mutation.catch(() => undefined);
    // Await async work before asserting or releasing locks.
    await waitForLockWaiter(opts.prisma);
    // Concurrency/isolation step for the race under test.
    race = opts.startRace();
    // Fire-and-await side effect required before the next assertion.
    void race.catch(() => undefined);
    // Await async work before asserting or releasing locks.
    await waitForLockWaiter(opts.prisma, 5_000, 2);
    // Execute the next setup or assertion step for this scenario.
    release();
    // Await async work before asserting or releasing locks.
    await holder;
    // Await async work before asserting or releasing locks.
    await mutation;
    // Return the arranged value/result to the caller.
    return await race;
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Execute the next setup or assertion step for this scenario.
    release();
    // Await async work before asserting or releasing locks.
    await holder.catch(() => undefined);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (mutation) await mutation.catch(() => undefined);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (race) await race.catch(() => undefined);
  }
}

/**
 * Hold a row lock, start a racing promise (past its outer checks), wait until
 * that txn is blocked on FOR UPDATE, run `whileBlocked`, then release.
 * Replaces timing heuristics like setTimeout(80).
 */
export async function runWhileRowLocked<T>(opts: {
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient;
  // Concurrency/isolation step for the race under test.
  acquireLock: (tx: Tx) => Promise<void>;
  // Concurrency/isolation step for the race under test.
  startRace: () => Promise<T>;
  // Concurrency/isolation step for the race under test.
  whileBlocked: () => Promise<void>;
// Execute the next setup or assertion step for this scenario.
}): Promise<T> {
  // Execute the next setup or assertion step for this scenario.
  let release!: () => void;
  // Bind gate for later setup or assertions in this scope.
  const gate = new Promise<void>((resolve) => {
    // Execute the next setup or assertion step for this scenario.
    release = resolve;
  });
  // Bind lockHeld for later setup or assertions in this scope.
  let lockHeld = false;
  // Bind holder for later setup or assertions in this scope.
  const holder = opts.prisma.$transaction(
    // Execute the next setup or assertion step for this scenario.
    async (tx) => {
      // Await async work before asserting or releasing locks.
      await opts.acquireLock(tx);
      // Concurrency/isolation step for the race under test.
      lockHeld = true;
      // Await async work before asserting or releasing locks.
      await gate;
    },
    // Runner option controlling stability or isolation of the suite.
    { timeout: 20_000, maxWait: 20_000 },
  );

  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let i = 0; i < 50 && !lockHeld; i += 1) {
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise((r) => setTimeout(r, 20));
  }
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (!lockHeld) {
    // Execute the next setup or assertion step for this scenario.
    release();
    // Await async work before asserting or releasing locks.
    await holder.catch(() => undefined);
    // Assert we are on the isolated test DB, not a seed/prod database.
    assert.fail("expected advisory holder to acquire row lock");
  }

  // Bind raceP for later setup or assertions in this scope.
  const raceP = opts.startRace();
  // Try path where partial failure must not leak suite state.
  try {
    // Await async work before asserting or releasing locks.
    await waitForLockWaiter(opts.prisma);
    // Await async work before asserting or releasing locks.
    await opts.whileBlocked();
  // Execute the next setup or assertion step for this scenario.
  } catch (err) {
    // Execute the next setup or assertion step for this scenario.
    release();
    // Await async work before asserting or releasing locks.
    await holder.catch(() => undefined);
    // Concurrency/isolation step for the race under test.
    raceP.catch(() => undefined);
    // Surface a hard failure when isolation or contract is violated.
    throw err;
  }
  // Execute the next setup or assertion step for this scenario.
  release();
  // Await async work before asserting or releasing locks.
  await holder;
  // Return the arranged value/result to the caller.
  return raceP;
}

// Export helper createOpenMaintenanceTicket for reuse across related tests.
export async function createOpenMaintenanceTicket(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  world: CleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  locationId: string,
// Execute the next setup or assertion step for this scenario.
) {
  // Return the arranged value/result to the caller.
  return prisma.maintenanceTicket.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId,
      // Execute the next setup or assertion step for this scenario.
      title: `CLN ticket ${world.stamp}`,
      // Execute the next setup or assertion step for this scenario.
      categoryKey: "other",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelBg: "Друго",
      // Execute the next setup or assertion step for this scenario.
      categoryLabelEn: "Other",
      // Execute the next setup or assertion step for this scenario.
      reportedByEmployeeId: world.manager.employeeId,
      // Fixture field status for the seeded actor/entity.
      status: TicketStatus.new,
    },
  });
}

// Export helper countActiveTasks for reuse across related tests.
export async function countActiveTasks(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  locationId: string,
  // Execute the next setup or assertion step for this scenario.
  hotelDateYmd: string,
// Execute the next setup or assertion step for this scenario.
): Promise<number> {
  // Return the arranged value/result to the caller.
  return prisma.cleaningTask.count({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Execute the next setup or assertion step for this scenario.
      locationId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: new Date(`${hotelDateYmd}T00:00:00.000Z`),
      // Fixture field status for the seeded actor/entity.
      status: {
        // Execute the next setup or assertion step for this scenario.
        in: [
          // Execute the next setup or assertion step for this scenario.
          TaskStatus.assigned,
          // Execute the next setup or assertion step for this scenario.
          TaskStatus.in_progress,
          // Execute the next setup or assertion step for this scenario.
          TaskStatus.awaiting_inspection,
          // Execute the next setup or assertion step for this scenario.
          TaskStatus.rework,
        ],
      },
    },
  });
}

/**
 * Fresh dual-day setup: HK1 running on yesterday's task; HK2 running on today's task.
 * Call once per test — do not reuse after cancel/complete mutations.
 */
export async function createDualDayRunningSetup(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  world: CleaningWorld,
// Execute the next setup or assertion step for this scenario.
): Promise<DualDayRunningSetup> {
  // Await async work before asserting or releasing locks.
  await resetCleaningWork(prisma, world);

  // today: synchronize actors so the race window is observable.
  const today = await hotelTodayYmd();
  // Bind day1Ymd for later setup or assertions in this scope.
  const day1Ymd = ymdOffset(today, -1);
  // Bind day2Ymd for later setup or assertions in this scope.
  const day2Ymd = today;

  // day1Task: seeded entity required before the mutation under test.
  const day1Task = await createCleaningTask({
    // Execute the next setup or assertion step for this scenario.
    locationId: world.locationAId,
    // Execute the next setup or assertion step for this scenario.
    hotelDate: day1Ymd,
    // Execute the next setup or assertion step for this scenario.
    assignedEmployeeId: world.hk1.employeeId,
    // Execute the next setup or assertion step for this scenario.
    actorEmployeeId: world.owner.employeeId,
  });
  // day1Started: synchronize actors so the race window is observable.
  const day1Started = await startCleaningTask({
    // Execute the next setup or assertion step for this scenario.
    taskId: day1Task.id,
    // Execute the next setup or assertion step for this scenario.
    employeeId: world.hk1.employeeId,
    // Execute the next setup or assertion step for this scenario.
    commandId: randomUUID(),
    // Execute the next setup or assertion step for this scenario.
    expectedVersion: day1Task.version,
  });

  // day2Task: seeded entity required before the mutation under test.
  const day2Task = await createCleaningTask({
    // Execute the next setup or assertion step for this scenario.
    locationId: world.locationAId,
    // Execute the next setup or assertion step for this scenario.
    hotelDate: day2Ymd,
    // Execute the next setup or assertion step for this scenario.
    assignedEmployeeId: world.hk2.employeeId,
    // Execute the next setup or assertion step for this scenario.
    actorEmployeeId: world.owner.employeeId,
  });
  // day2Started: synchronize actors so the race window is observable.
  const day2Started = await startCleaningTask({
    // Execute the next setup or assertion step for this scenario.
    taskId: day2Task.id,
    // Execute the next setup or assertion step for this scenario.
    employeeId: world.hk2.employeeId,
    // Execute the next setup or assertion step for this scenario.
    commandId: randomUUID(),
    // Execute the next setup or assertion step for this scenario.
    expectedVersion: day2Task.version,
  });

  // Return the arranged value/result to the caller.
  return {
    // Execute the next setup or assertion step for this scenario.
    day1Ymd,
    // Execute the next setup or assertion step for this scenario.
    day2Ymd,
    // Execute the next setup or assertion step for this scenario.
    day1TaskId: day1Task.id,
    // Execute the next setup or assertion step for this scenario.
    day2TaskId: day2Task.id,
    // Session/CSRF step exercising auth lifecycle.
    day1SessionId: day1Started.session.id,
    // Session/CSRF step exercising auth lifecycle.
    day2SessionId: day2Started.session.id,
    // Execute the next setup or assertion step for this scenario.
    day1Version: day1Started.task.version,
    // Execute the next setup or assertion step for this scenario.
    day2Version: day2Started.task.version,
  };
}

/** Start an assigned task for today on a location; returns task+session after start. */
export async function createAndStartToday(
  // Execute the next setup or assertion step for this scenario.
  world: CleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  locationId: string,
  // Execute the next setup or assertion step for this scenario.
  employeeId: string,
// Execute the next setup or assertion step for this scenario.
) {
  // today: synchronize actors so the race window is observable.
  const today = await hotelTodayYmd();
  // task: seeded entity required before the mutation under test.
  const task = await createCleaningTask({
    // Execute the next setup or assertion step for this scenario.
    locationId,
    // Execute the next setup or assertion step for this scenario.
    hotelDate: today,
    // Execute the next setup or assertion step for this scenario.
    assignedEmployeeId: employeeId,
    // Execute the next setup or assertion step for this scenario.
    actorEmployeeId: world.owner.employeeId,
  });
  // started: synchronize actors so the race window is observable.
  const started = await startCleaningTask({
    // Execute the next setup or assertion step for this scenario.
    taskId: task.id,
    // Execute the next setup or assertion step for this scenario.
    employeeId,
    // Execute the next setup or assertion step for this scenario.
    commandId: randomUUID(),
    // Execute the next setup or assertion step for this scenario.
    expectedVersion: task.version,
  });
  // Return the arranged value/result to the caller.
  return { today, task, started };
}

/** Cancel a running session with bypass (owner/reviewer path). */
export async function cancelAsOwner(
  // Session/CSRF step exercising auth lifecycle.
  sessionId: string,
  // Execute the next setup or assertion step for this scenario.
  ownerEmployeeId: string,
  // Execute the next setup or assertion step for this scenario.
  expectedVersion?: number,
// Execute the next setup or assertion step for this scenario.
) {
  // Return the arranged value/result to the caller.
  return cancelCleaningSession({
    // Session/CSRF step exercising auth lifecycle.
    sessionId,
    // Execute the next setup or assertion step for this scenario.
    employeeId: ownerEmployeeId,
    // Execute the next setup or assertion step for this scenario.
    commandId: randomUUID(),
    // Execute the next setup or assertion step for this scenario.
    expectedVersion,
    // Session/CSRF step exercising auth lifecycle.
    bypassSessionOwnerCheck: true,
  });
}
