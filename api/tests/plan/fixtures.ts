/**
 * Shared helpers for daily-plan integration tests (P1-48…P1-57).
 * Outside the parallel src test glob; run via `npm run test:plan`.
 */
import assert from "node:assert/strict";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  CatalogStatus,
  // Execute the next setup or assertion step for this scenario.
  CleaningStatus,
  // Execute the next setup or assertion step for this scenario.
  DailyPlanCategory,
  // Execute the next setup or assertion step for this scenario.
  DailyPlanSource,
  // Execute the next setup or assertion step for this scenario.
  Occupancy,
  // Execute the next setup or assertion step for this scenario.
  Prisma,
  // Execute the next setup or assertion step for this scenario.
  PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  Priority,
  // Execute the next setup or assertion step for this scenario.
  Role,
  // Execute the next setup or assertion step for this scenario.
  TaskStatus,
// Execute the next setup or assertion step for this scenario.
} from "@prisma/client";
// Import bindings from ../../src/services/cleaning/locks.
import { lockLocation } from "../../src/services/cleaning/locks";
// Import bindings from ../../src/services/hotelTime.
import { todayHotelDateYmd } from "../../src/services/hotelTime";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  CLN_PASSWORD,
  // Execute the next setup or assertion step for this scenario.
  cleanupCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  createCleaningWorld,
  // Execute the next setup or assertion step for this scenario.
  hotelTodayYmd,
  // Pagination step for list/contract coverage.
  ymdOffset,
  // Shape CleaningWorld documents the fixture/response fields this suite touches.
  type CleaningWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../cleaning/fixtures";
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
// Import module bindings used by this suite.
import {
  // Start or stop the in-process API server for this suite.
  closeServer,
  // Execute the next setup or assertion step for this scenario.
  getJson,
  // Execute the next setup or assertion step for this scenario.
  listenApp,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
  // Execute the next setup or assertion step for this scenario.
  postJson,
// Execute the next setup or assertion step for this scenario.
} from "../httpHarness";

// Re-export selected symbols for suite consumers.
export {
  // Execute the next setup or assertion step for this scenario.
  CLN_PASSWORD,
  // Start or stop the in-process API server for this suite.
  closeServer,
  // Execute the next setup or assertion step for this scenario.
  getJson,
  // Execute the next setup or assertion step for this scenario.
  hotelTodayYmd,
  // Execute the next setup or assertion step for this scenario.
  listenApp,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
  // Execute the next setup or assertion step for this scenario.
  postJson,
  // Pagination step for list/contract coverage.
  ymdOffset,
};
// Execute the next setup or assertion step for this scenario.
export type { CleaningWorld, EmployeeUserFixture };

// Shape Tx documents the fixture/response fields this suite touches.
type Tx = Prisma.TransactionClient;

// Export PLAN_PASSWORD for shared test/setup consumers.
export const PLAN_PASSWORD = CLN_PASSWORD;
// Export PLAN_CONFLICT_MESSAGE for shared test/setup consumers.
export const PLAN_CONFLICT_MESSAGE =
  // Execute the next setup or assertion step for this scenario.
  "Plan entry already exists for this room/date/category";

// Export PlanWorld for shared test/setup consumers.
export type PlanWorld = CleaningWorld & {
  // Execute the next setup or assertion step for this scenario.
  buildingCode: string;
  // Execute the next setup or assertion step for this scenario.
  roomANumber: string;
  // Execute the next setup or assertion step for this scenario.
  roomBNumber: string;
  // Execute the next setup or assertion step for this scenario.
  archivedLocationId: string;
  // Execute the next setup or assertion step for this scenario.
  archivedNumber: string;
  // Execute the next setup or assertion step for this scenario.
  locationCId: string;
  // Execute the next setup or assertion step for this scenario.
  roomCNumber: string;
  // Execute the next setup or assertion step for this scenario.
  shiftId: string;
  // Execute the next setup or assertion step for this scenario.
  shift2Id: string;
};

// Export LocationSnap for shared test/setup consumers.
export type LocationSnap = {
  // Execute the next setup or assertion step for this scenario.
  occupancy: Occupancy;
  // Execute the next setup or assertion step for this scenario.
  cleaningStatus: CleaningStatus;
  // Execute the next setup or assertion step for this scenario.
  cleaningCycle: number;
};

// Export EntrySnap for shared test/setup consumers.
export type EntrySnap = {
  // Execute the next setup or assertion step for this scenario.
  id: string;
  // Execute the next setup or assertion step for this scenario.
  source: DailyPlanSource;
  // Execute the next setup or assertion step for this scenario.
  notes: string | null;
  // Execute the next setup or assertion step for this scenario.
  category: DailyPlanCategory;
  // Execute the next setup or assertion step for this scenario.
  hotelDate: string;
  // Execute the next setup or assertion step for this scenario.
  locationId: string;
  // Execute the next setup or assertion step for this scenario.
  cleaningTaskId: string | null;
  // Execute the next setup or assertion step for this scenario.
  roomEffectsAppliedAt: Date | null;
  // Execute the next setup or assertion step for this scenario.
  assignedEmployeeId: string | null;
  // Execute the next setup or assertion step for this scenario.
  shiftId: string | null;
};

/** Create isolated plan world: 3 rooms + archived, 2 shifts, cleaning roles. */
export async function createPlanWorld(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
// Execute the next setup or assertion step for this scenario.
): Promise<PlanWorld> {
  // base: seeded entity required before the mutation under test.
  const base = await createCleaningWorld(prisma);
  // stamp: unique stamp so parallel runs do not collide.
  const stamp = base.stamp;

  // building: synchronize actors so the race window is observable.
  const building = await prisma.building.findUniqueOrThrow({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: base.buildingId },
  });
  // locA: synchronize actors so the race window is observable.
  const locA = await prisma.location.findUniqueOrThrow({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: base.locationAId },
  });
  // locB: synchronize actors so the race window is observable.
  const locB = await prisma.location.findUniqueOrThrow({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: base.locationBId },
  });

  // archived: seeded entity required before the mutation under test.
  const archived = await prisma.location.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      floorId: base.floorId,
      // Execute the next setup or assertion step for this scenario.
      number: `ARC-${stamp}`.slice(0, 24),
      // Execute the next setup or assertion step for this scenario.
      kind: "room",
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: CleaningStatus.dirty,
      // Execute the next setup or assertion step for this scenario.
      occupancy: Occupancy.vacant,
      // Execute the next setup or assertion step for this scenario.
      catalogStatus: CatalogStatus.archived,
    },
  });

  // locC: seeded entity required before the mutation under test.
  const locC = await prisma.location.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      floorId: base.floorId,
      // Execute the next setup or assertion step for this scenario.
      number: `CLC-${stamp}`.slice(0, 24),
      // Execute the next setup or assertion step for this scenario.
      kind: "room",
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: CleaningStatus.dirty,
      // Execute the next setup or assertion step for this scenario.
      occupancy: Occupancy.vacant,
    },
  });

  // shift1: seeded entity required before the mutation under test.
  const shift1 = await prisma.shift.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      code: `P1S1-${stamp}`.slice(0, 32),
      // Execute the next setup or assertion step for this scenario.
      nameBg: "Plan Shift 1",
      // Execute the next setup or assertion step for this scenario.
      nameEn: "Plan Shift 1",
      // Execute the next setup or assertion step for this scenario.
      startTime: "08:00",
      // Execute the next setup or assertion step for this scenario.
      endTime: "16:00",
      // Execute the next setup or assertion step for this scenario.
      isActive: true,
    },
  });
  // shift2: seeded entity required before the mutation under test.
  const shift2 = await prisma.shift.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      code: `P1S2-${stamp}`.slice(0, 32),
      // Execute the next setup or assertion step for this scenario.
      nameBg: "Plan Shift 2",
      // Execute the next setup or assertion step for this scenario.
      nameEn: "Plan Shift 2",
      // Execute the next setup or assertion step for this scenario.
      startTime: "14:00",
      // Execute the next setup or assertion step for this scenario.
      endTime: "22:00",
      // Execute the next setup or assertion step for this scenario.
      isActive: true,
    },
  });

  // Return the arranged value/result to the caller.
  return {
    // Continue the call chain for setup or assertion detail.
    ...base,
    // Execute the next setup or assertion step for this scenario.
    buildingCode: building.code,
    // Execute the next setup or assertion step for this scenario.
    roomANumber: locA.number,
    // Execute the next setup or assertion step for this scenario.
    roomBNumber: locB.number,
    // Execute the next setup or assertion step for this scenario.
    archivedLocationId: archived.id,
    // Execute the next setup or assertion step for this scenario.
    archivedNumber: archived.number,
    // Execute the next setup or assertion step for this scenario.
    locationCId: locC.id,
    // Execute the next setup or assertion step for this scenario.
    roomCNumber: locC.number,
    // Execute the next setup or assertion step for this scenario.
    shiftId: shift1.id,
    // Execute the next setup or assertion step for this scenario.
    shift2Id: shift2.id,
  };
}

// Export helper cleanupPlanWorld for reuse across related tests.
export async function cleanupPlanWorld(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  world: PlanWorld,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Bind locationIds for later setup or assertions in this scope.
  const locationIds = [
    // Execute the next setup or assertion step for this scenario.
    world.locationAId,
    // Execute the next setup or assertion step for this scenario.
    world.locationBId,
    // Execute the next setup or assertion step for this scenario.
    world.locationCId,
    // Execute the next setup or assertion step for this scenario.
    world.archivedLocationId,
  ];
  // Await async work before asserting or releasing locks.
  await cleanupPlanArtifacts(prisma, locationIds, world.employeeIds);
  // Await async work before asserting or releasing locks.
  await prisma.shift.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: { in: [world.shiftId, world.shift2Id] } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.location.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: { in: [world.locationCId, world.archivedLocationId] } },
  });
  // cleanupCleaningWorld deletes A/B + building/property/employees
  await cleanupCleaningWorld(prisma, world);
}

/** Delete plan entries, import batches, and all cleaning tasks for locations. */
export async function cleanupPlanArtifacts(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  locationIds: string[],
  // Execute the next setup or assertion step for this scenario.
  createdByEmployeeIds: string[] = [],
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (!locationIds.length && !createdByEmployeeIds.length) return;
  // Bind entries for later setup or assertions in this scope.
  const entries = locationIds.length
    // Await async work before asserting or releasing locks.
    ? await prisma.dailyPlanEntry.findMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { locationId: { in: locationIds } },
        // SQL fragment used to observe locks or assert DB state.
        select: { id: true, importBatchId: true },
      })
    : [];
  // Bind batchIds for later setup or assertions in this scope.
  const batchIds = [
    // Continue the call chain for setup or assertion detail.
    ...new Set(
      // Execute the next setup or assertion step for this scenario.
      entries
        // Continue the call chain for setup or assertion detail.
        .map((e) => e.importBatchId)
        // Continue the call chain for setup or assertion detail.
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (locationIds.length) {
    // Await async work before asserting or releasing locks.
    await prisma.dailyPlanEntry.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { locationId: { in: locationIds } },
    });
  }
  // Batches with only skips still reference createdByEmployeeId — delete those too.
  const batchOr: Prisma.DailyPlanImportBatchWhereInput[] = [];
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (batchIds.length) batchOr.push({ id: { in: batchIds } });
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (createdByEmployeeIds.length) {
    // Execute the next setup or assertion step for this scenario.
    batchOr.push({ createdByEmployeeId: { in: createdByEmployeeIds } });
  }
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (batchOr.length) {
    // Await async work before asserting or releasing locks.
    await prisma.dailyPlanImportBatch.deleteMany({ where: { OR: batchOr } });
  }
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (locationIds.length) {
    // Await async work before asserting or releasing locks.
    await prisma.inspection.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { task: { locationId: { in: locationIds } } },
    });
    // Await async work before asserting or releasing locks.
    await prisma.cleaningSession.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { task: { locationId: { in: locationIds } } },
    });
    // Await async work before asserting or releasing locks.
    await prisma.cleaningTask.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { locationId: { in: locationIds } },
    });
  }
}

// Export helper snapshotLocation for reuse across related tests.
export async function snapshotLocation(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  locationId: string,
// Execute the next setup or assertion step for this scenario.
): Promise<LocationSnap> {
  // loc: synchronize actors so the race window is observable.
  const loc = await prisma.location.findUniqueOrThrow({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: locationId },
    // SQL fragment used to observe locks or assert DB state.
    select: {
      // Execute the next setup or assertion step for this scenario.
      occupancy: true,
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: true,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: true,
    },
  });
  // Return the arranged value/result to the caller.
  return loc;
}

// Export helper snapshotEntry for reuse across related tests.
export async function snapshotEntry(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  entryId: string,
// Execute the next setup or assertion step for this scenario.
): Promise<EntrySnap> {
  // e: synchronize actors so the race window is observable.
  const e = await prisma.dailyPlanEntry.findUniqueOrThrow({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: entryId },
  });
  // Return the arranged value/result to the caller.
  return {
    // Execute the next setup or assertion step for this scenario.
    id: e.id,
    // Execute the next setup or assertion step for this scenario.
    source: e.source,
    // Execute the next setup or assertion step for this scenario.
    notes: e.notes,
    // Execute the next setup or assertion step for this scenario.
    category: e.category,
    // Execute the next setup or assertion step for this scenario.
    hotelDate: e.hotelDate.toISOString().slice(0, 10),
    // Execute the next setup or assertion step for this scenario.
    locationId: e.locationId,
    // Execute the next setup or assertion step for this scenario.
    cleaningTaskId: e.cleaningTaskId,
    // Execute the next setup or assertion step for this scenario.
    roomEffectsAppliedAt: e.roomEffectsAppliedAt,
    // Execute the next setup or assertion step for this scenario.
    assignedEmployeeId: e.assignedEmployeeId,
    // Execute the next setup or assertion step for this scenario.
    shiftId: e.shiftId,
  };
}

// Export helper assertLocationSnapEqual for reuse across related tests.
export function assertLocationSnapEqual(
  // Execute the next setup or assertion step for this scenario.
  actual: LocationSnap,
  // Execute the next setup or assertion step for this scenario.
  expected: LocationSnap,
  // Execute the next setup or assertion step for this scenario.
  label: string,
// Execute the next setup or assertion step for this scenario.
): void {
  // Assert we are on the isolated test DB, not a seed/prod database.
  assert.equal(actual.occupancy, expected.occupancy, `${label} occupancy`);
  // Assert the observed value matches the intended post-condition.
  assert.equal(
    // Execute the next setup or assertion step for this scenario.
    actual.cleaningStatus,
    // Execute the next setup or assertion step for this scenario.
    expected.cleaningStatus,
    // Execute the next setup or assertion step for this scenario.
    `${label} cleaningStatus`,
  );
  // Assert the observed value matches the intended post-condition.
  assert.equal(
    // Execute the next setup or assertion step for this scenario.
    actual.cleaningCycle,
    // Execute the next setup or assertion step for this scenario.
    expected.cleaningCycle,
    // Execute the next setup or assertion step for this scenario.
    `${label} cleaningCycle`,
  );
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

// Export helper cancelActiveTasks for reuse across related tests.
export async function cancelActiveTasks(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  locationId: string,
  // Execute the next setup or assertion step for this scenario.
  hotelDateYmd?: string,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Await async work before asserting or releasing locks.
  await prisma.cleaningTask.updateMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Execute the next setup or assertion step for this scenario.
      locationId,
      // Continue the call chain for setup or assertion detail.
      ...(hotelDateYmd
        ? { hotelDate: new Date(`${hotelDateYmd}T00:00:00.000Z`) }
        : {}),
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
}

// Export helper prepareRoom for reuse across related tests.
export async function prepareRoom(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  locationId: string,
  // Execute the next setup or assertion step for this scenario.
  opts: {
    // Execute the next setup or assertion step for this scenario.
    occupancy: Occupancy;
    // Execute the next setup or assertion step for this scenario.
    cleaningStatus: CleaningStatus;
    // Execute the next setup or assertion step for this scenario.
    cleaningCycle?: number;
  },
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Await async work before asserting or releasing locks.
  await prisma.location.update({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: locationId },
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      occupancy: opts.occupancy,
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: opts.cleaningStatus,
      // Continue the call chain for setup or assertion detail.
      ...(opts.cleaningCycle !== undefined
        ? { cleaningCycle: opts.cleaningCycle }
        : {}),
      // Execute the next setup or assertion step for this scenario.
      catalogStatus: CatalogStatus.active,
      // Execute the next setup or assertion step for this scenario.
      serviceStatus: "in_service",
    },
  });
}

/**
 * Pending departure fixture: occupied room, unstamped entry, no newer-stay
 * evidence. Does not run createDailyPlanEntry (which would apply effects).
 * For hotel-today occupied rooms, ensureDepartureRoomEffects would apply
 * immediately — use that as a GET regression probe + positive control.
 */
export async function seedDeferredDeparture(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  input: {
    // Execute the next setup or assertion step for this scenario.
    hotelDateYmd: string;
    // Execute the next setup or assertion step for this scenario.
    locationId: string;
    // Execute the next setup or assertion step for this scenario.
    createdByEmployeeId: string;
    // Execute the next setup or assertion step for this scenario.
    assignedEmployeeId?: string | null;
    // Execute the next setup or assertion step for this scenario.
    shiftId?: string | null;
    // Execute the next setup or assertion step for this scenario.
    notes?: string;
    // Execute the next setup or assertion step for this scenario.
    cleaningStatus?: CleaningStatus;
    // Execute the next setup or assertion step for this scenario.
    cleaningCycle?: number;
    // Execute the next setup or assertion step for this scenario.
    cleaningTaskId?: string | null;
    /** When false, caller already prepared occupancy/cleaning (default true). */
    prepareOccupiedRoom?: boolean;
  },
// Execute the next setup or assertion step for this scenario.
) {
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (input.prepareOccupiedRoom !== false) {
    // Await async work before asserting or releasing locks.
    await prepareRoom(prisma, input.locationId, {
      // Execute the next setup or assertion step for this scenario.
      occupancy: Occupancy.occupied,
      // Execute the next setup or assertion step for this scenario.
      cleaningStatus: input.cleaningStatus ?? CleaningStatus.dirty,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: input.cleaningCycle,
    });
  }
  // Clear occupancy→occupied audits after plan day that would trigger protect.
  const after = new Date(
    // Pagination step for list/contract coverage.
    `${ymdOffset(input.hotelDateYmd, 1)}T00:00:00.000Z`,
  );
  // Await async work before asserting or releasing locks.
  await prisma.auditEvent.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Execute the next setup or assertion step for this scenario.
      locationId: input.locationId,
      // Execute the next setup or assertion step for this scenario.
      action: "location.set_occupancy",
      // Execute the next setup or assertion step for this scenario.
      occurredAt: { gte: after },
    },
  });

  // Return the arranged value/result to the caller.
  return prisma.dailyPlanEntry.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      hotelDate: new Date(`${input.hotelDateYmd}T00:00:00.000Z`),
      // Execute the next setup or assertion step for this scenario.
      locationId: input.locationId,
      // Execute the next setup or assertion step for this scenario.
      category: DailyPlanCategory.departure,
      // Execute the next setup or assertion step for this scenario.
      source: DailyPlanSource.manual,
      // Execute the next setup or assertion step for this scenario.
      notes: input.notes ?? "deferred test",
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: input.assignedEmployeeId ?? null,
      // Execute the next setup or assertion step for this scenario.
      shiftId: input.shiftId ?? null,
      // Execute the next setup or assertion step for this scenario.
      roomEffectsAppliedAt: null,
      // Execute the next setup or assertion step for this scenario.
      cleaningTaskId: input.cleaningTaskId ?? null,
      // Execute the next setup or assertion step for this scenario.
      createdByEmployeeId: input.createdByEmployeeId,
    },
  });
}

// Export helper createActiveTask for reuse across related tests.
export async function createActiveTask(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  input: {
    // Execute the next setup or assertion step for this scenario.
    locationId: string;
    // Execute the next setup or assertion step for this scenario.
    hotelDateYmd: string;
    // Execute the next setup or assertion step for this scenario.
    priority?: Priority;
    // Execute the next setup or assertion step for this scenario.
    assignedEmployeeId?: string | null;
    // Execute the next setup or assertion step for this scenario.
    shiftId?: string | null;
    // Execute the next setup or assertion step for this scenario.
    cleaningCycle?: number;
  },
// Execute the next setup or assertion step for this scenario.
) {
  // loc: synchronize actors so the race window is observable.
  const loc = await prisma.location.findUniqueOrThrow({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: input.locationId },
    // SQL fragment used to observe locks or assert DB state.
    select: { cleaningCycle: true },
  });
  // Return the arranged value/result to the caller.
  return prisma.cleaningTask.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      locationId: input.locationId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: new Date(`${input.hotelDateYmd}T00:00:00.000Z`),
      // Execute the next setup or assertion step for this scenario.
      priority: input.priority ?? Priority.normal,
      // Fixture field status for the seeded actor/entity.
      status: TaskStatus.assigned,
      // Execute the next setup or assertion step for this scenario.
      assignedEmployeeId: input.assignedEmployeeId ?? null,
      // Execute the next setup or assertion step for this scenario.
      shiftId: input.shiftId ?? null,
      // Execute the next setup or assertion step for this scenario.
      cleaningCycle: input.cleaningCycle ?? loc.cleaningCycle,
    },
  });
}

/**
 * Poll until `minWaiters` backends are in the holder's blocking chain
 * (direct waiters on holder OR queued behind them — not arbitrary Lock
 * waiters elsewhere in the database).
 */
export async function waitForBlockedOnHolder(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  holderPid: number,
  // Execute the next setup or assertion step for this scenario.
  minWaiters = 2,
  // Execute the next setup or assertion step for this scenario.
  timeoutMs = 15_000,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // deadline: bound how long the wait/poll may run.
  const deadline = Date.now() + timeoutMs;
  // Repeat/poll to widen the race window or wait for lock waiters.
  while (Date.now() < deadline) {
    // Recursive: 858←holder, 860←858 both count as the holder's lock queue.
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      WITH RECURSIVE chain AS (
        SELECT a.pid
        FROM pg_stat_activity a
        WHERE a.datname = current_database()
          AND ${holderPid} = ANY (pg_blocking_pids(a.pid))
        UNION
        SELECT a.pid
        FROM pg_stat_activity a
        INNER JOIN chain c ON c.pid = ANY (pg_blocking_pids(a.pid))
        WHERE a.datname = current_database()
      )
      SELECT count(DISTINCT pid)::bigint AS n FROM chain
    `;
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (rows[0] && rows[0].n >= BigInt(minWaiters)) return;
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise((r) => setTimeout(r, 20));
  }
  // Fail fast when the expected race/waiter condition never appears.
  assert.fail(
    // Concurrency/isolation step for the race under test.
    `timed out waiting for ${minWaiters} backends in holder ${holderPid} blocking chain`,
  );
}

/**
 * Hold a Location FOR UPDATE on a dedicated Prisma client (avoids pool
 * starvation), start two racing ops, wait until both are blocked on this
 * holder, then release.
 */
export async function runWhileRowLockedBoth<A, B>(opts: {
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient;
  // Execute the next setup or assertion step for this scenario.
  locationId: string;
  // Execute the next setup or assertion step for this scenario.
  startA: () => Promise<A>;
  // Execute the next setup or assertion step for this scenario.
  startB: () => Promise<B>;
  // Concurrency/isolation step for the race under test.
  whileBothBlocked?: () => Promise<void>;
// Execute the next setup or assertion step for this scenario.
}): Promise<{ resultA: PromiseSettledResult<A>; resultB: PromiseSettledResult<B> }> {
  // Dedicated client so the holder connection is not taken from the shared pool
  // that create/import need to reach lockLocation.
  const holderPrisma = new PrismaClient();
  // Execute the next setup or assertion step for this scenario.
  let release!: () => void;
  // Bind gate for later setup or assertions in this scope.
  const gate = new Promise<void>((resolve) => {
    // Execute the next setup or assertion step for this scenario.
    release = resolve;
  });
  // Execute the next setup or assertion step for this scenario.
  let holderPid: number | null = null;
  // Bind lockHeld for later setup or assertions in this scope.
  let lockHeld = false;

  // Try path where partial failure must not leak suite state.
  try {
    // Bind holder for later setup or assertions in this scope.
    const holder = holderPrisma.$transaction(
      // Execute the next setup or assertion step for this scenario.
      async (tx) => {
        // pidRows: synchronize actors so the race window is observable.
        const pidRows = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid()::int AS pid
        `;
        // Execute the next setup or assertion step for this scenario.
        holderPid = pidRows[0]!.pid;
        // Await async work before asserting or releasing locks.
        await lockLocation(tx, opts.locationId);
        // Concurrency/isolation step for the race under test.
        lockHeld = true;
        // Await async work before asserting or releasing locks.
        await gate;
      },
      // Runner option controlling stability or isolation of the suite.
      { timeout: 60_000, maxWait: 30_000 },
    );

    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let i = 0; i < 100 && !lockHeld; i += 1) {
      // Brief yield so lock waiters/UI can settle before asserting.
      await new Promise((r) => setTimeout(r, 20));
    }
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (!lockHeld || holderPid == null) {
      // Execute the next setup or assertion step for this scenario.
      release();
      // Await async work before asserting or releasing locks.
      await holder.catch(() => undefined);
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.fail("expected holder to acquire location lock");
    }

    // Bind raceA for later setup or assertions in this scope.
    const raceA = opts.startA();
    // Bind raceB for later setup or assertions in this scope.
    const raceB = opts.startB();
    // Try path where partial failure must not leak suite state.
    try {
      // Await async work before asserting or releasing locks.
      await waitForBlockedOnHolder(opts.prisma, holderPid, 2);
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (opts.whileBothBlocked) await opts.whileBothBlocked();
    // Execute the next setup or assertion step for this scenario.
    } catch (err) {
      // Execute the next setup or assertion step for this scenario.
      release();
      // Await async work before asserting or releasing locks.
      await holder.catch(() => undefined);
      // Concurrency/isolation step for the race under test.
      raceA.catch(() => undefined);
      // Concurrency/isolation step for the race under test.
      raceB.catch(() => undefined);
      // Surface a hard failure when isolation or contract is violated.
      throw err;
    }
    // Execute the next setup or assertion step for this scenario.
    release();
    // Await async work before asserting or releasing locks.
    await holder;
    // Run actors together to expose races and serialization bugs.
    const [resultA, resultB] = await Promise.allSettled([raceA, raceB]);
    // Return the arranged value/result to the caller.
    return { resultA, resultB };
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Disconnect Prisma so the pool does not leak across suites.
    await holderPrisma.$disconnect();
  }
}

// Export helper todayYmd for reuse across related tests.
export async function todayYmd(): Promise<string> {
  // Return the arranged value/result to the caller.
  return todayHotelDateYmd();
}

/** Extra HK for assignee A2 scenarios. */
export async function createExtraHousekeeper(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  stamp: string,
  // Execute the next setup or assertion step for this scenario.
  label: string,
// Execute the next setup or assertion step for this scenario.
): Promise<EmployeeUserFixture> {
  // Return the arranged value/result to the caller.
  return createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `PLN-${label}-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `pln-${label}-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.housekeeper,
    // Fixture field fullName for the seeded actor/entity.
    fullName: `Plan HK ${label}`,
    // Fixture field password for the seeded actor/entity.
    password: PLAN_PASSWORD,
  });
}

// Re-export selected symbols for suite consumers.
export { cleanupEmployeeGraph, lockLocation };
// Execute the next setup or assertion step for this scenario.
export type { Tx };
