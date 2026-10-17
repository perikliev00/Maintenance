/**
 * Shared world + helpers for cleaning lifecycle integration tests (P1-11…P1-30).
 * Lives under api/tests/cleaning/ so it is outside the parallel npm test glob.
 */
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import {
  CleaningStatus,
  Prisma,
  PrismaClient,
  Role,
  SessionStatus,
  TaskStatus,
  TicketStatus,
} from "@prisma/client";
import { AppError } from "../../src/errors";
import {
  cancelCleaningSession,
  createCleaningTask,
  startCleaningTask,
} from "../../src/services/cleaning";
import {
  hotelDateString,
  todayHotelDateYmd,
  withHotelNowForTests,
} from "../../src/services/hotelTime";
import {
  getFlags,
  getOperations,
  updateSetting,
} from "../../src/services/settings";
import type {
  FlagsSettings,
  OperationsSettings,
} from "../../src/services/settingsSchema";
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
  type EmployeeUserFixture,
} from "../fixtures";

export const CLN_PASSWORD = "test-password-cln";

export type CleaningWorld = {
  stamp: string;
  propertyId: string;
  buildingId: string;
  floorId: string;
  locationAId: string;
  locationBId: string;
  hk1: EmployeeUserFixture;
  hk2: EmployeeUserFixture;
  owner: EmployeeUserFixture;
  manager: EmployeeUserFixture;
  reception: EmployeeUserFixture;
  technician: EmployeeUserFixture;
  employeeIds: string[];
};

export type DualDayRunningSetup = {
  day1Ymd: string;
  day2Ymd: string;
  day1TaskId: string;
  day2TaskId: string;
  day1SessionId: string;
  day2SessionId: string;
  day1Version: number;
  day2Version: number;
};

export function isAppError(
  err: unknown,
): err is AppError {
  return err instanceof AppError;
}

export function errCode(err: unknown): string | null {
  return isAppError(err) ? err.code : null;
}

export async function hotelTodayYmd(): Promise<string> {
  return todayHotelDateYmd();
}

export function ymdOffset(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Create isolated two-room world with HK×2, owner, manager, reception, technician. */
export async function createCleaningWorld(
  prisma: PrismaClient,
): Promise<CleaningWorld> {
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const hk1 = await createEmployeeWithUser(prisma, {
    employeeNumber: `CLN-HK1-${stamp}`.slice(0, 32),
    email: `cln-hk1-${stamp}@test.local`,
    role: Role.housekeeper,
    fullName: "CLN Housekeeper 1",
    password: CLN_PASSWORD,
  });
  const hk2 = await createEmployeeWithUser(prisma, {
    employeeNumber: `CLN-HK2-${stamp}`.slice(0, 32),
    email: `cln-hk2-${stamp}@test.local`,
    role: Role.housekeeper,
    fullName: "CLN Housekeeper 2",
    password: CLN_PASSWORD,
  });
  const owner = await createEmployeeWithUser(prisma, {
    employeeNumber: `CLN-OWN-${stamp}`.slice(0, 32),
    email: `cln-own-${stamp}@test.local`,
    role: Role.owner,
    fullName: "CLN Owner",
    password: CLN_PASSWORD,
  });
  const manager = await createEmployeeWithUser(prisma, {
    employeeNumber: `CLN-MGR-${stamp}`.slice(0, 32),
    email: `cln-mgr-${stamp}@test.local`,
    role: Role.manager,
    fullName: "CLN Manager",
    password: CLN_PASSWORD,
  });
  const reception = await createEmployeeWithUser(prisma, {
    employeeNumber: `CLN-REC-${stamp}`.slice(0, 32),
    email: `cln-rec-${stamp}@test.local`,
    role: Role.reception,
    fullName: "CLN Reception",
    password: CLN_PASSWORD,
  });
  const technician = await createEmployeeWithUser(prisma, {
    employeeNumber: `CLN-TEC-${stamp}`.slice(0, 32),
    email: `cln-tec-${stamp}@test.local`,
    role: Role.technician,
    fullName: "CLN Technician",
    password: CLN_PASSWORD,
  });

  const property = await prisma.property.create({
    data: { name: `CLN Property ${stamp}` },
  });
  const building = await prisma.building.create({
    data: {
      propertyId: property.id,
      name: "CLN Building",
      code: `CLNB-${stamp}`.slice(0, 32),
    },
  });
  const floor = await prisma.floor.create({
    data: {
      buildingId: building.id,
      number: 77,
      name: "CLN Floor",
    },
  });
  const locationA = await prisma.location.create({
    data: {
      floorId: floor.id,
      number: `CLA-${stamp}`.slice(0, 24),
      kind: "room",
      cleaningStatus: CleaningStatus.dirty,
    },
  });
  const locationB = await prisma.location.create({
    data: {
      floorId: floor.id,
      number: `CLB-${stamp}`.slice(0, 24),
      kind: "room",
      cleaningStatus: CleaningStatus.dirty,
    },
  });

  const employeeIds = [
    hk1.employeeId,
    hk2.employeeId,
    owner.employeeId,
    manager.employeeId,
    reception.employeeId,
    technician.employeeId,
  ];

  return {
    stamp,
    propertyId: property.id,
    buildingId: building.id,
    floorId: floor.id,
    locationAId: locationA.id,
    locationBId: locationB.id,
    hk1,
    hk2,
    owner,
    manager,
    reception,
    technician,
    employeeIds,
  };
}

/** Cancel active cleaning work on the world's locations (and our employees' sessions). */
export async function resetCleaningWork(
  prisma: PrismaClient,
  world: CleaningWorld,
): Promise<void> {
  const locationIds = [world.locationAId, world.locationBId];

  await prisma.cleaningSession.updateMany({
    where: {
      OR: [
        { task: { locationId: { in: locationIds } } },
        { employeeId: { in: world.employeeIds } },
      ],
      status: SessionStatus.running,
    },
    data: {
      status: SessionStatus.cancelled,
      finishedAt: new Date(),
      notes: "cln test reset",
    },
  });

  await prisma.cleaningTask.updateMany({
    where: {
      locationId: { in: locationIds },
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

export async function cleanupCleaningWorld(
  prisma: PrismaClient,
  world: CleaningWorld,
): Promise<void> {
  const locationIds = [world.locationAId, world.locationBId];

  await prisma.inspection.deleteMany({
    where: { task: { locationId: { in: locationIds } } },
  });
  await prisma.cleaningSession.deleteMany({
    where: {
      OR: [
        { task: { locationId: { in: locationIds } } },
        { employeeId: { in: world.employeeIds } },
      ],
    },
  });
  await prisma.cleaningTask.deleteMany({
    where: { locationId: { in: locationIds } },
  });
  await prisma.maintenanceTicket.deleteMany({
    where: { locationId: { in: locationIds } },
  });
  await prisma.location.deleteMany({
    where: { id: { in: locationIds } },
  });
  await prisma.floor.deleteMany({ where: { id: world.floorId } });
  await prisma.building.deleteMany({ where: { id: world.buildingId } });
  await prisma.property.deleteMany({ where: { id: world.propertyId } });
  await cleanupEmployeeGraph(prisma, world.employeeIds);
}

/**
 * Read-modify-write flags patch with restore in finally.
 * Required for require_inspection / allow_reception_reassign isolation.
 */
export async function withFlagsPatch<T>(
  actorEmployeeId: string,
  partial: Partial<FlagsSettings>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = await getFlags();
  const next: FlagsSettings = { ...original, ...partial };
  await updateSetting({
    key: "flags",
    value: next,
    actorEmployeeId,
    reason: "cln test flags patch",
  });
  try {
    return await fn();
  } finally {
    await updateSetting({
      key: "flags",
      value: original,
      actorEmployeeId,
      reason: "cln test flags restore",
    });
  }
}

/**
 * Read-modify-write operations patch with restore in finally.
 * Used for hotelTimezone midnight-boundary start tests.
 */
export async function withOperationsPatch<T>(
  actorEmployeeId: string,
  partial: Partial<OperationsSettings>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = await getOperations();
  const next: OperationsSettings = { ...original, ...partial };
  await updateSetting({
    key: "operations",
    value: next,
    actorEmployeeId,
    reason: "cln test operations patch",
  });
  try {
    return await fn();
  } finally {
    await updateSetting({
      key: "operations",
      value: original,
      actorEmployeeId,
      reason: "cln test operations restore",
    });
  }
}

/** Hotel calendar YMD for a fixed UTC instant in a given IANA zone. */
export function hotelYmdAt(instant: Date, timeZone: string): string {
  return hotelDateString(instant, timeZone);
}

/** Re-export test clock freeze used by T-CLN-13b midnight-boundary starts. */
export { withHotelNowForTests };

type Tx = Prisma.TransactionClient;

/**
 * Poll until another backend is blocked on a Lock wait event.
 * Row-level FOR UPDATE waiters show up here (often as transactionid), not as
 * ungranted relation locks on the table name.
 */
export async function waitForLockWaiter(
  prisma: PrismaClient,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n
      FROM pg_stat_activity
      WHERE wait_event_type = 'Lock'
        AND pid <> pg_backend_pid()
        AND datname = current_database()
    `;
    if (rows[0] && rows[0].n > 0n) return;
    // Also catch ungranted lock entries (covers some drivers/pool timings).
    const lockRows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n
      FROM pg_locks
      WHERE NOT granted
    `;
    if (lockRows[0] && lockRows[0].n > 0n) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail("timed out waiting for a backend blocked on Lock");
}

/**
 * Hold a row lock, start a racing promise (past its outer checks), wait until
 * that txn is blocked on FOR UPDATE, run `whileBlocked`, then release.
 * Replaces timing heuristics like setTimeout(80).
 */
export async function runWhileRowLocked<T>(opts: {
  prisma: PrismaClient;
  acquireLock: (tx: Tx) => Promise<void>;
  startRace: () => Promise<T>;
  whileBlocked: () => Promise<void>;
}): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let lockHeld = false;
  const holder = opts.prisma.$transaction(
    async (tx) => {
      await opts.acquireLock(tx);
      lockHeld = true;
      await gate;
    },
    { timeout: 20_000, maxWait: 20_000 },
  );

  for (let i = 0; i < 50 && !lockHeld; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
  }
  if (!lockHeld) {
    release();
    await holder.catch(() => undefined);
    assert.fail("expected advisory holder to acquire row lock");
  }

  const raceP = opts.startRace();
  try {
    await waitForLockWaiter(opts.prisma);
    await opts.whileBlocked();
  } catch (err) {
    release();
    await holder.catch(() => undefined);
    raceP.catch(() => undefined);
    throw err;
  }
  release();
  await holder;
  return raceP;
}

export async function createOpenMaintenanceTicket(
  prisma: PrismaClient,
  world: CleaningWorld,
  locationId: string,
) {
  return prisma.maintenanceTicket.create({
    data: {
      locationId,
      title: `CLN ticket ${world.stamp}`,
      categoryKey: "other",
      categoryLabelBg: "Друго",
      categoryLabelEn: "Other",
      reportedByEmployeeId: world.manager.employeeId,
      status: TicketStatus.new,
    },
  });
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

/**
 * Fresh dual-day setup: HK1 running on yesterday's task; HK2 running on today's task.
 * Call once per test — do not reuse after cancel/complete mutations.
 */
export async function createDualDayRunningSetup(
  prisma: PrismaClient,
  world: CleaningWorld,
): Promise<DualDayRunningSetup> {
  await resetCleaningWork(prisma, world);

  const today = await hotelTodayYmd();
  const day1Ymd = ymdOffset(today, -1);
  const day2Ymd = today;

  const day1Task = await createCleaningTask({
    locationId: world.locationAId,
    hotelDate: day1Ymd,
    assignedEmployeeId: world.hk1.employeeId,
    actorEmployeeId: world.owner.employeeId,
  });
  const day1Started = await startCleaningTask({
    taskId: day1Task.id,
    employeeId: world.hk1.employeeId,
    commandId: randomUUID(),
    expectedVersion: day1Task.version,
  });

  const day2Task = await createCleaningTask({
    locationId: world.locationAId,
    hotelDate: day2Ymd,
    assignedEmployeeId: world.hk2.employeeId,
    actorEmployeeId: world.owner.employeeId,
  });
  const day2Started = await startCleaningTask({
    taskId: day2Task.id,
    employeeId: world.hk2.employeeId,
    commandId: randomUUID(),
    expectedVersion: day2Task.version,
  });

  return {
    day1Ymd,
    day2Ymd,
    day1TaskId: day1Task.id,
    day2TaskId: day2Task.id,
    day1SessionId: day1Started.session.id,
    day2SessionId: day2Started.session.id,
    day1Version: day1Started.task.version,
    day2Version: day2Started.task.version,
  };
}

/** Start an assigned task for today on a location; returns task+session after start. */
export async function createAndStartToday(
  world: CleaningWorld,
  locationId: string,
  employeeId: string,
) {
  const today = await hotelTodayYmd();
  const task = await createCleaningTask({
    locationId,
    hotelDate: today,
    assignedEmployeeId: employeeId,
    actorEmployeeId: world.owner.employeeId,
  });
  const started = await startCleaningTask({
    taskId: task.id,
    employeeId,
    commandId: randomUUID(),
    expectedVersion: task.version,
  });
  return { today, task, started };
}

/** Cancel a running session with bypass (owner/reviewer path). */
export async function cancelAsOwner(
  sessionId: string,
  ownerEmployeeId: string,
  expectedVersion?: number,
) {
  return cancelCleaningSession({
    sessionId,
    employeeId: ownerEmployeeId,
    commandId: randomUUID(),
    expectedVersion,
    bypassSessionOwnerCheck: true,
  });
}
