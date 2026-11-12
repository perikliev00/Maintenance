/**
 * Sector membership / snapshot / concurrency world for P1-58–P1-63.
 */
import type { PrismaClient } from "@prisma/client";
import { Role } from "@prisma/client";
import {
  saveSector,
  setSectorLocations,
} from "../../src/services/sectors";
import type { DataScope } from "../../src/services/dataScope";
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
  // Shape EmployeeUserFixture documents the fixture/response fields this suite touches.
  type EmployeeUserFixture,
} from "../fixtures";

/**
 * Test-only metadata patch via saveSector (production HTTP uses saveSector directly).
 */
async function updateSector(
  id: string,
  input: {
    code?: string;
    nameBg?: string;
    nameEn?: string;
    primarySupervisorEmployeeId?: string | null;
    isActive?: boolean;
    expectedVersion: number;
    actorEmployeeId?: string;
    actorUserId?: string;
    actorRole?: Role;
    scope?: DataScope;
    allowCrossSectorTransfer?: boolean;
  },
) {
  const scope: DataScope =
    input.scope ??
    ({
      kind: "all",
      employeeId: input.actorEmployeeId ?? "",
      role: input.actorRole ?? Role.manager,
      sectorIds: [],
    } satisfies DataScope);
  return saveSector(id, {
    code: input.code,
    nameBg: input.nameBg,
    nameEn: input.nameEn,
    primarySupervisorEmployeeId: input.primarySupervisorEmployeeId,
    isActive: input.isActive,
    expectedVersion: input.expectedVersion,
    actor: {
      employeeId: input.actorEmployeeId,
      userId: input.actorUserId,
      role: input.actorRole ?? scope.role,
    },
    scope,
    allowCrossSectorTransfer: input.allowCrossSectorTransfer ?? true,
  });
}

// Export SECTORS_PASSWORD for shared test/setup consumers.
export const SECTORS_PASSWORD = "demo1234";

// Export SectorsWorld for shared test/setup consumers.
export type SectorsWorld = {
  stamp: string;
  password: string;
  propertyId: string;
  buildingId: string;
  floorId: string;
  /** Supervisor A owns S1 + S2 (rebalance). */
  supervisorA: EmployeeUserFixture;
  /** Foreign supervisor for S_foreign. */
  supervisorB: EmployeeUserFixture;
  manager: EmployeeUserFixture;
  housekeeper: EmployeeUserFixture;
  technician: EmployeeUserFixture;
  /** Sectors owned by A. */
  sectorA1Id: string;
  sectorA2Id: string;
  /** Foreign sector (B). */
  sectorForeignId: string;
  /** L1,L2 start in A1; L3 in A2; L4 in foreign; L5 unassigned. */
  loc1Id: string;
  loc2Id: string;
  loc3Id: string;
  loc4Id: string;
  loc5Id: string;
};

// Export helper createSectorsWorld for reuse across related tests.
export async function createSectorsWorld(
  prisma: PrismaClient,
): Promise<SectorsWorld> {
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const password = SECTORS_PASSWORD;

  // supervisorA: seeded entity required before the mutation under test.
  const supervisorA = await createEmployeeWithUser(prisma, {
    employeeNumber: `SEC-SA-${stamp}`.slice(0, 32),
    email: `sec-sup-a-${stamp}@test.local`,
    role: Role.supervisor,
    fullName: "SEC Supervisor A",
    password,
  });
  // supervisorB: seeded entity required before the mutation under test.
  const supervisorB = await createEmployeeWithUser(prisma, {
    employeeNumber: `SEC-SB-${stamp}`.slice(0, 32),
    email: `sec-sup-b-${stamp}@test.local`,
    role: Role.supervisor,
    fullName: "SEC Supervisor B",
    password,
  });
  // manager: seeded entity required before the mutation under test.
  const manager = await createEmployeeWithUser(prisma, {
    employeeNumber: `SEC-MGR-${stamp}`.slice(0, 32),
    email: `sec-mgr-${stamp}@test.local`,
    role: Role.manager,
    fullName: "SEC Manager",
    password,
  });
  // housekeeper: seeded entity required before the mutation under test.
  const housekeeper = await createEmployeeWithUser(prisma, {
    employeeNumber: `SEC-HK-${stamp}`.slice(0, 32),
    email: `sec-hk-${stamp}@test.local`,
    role: Role.housekeeper,
    fullName: "SEC Housekeeper",
    password,
  });
  // technician: seeded entity required before the mutation under test.
  const technician = await createEmployeeWithUser(prisma, {
    employeeNumber: `SEC-TECH-${stamp}`.slice(0, 32),
    email: `sec-tech-${stamp}@test.local`,
    role: Role.technician,
    fullName: "SEC Technician",
    password,
  });

  // property: seeded entity required before the mutation under test.
  const property = await prisma.property.create({
    data: { name: `SEC Property ${stamp}` },
  });
  // building: seeded entity required before the mutation under test.
  const building = await prisma.building.create({
    data: {
      propertyId: property.id,
      name: "SEC Building",
      code: `SECB-${stamp}`.slice(0, 32),
    },
  });
  // floor: seeded entity required before the mutation under test.
  const floor = await prisma.floor.create({
    data: {
      buildingId: building.id,
      number: 7,
      name: "SEC Floor",
    },
  });

  // sectorA1: seeded entity required before the mutation under test.
  const sectorA1 = await prisma.sector.create({
    data: {
      propertyId: property.id,
      code: `SA1-${stamp}`.slice(0, 32),
      nameBg: "SEC A1",
      nameEn: "SEC A1",
      primarySupervisorEmployeeId: supervisorA.employeeId,
      isActive: true,
    },
  });
  // sectorA2: seeded entity required before the mutation under test.
  const sectorA2 = await prisma.sector.create({
    data: {
      propertyId: property.id,
      code: `SA2-${stamp}`.slice(0, 32),
      nameBg: "SEC A2",
      nameEn: "SEC A2",
      primarySupervisorEmployeeId: supervisorA.employeeId,
      isActive: true,
    },
  });
  // sectorForeign: seeded entity required before the mutation under test.
  const sectorForeign = await prisma.sector.create({
    data: {
      propertyId: property.id,
      code: `SF-${stamp}`.slice(0, 32),
      nameBg: "SEC Foreign",
      nameEn: "SEC Foreign",
      primarySupervisorEmployeeId: supervisorB.employeeId,
      isActive: true,
    },
  });

  const mkLoc = (n: string) =>
    prisma.location.create({
      data: {
        floorId: floor.id,
        number: `${n}-${stamp}`.slice(0, 24),
        kind: "room",
      },
    });

  const loc1 = await mkLoc("L1");
  const loc2 = await mkLoc("L2");
  const loc3 = await mkLoc("L3");
  const loc4 = await mkLoc("L4");
  const loc5 = await mkLoc("L5");

  await prisma.sectorLocation.createMany({
    data: [
      { sectorId: sectorA1.id, locationId: loc1.id },
      { sectorId: sectorA1.id, locationId: loc2.id },
      { sectorId: sectorA2.id, locationId: loc3.id },
      { sectorId: sectorForeign.id, locationId: loc4.id },
    ],
  });

  return {
    stamp,
    password,
    propertyId: property.id,
    buildingId: building.id,
    floorId: floor.id,
    supervisorA,
    supervisorB,
    manager,
    housekeeper,
    technician,
    sectorA1Id: sectorA1.id,
    sectorA2Id: sectorA2.id,
    sectorForeignId: sectorForeign.id,
    loc1Id: loc1.id,
    loc2Id: loc2.id,
    loc3Id: loc3.id,
    loc4Id: loc4.id,
    loc5Id: loc5.id,
  };
}

/** Reset membership to the canonical fixture layout (no task cleanup). */
export async function resetSectorMemberships(
  prisma: PrismaClient,
  world: SectorsWorld,
): Promise<void> {
  const locIds = [
    world.loc1Id,
    world.loc2Id,
    world.loc3Id,
    world.loc4Id,
    world.loc5Id,
  ];
  await prisma.sectorLocation.deleteMany({
    where: { locationId: { in: locIds } },
  });
  await prisma.sectorLocation.createMany({
    data: [
      { sectorId: world.sectorA1Id, locationId: world.loc1Id },
      { sectorId: world.sectorA1Id, locationId: world.loc2Id },
      { sectorId: world.sectorA2Id, locationId: world.loc3Id },
      { sectorId: world.sectorForeignId, locationId: world.loc4Id },
    ],
  });
  // Restore primaries on A sectors.
  await prisma.sector.update({
    where: { id: world.sectorA1Id },
    data: { primarySupervisorEmployeeId: world.supervisorA.employeeId },
  });
  await prisma.sector.update({
    where: { id: world.sectorA2Id },
    data: { primarySupervisorEmployeeId: world.supervisorA.employeeId },
  });
}

// Export helper membershipSnapshot for reuse across related tests.
export async function membershipSnapshot(
  prisma: PrismaClient,
  locationIds: string[],
): Promise<Map<string, string | null>> {
  const rows = await prisma.sectorLocation.findMany({
    where: { locationId: { in: locationIds } },
    select: { locationId: true, sectorId: true },
  });
  const map = new Map<string, string | null>();
  for (const id of locationIds) map.set(id, null);
  for (const r of rows) map.set(r.locationId, r.sectorId);
  return map;
}

// Export helper sectorMemberIds for reuse across related tests.
export async function sectorMemberIds(
  prisma: PrismaClient,
  sectorId: string,
): Promise<string[]> {
  const rows = await prisma.sectorLocation.findMany({
    where: { sectorId },
    select: { locationId: true },
    orderBy: { locationId: "asc" },
  });
  return rows.map((r) => r.locationId);
}

// Export helper cleanupSectorsWorld for reuse across related tests.
export async function cleanupSectorsWorld(
  prisma: PrismaClient,
  world: SectorsWorld,
): Promise<void> {
  const locIds = [
    world.loc1Id,
    world.loc2Id,
    world.loc3Id,
    world.loc4Id,
    world.loc5Id,
  ];
  await prisma.cleaningSession.deleteMany({
    where: { task: { locationId: { in: locIds } } },
  });
  await prisma.inspection.deleteMany({
    where: { task: { locationId: { in: locIds } } },
  });
  await prisma.cleaningTask.deleteMany({
    where: { locationId: { in: locIds } },
  });
  await prisma.ticketEvent.deleteMany({
    where: { ticket: { locationId: { in: locIds } } },
  });
  await prisma.maintenanceTicket.deleteMany({
    where: { locationId: { in: locIds } },
  });
  await prisma.dailyPlanEntry.deleteMany({
    where: { locationId: { in: locIds } },
  });
  await prisma.auditEvent.deleteMany({
    where: {
      OR: [
        { locationId: { in: locIds } },
        {
          entityType: "sector",
          entityId: {
            in: [world.sectorA1Id, world.sectorA2Id, world.sectorForeignId],
          },
        },
      ],
    },
  });
  await prisma.sectorLocation.deleteMany({
    where: { locationId: { in: locIds } },
  });
  await prisma.location.deleteMany({ where: { id: { in: locIds } } });
  await prisma.sector.deleteMany({
    where: {
      id: {
        in: [world.sectorA1Id, world.sectorA2Id, world.sectorForeignId],
      },
    },
  });
  await prisma.floor.deleteMany({ where: { id: world.floorId } });
  await prisma.building.deleteMany({ where: { id: world.buildingId } });
  await prisma.property.deleteMany({ where: { id: world.propertyId } });
  await cleanupEmployeeGraph(prisma, [
    world.supervisorA.employeeId,
    world.supervisorB.employeeId,
    world.manager.employeeId,
    world.housekeeper.employeeId,
    world.technician.employeeId,
  ]);
}

/** Hold Location FOR UPDATE; expose holder backend pid for blocking asserts. */
export async function runWhileLocationLocked<T>(opts: {
  prisma: PrismaClient;
  locationId: string;
  startRace: () => Promise<T>;
  whileBlocked: (ctx: {
    holderPid: number;
    tx: import("@prisma/client").Prisma.TransactionClient;
  }) => Promise<void>;
  timeoutMs?: number;
}): Promise<T> {
  // timeoutMs: bound how long the wait/poll may run.
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holderPid: number | null = null;
  let lockHeld = false;

  const holder = opts.prisma.$transaction(
    async (tx) => {
      const pidRows = await tx.$queryRaw<{ pid: number }[]>`
        SELECT pg_backend_pid()::int AS pid
      `;
      holderPid = pidRows[0]!.pid;
      await tx.$executeRaw`
        SELECT id FROM "Location" WHERE id = ${opts.locationId} FOR UPDATE
      `;
      lockHeld = true;
      await gate;
    },
    { timeout: 30_000, maxWait: 30_000 },
  );

  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let i = 0; i < 100 && !lockHeld; i += 1) {
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise((r) => setTimeout(r, 20));
  }
  if (!lockHeld || holderPid == null) {
    release();
    await holder.catch(() => undefined);
    // Surface a hard failure when isolation or contract is violated.
    throw new Error("expected holder to acquire Location FOR UPDATE");
  }

  const raceP = opts.startRace();
  // deadline: bound how long the wait/poll may run.
  const deadline = Date.now() + timeoutMs;
  let blockedPid: number | null = null;
  // Repeat/poll to widen the race window or wait for lock waiters.
  while (Date.now() < deadline) {
    const rows = await opts.prisma.$queryRaw<{ pid: number }[]>`
      SELECT pid::int AS pid
      FROM pg_stat_activity
      WHERE wait_event_type = 'Lock'
        AND pid <> ${holderPid}
        AND datname = current_database()
        AND ${holderPid} = ANY (pg_blocking_pids(pid))
    `;
    if (rows.length) {
      blockedPid = rows[0]!.pid;
      break;
    }
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise((r) => setTimeout(r, 25));
  }
  if (blockedPid == null) {
    release();
    await holder.catch(() => undefined);
    raceP.catch(() => undefined);
    // Surface a hard failure when isolation or contract is violated.
    throw new Error(
      `timed out waiting for a backend blocked by holder pid=${holderPid}`,
    );
  }

  try {
    await opts.whileBlocked({ holderPid, tx: null as never });
  } catch (err) {
    release();
    await holder.catch(() => undefined);
    raceP.catch(() => undefined);
    // Surface a hard failure when isolation or contract is violated.
    throw err;
  }

  // whileBlocked may need the holder tx — re-run pattern for 61b below.
  release();
  await holder;
  return raceP;
}

/**
 * Hold Location lock; while a raced production op is blocked on that lock,
 * run `whileBlocked` with the holder transaction still open (for replaceMembership).
 */
export async function runWhileLocationLockedWithTx<T>(opts: {
  prisma: PrismaClient;
  locationId: string;
  startRace: () => Promise<T>;
  whileBlocked: (ctx: {
    holderPid: number;
    tx: import("@prisma/client").Prisma.TransactionClient;
  }) => Promise<void>;
  timeoutMs?: number;
}): Promise<T> {
  // timeoutMs: bound how long the wait/poll may run.
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holderPid: number | null = null;
  let lockHeld = false;
  let holderTx: import("@prisma/client").Prisma.TransactionClient | null =
    null;

  const holder = opts.prisma.$transaction(
    async (tx) => {
      holderTx = tx;
      const pidRows = await tx.$queryRaw<{ pid: number }[]>`
        SELECT pg_backend_pid()::int AS pid
      `;
      holderPid = pidRows[0]!.pid;
      await tx.$executeRaw`
        SELECT id FROM "Location" WHERE id = ${opts.locationId} FOR UPDATE
      `;
      lockHeld = true;
      await gate;
    },
    { timeout: 30_000, maxWait: 30_000 },
  );

  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let i = 0; i < 100 && !lockHeld; i += 1) {
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise((r) => setTimeout(r, 20));
  }
  if (!lockHeld || holderPid == null || !holderTx) {
    release();
    await holder.catch(() => undefined);
    // Surface a hard failure when isolation or contract is violated.
    throw new Error("expected holder to acquire Location FOR UPDATE");
  }

  const raceP = opts.startRace();
  // deadline: bound how long the wait/poll may run.
  const deadline = Date.now() + timeoutMs;
  let sawBlocked = false;
  // Repeat/poll to widen the race window or wait for lock waiters.
  while (Date.now() < deadline) {
    const rows = await opts.prisma.$queryRaw<{ pid: number }[]>`
      SELECT pid::int AS pid
      FROM pg_stat_activity
      WHERE wait_event_type = 'Lock'
        AND pid <> ${holderPid}
        AND datname = current_database()
        AND ${holderPid} = ANY (pg_blocking_pids(pid))
    `;
    if (rows.length) {
      sawBlocked = true;
      break;
    }
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise((r) => setTimeout(r, 25));
  }
  if (!sawBlocked) {
    release();
    await holder.catch(() => undefined);
    raceP.catch(() => undefined);
    // Surface a hard failure when isolation or contract is violated.
    throw new Error(
      `timed out waiting for production op blocked by holder pid=${holderPid}`,
    );
  }

  try {
    await opts.whileBlocked({ holderPid, tx: holderTx });
  } catch (err) {
    release();
    await holder.catch(() => undefined);
    raceP.catch(() => undefined);
    // Surface a hard failure when isolation or contract is violated.
    throw err;
  }
  release();
  await holder;
  return raceP;
}

/**
 * Wait until at least `minWaiters` backends are blocked by holderPid.
 * Includes the Lock queue behind the first waiter (transitive pg_blocking_pids),
 * so dual concurrent writers both count even when only one is directly blocked
 * by the holder.
 */
/** Current Sector.version for CAS in service-level tests. */
export async function currentSectorVersion(
  prisma: PrismaClient,
  sectorId: string,
): Promise<number> {
  const row = await prisma.sector.findUniqueOrThrow({
    where: { id: sectorId },
    select: { version: true },
  });
  return row.version;
}

/** updateSector with a freshly read expectedVersion (test convenience). */
export async function updateSectorAtHead(
  prisma: PrismaClient,
  sectorId: string,
  input: {
    code?: string;
    nameBg?: string;
    nameEn?: string;
    primarySupervisorEmployeeId?: string | null;
    isActive?: boolean;
    actorEmployeeId?: string;
    actorUserId?: string;
    actorRole?: Role;
    scope?: DataScope;
    allowCrossSectorTransfer?: boolean;
  },
) {
  return updateSector(sectorId, {
    ...input,
    expectedVersion: await currentSectorVersion(prisma, sectorId),
  });
}

/** setSectorLocations with a freshly read expectedVersion (test convenience). */
export async function setSectorLocationsAtHead(
  prisma: PrismaClient,
  sectorId: string,
  locationIds: string[],
  options: {
    actorEmployeeId?: string;
    actorUserId?: string;
    actorRole?: Role;
    scope: DataScope;
    allowCrossSectorTransfer: boolean;
  },
) {
  return setSectorLocations(sectorId, locationIds, {
    ...options,
    expectedVersion: await currentSectorVersion(prisma, sectorId),
  });
}

// Export helper waitForBlockedByHolder for reuse across related tests.
export async function waitForBlockedByHolder(
  prisma: PrismaClient,
  holderPid: number,
  minWaiters: number,
  timeoutMs = 15_000,
): Promise<number[]> {
  // deadline: bound how long the wait/poll may run.
  const deadline = Date.now() + timeoutMs;
  // Repeat/poll to widen the race window or wait for lock waiters.
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<{ pid: number }[]>`
      WITH RECURSIVE blocked AS (
        SELECT pid
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> ${holderPid}
          AND ${holderPid} = ANY (pg_blocking_pids(pid))
        UNION
        SELECT a.pid
        FROM pg_stat_activity a
        INNER JOIN blocked b ON b.pid = ANY (pg_blocking_pids(a.pid))
        WHERE a.datname = current_database()
          AND a.pid <> ${holderPid}
      )
      SELECT DISTINCT pid::int AS pid
      FROM blocked
      WHERE EXISTS (
        SELECT 1
        FROM pg_stat_activity s
        WHERE s.pid = blocked.pid
          AND s.wait_event_type = 'Lock'
      )
    `;
    if (rows.length >= minWaiters) {
      return rows.map((r) => r.pid);
    }
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise((r) => setTimeout(r, 25));
  }
  // Surface a hard failure when isolation or contract is violated.
  throw new Error(
    `timed out waiting for ${minWaiters} backends blocked by pid=${holderPid}`,
  );
}
