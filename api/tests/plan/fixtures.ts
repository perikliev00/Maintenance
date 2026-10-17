/**
 * Shared helpers for daily-plan integration tests (P1-48…P1-57).
 * Outside the parallel src test glob; run via `npm run test:plan`.
 */
import assert from "node:assert/strict";
import {
  CatalogStatus,
  CleaningStatus,
  DailyPlanCategory,
  DailyPlanSource,
  Occupancy,
  Prisma,
  PrismaClient,
  Priority,
  Role,
  TaskStatus,
} from "@prisma/client";
import { lockLocation } from "../../src/services/cleaning/locks";
import { todayHotelDateYmd } from "../../src/services/hotelTime";
import {
  CLN_PASSWORD,
  cleanupCleaningWorld,
  createCleaningWorld,
  hotelTodayYmd,
  ymdOffset,
  type CleaningWorld,
} from "../cleaning/fixtures";
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
  type EmployeeUserFixture,
} from "../fixtures";
import {
  closeServer,
  getJson,
  listenApp,
  loginBearer,
  postJson,
} from "../httpHarness";

export {
  CLN_PASSWORD,
  closeServer,
  getJson,
  hotelTodayYmd,
  listenApp,
  loginBearer,
  postJson,
  ymdOffset,
};
export type { CleaningWorld, EmployeeUserFixture };

type Tx = Prisma.TransactionClient;

export const PLAN_PASSWORD = CLN_PASSWORD;
export const PLAN_CONFLICT_MESSAGE =
  "Plan entry already exists for this room/date/category";

export type PlanWorld = CleaningWorld & {
  buildingCode: string;
  roomANumber: string;
  roomBNumber: string;
  archivedLocationId: string;
  archivedNumber: string;
  locationCId: string;
  roomCNumber: string;
  shiftId: string;
  shift2Id: string;
};

export type LocationSnap = {
  occupancy: Occupancy;
  cleaningStatus: CleaningStatus;
  cleaningCycle: number;
};

export type EntrySnap = {
  id: string;
  source: DailyPlanSource;
  notes: string | null;
  category: DailyPlanCategory;
  hotelDate: string;
  locationId: string;
  cleaningTaskId: string | null;
  roomEffectsAppliedAt: Date | null;
  assignedEmployeeId: string | null;
  shiftId: string | null;
};

/** Create isolated plan world: 3 rooms + archived, 2 shifts, cleaning roles. */
export async function createPlanWorld(
  prisma: PrismaClient,
): Promise<PlanWorld> {
  const base = await createCleaningWorld(prisma);
  const stamp = base.stamp;

  const building = await prisma.building.findUniqueOrThrow({
    where: { id: base.buildingId },
  });
  const locA = await prisma.location.findUniqueOrThrow({
    where: { id: base.locationAId },
  });
  const locB = await prisma.location.findUniqueOrThrow({
    where: { id: base.locationBId },
  });

  const archived = await prisma.location.create({
    data: {
      floorId: base.floorId,
      number: `ARC-${stamp}`.slice(0, 24),
      kind: "room",
      cleaningStatus: CleaningStatus.dirty,
      occupancy: Occupancy.vacant,
      catalogStatus: CatalogStatus.archived,
    },
  });

  const locC = await prisma.location.create({
    data: {
      floorId: base.floorId,
      number: `CLC-${stamp}`.slice(0, 24),
      kind: "room",
      cleaningStatus: CleaningStatus.dirty,
      occupancy: Occupancy.vacant,
    },
  });

  const shift1 = await prisma.shift.create({
    data: {
      code: `P1S1-${stamp}`.slice(0, 32),
      nameBg: "Plan Shift 1",
      nameEn: "Plan Shift 1",
      startTime: "08:00",
      endTime: "16:00",
      isActive: true,
    },
  });
  const shift2 = await prisma.shift.create({
    data: {
      code: `P1S2-${stamp}`.slice(0, 32),
      nameBg: "Plan Shift 2",
      nameEn: "Plan Shift 2",
      startTime: "14:00",
      endTime: "22:00",
      isActive: true,
    },
  });

  return {
    ...base,
    buildingCode: building.code,
    roomANumber: locA.number,
    roomBNumber: locB.number,
    archivedLocationId: archived.id,
    archivedNumber: archived.number,
    locationCId: locC.id,
    roomCNumber: locC.number,
    shiftId: shift1.id,
    shift2Id: shift2.id,
  };
}

export async function cleanupPlanWorld(
  prisma: PrismaClient,
  world: PlanWorld,
): Promise<void> {
  const locationIds = [
    world.locationAId,
    world.locationBId,
    world.locationCId,
    world.archivedLocationId,
  ];
  await cleanupPlanArtifacts(prisma, locationIds, world.employeeIds);
  await prisma.shift.deleteMany({
    where: { id: { in: [world.shiftId, world.shift2Id] } },
  });
  await prisma.location.deleteMany({
    where: { id: { in: [world.locationCId, world.archivedLocationId] } },
  });
  // cleanupCleaningWorld deletes A/B + building/property/employees
  await cleanupCleaningWorld(prisma, world);
}

/** Delete plan entries, import batches, and all cleaning tasks for locations. */
export async function cleanupPlanArtifacts(
  prisma: PrismaClient,
  locationIds: string[],
  createdByEmployeeIds: string[] = [],
): Promise<void> {
  if (!locationIds.length && !createdByEmployeeIds.length) return;
  const entries = locationIds.length
    ? await prisma.dailyPlanEntry.findMany({
        where: { locationId: { in: locationIds } },
        select: { id: true, importBatchId: true },
      })
    : [];
  const batchIds = [
    ...new Set(
      entries
        .map((e) => e.importBatchId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (locationIds.length) {
    await prisma.dailyPlanEntry.deleteMany({
      where: { locationId: { in: locationIds } },
    });
  }
  // Batches with only skips still reference createdByEmployeeId — delete those too.
  const batchOr: Prisma.DailyPlanImportBatchWhereInput[] = [];
  if (batchIds.length) batchOr.push({ id: { in: batchIds } });
  if (createdByEmployeeIds.length) {
    batchOr.push({ createdByEmployeeId: { in: createdByEmployeeIds } });
  }
  if (batchOr.length) {
    await prisma.dailyPlanImportBatch.deleteMany({ where: { OR: batchOr } });
  }
  if (locationIds.length) {
    await prisma.inspection.deleteMany({
      where: { task: { locationId: { in: locationIds } } },
    });
    await prisma.cleaningSession.deleteMany({
      where: { task: { locationId: { in: locationIds } } },
    });
    await prisma.cleaningTask.deleteMany({
      where: { locationId: { in: locationIds } },
    });
  }
}

export async function snapshotLocation(
  prisma: PrismaClient,
  locationId: string,
): Promise<LocationSnap> {
  const loc = await prisma.location.findUniqueOrThrow({
    where: { id: locationId },
    select: {
      occupancy: true,
      cleaningStatus: true,
      cleaningCycle: true,
    },
  });
  return loc;
}

export async function snapshotEntry(
  prisma: PrismaClient,
  entryId: string,
): Promise<EntrySnap> {
  const e = await prisma.dailyPlanEntry.findUniqueOrThrow({
    where: { id: entryId },
  });
  return {
    id: e.id,
    source: e.source,
    notes: e.notes,
    category: e.category,
    hotelDate: e.hotelDate.toISOString().slice(0, 10),
    locationId: e.locationId,
    cleaningTaskId: e.cleaningTaskId,
    roomEffectsAppliedAt: e.roomEffectsAppliedAt,
    assignedEmployeeId: e.assignedEmployeeId,
    shiftId: e.shiftId,
  };
}

export function assertLocationSnapEqual(
  actual: LocationSnap,
  expected: LocationSnap,
  label: string,
): void {
  assert.equal(actual.occupancy, expected.occupancy, `${label} occupancy`);
  assert.equal(
    actual.cleaningStatus,
    expected.cleaningStatus,
    `${label} cleaningStatus`,
  );
  assert.equal(
    actual.cleaningCycle,
    expected.cleaningCycle,
    `${label} cleaningCycle`,
  );
}

export async function countActiveTasks(
  prisma: PrismaClient,
  locationId: string,
  hotelDateYmd: string,
): Promise<number> {
  return prisma.cleaningTask.count({
    where: {
      locationId,
      hotelDate: new Date(`${hotelDateYmd}T00:00:00.000Z`),
      status: {
        in: [
          TaskStatus.assigned,
          TaskStatus.in_progress,
          TaskStatus.awaiting_inspection,
          TaskStatus.rework,
        ],
      },
    },
  });
}

export async function cancelActiveTasks(
  prisma: PrismaClient,
  locationId: string,
  hotelDateYmd?: string,
): Promise<void> {
  await prisma.cleaningTask.updateMany({
    where: {
      locationId,
      ...(hotelDateYmd
        ? { hotelDate: new Date(`${hotelDateYmd}T00:00:00.000Z`) }
        : {}),
      status: {
        in: [
          TaskStatus.assigned,
          TaskStatus.in_progress,
          TaskStatus.awaiting_inspection,
          TaskStatus.rework,
        ],
      },
    },
    data: { status: TaskStatus.cancelled },
  });
}

export async function prepareRoom(
  prisma: PrismaClient,
  locationId: string,
  opts: {
    occupancy: Occupancy;
    cleaningStatus: CleaningStatus;
    cleaningCycle?: number;
  },
): Promise<void> {
  await prisma.location.update({
    where: { id: locationId },
    data: {
      occupancy: opts.occupancy,
      cleaningStatus: opts.cleaningStatus,
      ...(opts.cleaningCycle !== undefined
        ? { cleaningCycle: opts.cleaningCycle }
        : {}),
      catalogStatus: CatalogStatus.active,
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
  prisma: PrismaClient,
  input: {
    hotelDateYmd: string;
    locationId: string;
    createdByEmployeeId: string;
    assignedEmployeeId?: string | null;
    shiftId?: string | null;
    notes?: string;
    cleaningStatus?: CleaningStatus;
    cleaningCycle?: number;
    cleaningTaskId?: string | null;
    /** When false, caller already prepared occupancy/cleaning (default true). */
    prepareOccupiedRoom?: boolean;
  },
) {
  if (input.prepareOccupiedRoom !== false) {
    await prepareRoom(prisma, input.locationId, {
      occupancy: Occupancy.occupied,
      cleaningStatus: input.cleaningStatus ?? CleaningStatus.dirty,
      cleaningCycle: input.cleaningCycle,
    });
  }
  // Clear occupancy→occupied audits after plan day that would trigger protect.
  const after = new Date(
    `${ymdOffset(input.hotelDateYmd, 1)}T00:00:00.000Z`,
  );
  await prisma.auditEvent.deleteMany({
    where: {
      locationId: input.locationId,
      action: "location.set_occupancy",
      occurredAt: { gte: after },
    },
  });

  return prisma.dailyPlanEntry.create({
    data: {
      hotelDate: new Date(`${input.hotelDateYmd}T00:00:00.000Z`),
      locationId: input.locationId,
      category: DailyPlanCategory.departure,
      source: DailyPlanSource.manual,
      notes: input.notes ?? "deferred test",
      assignedEmployeeId: input.assignedEmployeeId ?? null,
      shiftId: input.shiftId ?? null,
      roomEffectsAppliedAt: null,
      cleaningTaskId: input.cleaningTaskId ?? null,
      createdByEmployeeId: input.createdByEmployeeId,
    },
  });
}

export async function createActiveTask(
  prisma: PrismaClient,
  input: {
    locationId: string;
    hotelDateYmd: string;
    priority?: Priority;
    assignedEmployeeId?: string | null;
    shiftId?: string | null;
    cleaningCycle?: number;
  },
) {
  const loc = await prisma.location.findUniqueOrThrow({
    where: { id: input.locationId },
    select: { cleaningCycle: true },
  });
  return prisma.cleaningTask.create({
    data: {
      locationId: input.locationId,
      hotelDate: new Date(`${input.hotelDateYmd}T00:00:00.000Z`),
      priority: input.priority ?? Priority.normal,
      status: TaskStatus.assigned,
      assignedEmployeeId: input.assignedEmployeeId ?? null,
      shiftId: input.shiftId ?? null,
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
  prisma: PrismaClient,
  holderPid: number,
  minWaiters = 2,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
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
    if (rows[0] && rows[0].n >= BigInt(minWaiters)) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail(
    `timed out waiting for ${minWaiters} backends in holder ${holderPid} blocking chain`,
  );
}

/**
 * Hold a Location FOR UPDATE on a dedicated Prisma client (avoids pool
 * starvation), start two racing ops, wait until both are blocked on this
 * holder, then release.
 */
export async function runWhileRowLockedBoth<A, B>(opts: {
  prisma: PrismaClient;
  locationId: string;
  startA: () => Promise<A>;
  startB: () => Promise<B>;
  whileBothBlocked?: () => Promise<void>;
}): Promise<{ resultA: PromiseSettledResult<A>; resultB: PromiseSettledResult<B> }> {
  // Dedicated client so the holder connection is not taken from the shared pool
  // that create/import need to reach lockLocation.
  const holderPrisma = new PrismaClient();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holderPid: number | null = null;
  let lockHeld = false;

  try {
    const holder = holderPrisma.$transaction(
      async (tx) => {
        const pidRows = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid()::int AS pid
        `;
        holderPid = pidRows[0]!.pid;
        await lockLocation(tx, opts.locationId);
        lockHeld = true;
        await gate;
      },
      { timeout: 60_000, maxWait: 30_000 },
    );

    for (let i = 0; i < 100 && !lockHeld; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    if (!lockHeld || holderPid == null) {
      release();
      await holder.catch(() => undefined);
      assert.fail("expected holder to acquire location lock");
    }

    const raceA = opts.startA();
    const raceB = opts.startB();
    try {
      await waitForBlockedOnHolder(opts.prisma, holderPid, 2);
      if (opts.whileBothBlocked) await opts.whileBothBlocked();
    } catch (err) {
      release();
      await holder.catch(() => undefined);
      raceA.catch(() => undefined);
      raceB.catch(() => undefined);
      throw err;
    }
    release();
    await holder;
    const [resultA, resultB] = await Promise.allSettled([raceA, raceB]);
    return { resultA, resultB };
  } finally {
    await holderPrisma.$disconnect();
  }
}

export async function todayYmd(): Promise<string> {
  return todayHotelDateYmd();
}

/** Extra HK for assignee A2 scenarios. */
export async function createExtraHousekeeper(
  prisma: PrismaClient,
  stamp: string,
  label: string,
): Promise<EmployeeUserFixture> {
  return createEmployeeWithUser(prisma, {
    employeeNumber: `PLN-${label}-${stamp}`.slice(0, 32),
    email: `pln-${label}-${stamp}@test.local`,
    role: Role.housekeeper,
    fullName: `Plan HK ${label}`,
    password: PLAN_PASSWORD,
  });
}

export { cleanupEmployeeGraph, lockLocation };
export type { Tx };
