/**
 * Sector membership / snapshot / concurrency world for P1-58–P1-63.
 */
import type { PrismaClient } from "@prisma/client";
// Prisma client types/runtime for DB setup and assertions.
import { Role } from "@prisma/client";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  saveSector,
  // Execute the next setup or assertion step for this scenario.
  setSectorLocations,
// Execute the next setup or assertion step for this scenario.
} from "../../src/services/sectors";
// Type-only import from ../../src/services/dataScope for compile-time contracts.
import type { DataScope } from "../../src/services/dataScope";
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

/**
 * Test-only metadata patch via saveSector (production HTTP uses saveSector directly).
 */
async function updateSector(
  // Execute the next setup or assertion step for this scenario.
  id: string,
  // Execute the next setup or assertion step for this scenario.
  input: {
    // Execute the next setup or assertion step for this scenario.
    code?: string;
    // Execute the next setup or assertion step for this scenario.
    nameBg?: string;
    // Execute the next setup or assertion step for this scenario.
    nameEn?: string;
    // Execute the next setup or assertion step for this scenario.
    primarySupervisorEmployeeId?: string | null;
    // Execute the next setup or assertion step for this scenario.
    isActive?: boolean;
    // Execute the next setup or assertion step for this scenario.
    expectedVersion: number;
    // Execute the next setup or assertion step for this scenario.
    actorEmployeeId?: string;
    // Execute the next setup or assertion step for this scenario.
    actorUserId?: string;
    // Execute the next setup or assertion step for this scenario.
    actorRole?: Role;
    // Execute the next setup or assertion step for this scenario.
    scope?: DataScope;
    // Delivery/replay step for async notification paths.
    allowCrossSectorTransfer?: boolean;
  },
// Execute the next setup or assertion step for this scenario.
) {
  // Execute the next setup or assertion step for this scenario.
  const scope: DataScope =
    // Execute the next setup or assertion step for this scenario.
    input.scope ??
    ({
      // Execute the next setup or assertion step for this scenario.
      kind: "all",
      // Execute the next setup or assertion step for this scenario.
      employeeId: input.actorEmployeeId ?? "",
      // Fixture field role for the seeded actor/entity.
      role: input.actorRole ?? Role.manager,
      // Execute the next setup or assertion step for this scenario.
      sectorIds: [],
    // Execute the next setup or assertion step for this scenario.
    } satisfies DataScope);
  // Return the arranged value/result to the caller.
  return saveSector(id, {
    // Execute the next setup or assertion step for this scenario.
    code: input.code,
    // Execute the next setup or assertion step for this scenario.
    nameBg: input.nameBg,
    // Execute the next setup or assertion step for this scenario.
    nameEn: input.nameEn,
    // Execute the next setup or assertion step for this scenario.
    primarySupervisorEmployeeId: input.primarySupervisorEmployeeId,
    // Execute the next setup or assertion step for this scenario.
    isActive: input.isActive,
    // Execute the next setup or assertion step for this scenario.
    expectedVersion: input.expectedVersion,
    // Execute the next setup or assertion step for this scenario.
    actor: {
      // Execute the next setup or assertion step for this scenario.
      employeeId: input.actorEmployeeId,
      // Execute the next setup or assertion step for this scenario.
      userId: input.actorUserId,
      // Fixture field role for the seeded actor/entity.
      role: input.actorRole ?? scope.role,
    },
    // Execute the next setup or assertion step for this scenario.
    scope,
    // Delivery/replay step for async notification paths.
    allowCrossSectorTransfer: input.allowCrossSectorTransfer ?? true,
  });
}

// Export SECTORS_PASSWORD for shared test/setup consumers.
export const SECTORS_PASSWORD = "demo1234";

// Export SectorsWorld for shared test/setup consumers.
export type SectorsWorld = {
  // Execute the next setup or assertion step for this scenario.
  stamp: string;
  // Fixture field password for the seeded actor/entity.
  password: string;
  // Execute the next setup or assertion step for this scenario.
  propertyId: string;
  // Execute the next setup or assertion step for this scenario.
  buildingId: string;
  // Execute the next setup or assertion step for this scenario.
  floorId: string;
  /** Supervisor A owns S1 + S2 (rebalance). */
  supervisorA: EmployeeUserFixture;
  /** Foreign supervisor for S_foreign. */
  supervisorB: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  manager: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  housekeeper: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  technician: EmployeeUserFixture;
  /** Sectors owned by A. */
  sectorA1Id: string;
  // Execute the next setup or assertion step for this scenario.
  sectorA2Id: string;
  /** Foreign sector (B). */
  sectorForeignId: string;
  /** L1,L2 start in A1; L3 in A2; L4 in foreign; L5 unassigned. */
  loc1Id: string;
  // Execute the next setup or assertion step for this scenario.
  loc2Id: string;
  // Execute the next setup or assertion step for this scenario.
  loc3Id: string;
  // Execute the next setup or assertion step for this scenario.
  loc4Id: string;
  // Execute the next setup or assertion step for this scenario.
  loc5Id: string;
};

// Export helper createSectorsWorld for reuse across related tests.
export async function createSectorsWorld(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
// Execute the next setup or assertion step for this scenario.
): Promise<SectorsWorld> {
  // stamp: unique stamp so parallel runs do not collide.
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // password: credential/token material for auth flows.
  const password = SECTORS_PASSWORD;

  // supervisorA: seeded entity required before the mutation under test.
  const supervisorA = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `SEC-SA-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `sec-sup-a-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.supervisor,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "SEC Supervisor A",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // supervisorB: seeded entity required before the mutation under test.
  const supervisorB = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `SEC-SB-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `sec-sup-b-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.supervisor,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "SEC Supervisor B",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // manager: seeded entity required before the mutation under test.
  const manager = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `SEC-MGR-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `sec-mgr-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.manager,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "SEC Manager",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // housekeeper: seeded entity required before the mutation under test.
  const housekeeper = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `SEC-HK-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `sec-hk-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.housekeeper,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "SEC Housekeeper",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // technician: seeded entity required before the mutation under test.
  const technician = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `SEC-TECH-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `sec-tech-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.technician,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "SEC Technician",
    // Execute the next setup or assertion step for this scenario.
    password,
  });

  // property: seeded entity required before the mutation under test.
  const property = await prisma.property.create({
    // Execute the next setup or assertion step for this scenario.
    data: { name: `SEC Property ${stamp}` },
  });
  // building: seeded entity required before the mutation under test.
  const building = await prisma.building.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      propertyId: property.id,
      // Fixture field name for the seeded actor/entity.
      name: "SEC Building",
      // Execute the next setup or assertion step for this scenario.
      code: `SECB-${stamp}`.slice(0, 32),
    },
  });
  // floor: seeded entity required before the mutation under test.
  const floor = await prisma.floor.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      buildingId: building.id,
      // Execute the next setup or assertion step for this scenario.
      number: 7,
      // Fixture field name for the seeded actor/entity.
      name: "SEC Floor",
    },
  });

  // sectorA1: seeded entity required before the mutation under test.
  const sectorA1 = await prisma.sector.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      propertyId: property.id,
      // Execute the next setup or assertion step for this scenario.
      code: `SA1-${stamp}`.slice(0, 32),
      // Execute the next setup or assertion step for this scenario.
      nameBg: "SEC A1",
      // Execute the next setup or assertion step for this scenario.
      nameEn: "SEC A1",
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: supervisorA.employeeId,
      // Execute the next setup or assertion step for this scenario.
      isActive: true,
    },
  });
  // sectorA2: seeded entity required before the mutation under test.
  const sectorA2 = await prisma.sector.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      propertyId: property.id,
      // Execute the next setup or assertion step for this scenario.
      code: `SA2-${stamp}`.slice(0, 32),
      // Execute the next setup or assertion step for this scenario.
      nameBg: "SEC A2",
      // Execute the next setup or assertion step for this scenario.
      nameEn: "SEC A2",
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: supervisorA.employeeId,
      // Execute the next setup or assertion step for this scenario.
      isActive: true,
    },
  });
  // sectorForeign: seeded entity required before the mutation under test.
  const sectorForeign = await prisma.sector.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      propertyId: property.id,
      // Execute the next setup or assertion step for this scenario.
      code: `SF-${stamp}`.slice(0, 32),
      // Execute the next setup or assertion step for this scenario.
      nameBg: "SEC Foreign",
      // Execute the next setup or assertion step for this scenario.
      nameEn: "SEC Foreign",
      // Execute the next setup or assertion step for this scenario.
      primarySupervisorEmployeeId: supervisorB.employeeId,
      // Execute the next setup or assertion step for this scenario.
      isActive: true,
    },
  });

  // Bind mkLoc for later setup or assertions in this scope.
  const mkLoc = (n: string) =>
    // Execute the next setup or assertion step for this scenario.
    prisma.location.create({
      // Execute the next setup or assertion step for this scenario.
      data: {
        // Execute the next setup or assertion step for this scenario.
        floorId: floor.id,
        // Execute the next setup or assertion step for this scenario.
        number: `${n}-${stamp}`.slice(0, 24),
        // Execute the next setup or assertion step for this scenario.
        kind: "room",
      },
    });

  // loc1: synchronize actors so the race window is observable.
  const loc1 = await mkLoc("L1");
  // loc2: synchronize actors so the race window is observable.
  const loc2 = await mkLoc("L2");
  // loc3: synchronize actors so the race window is observable.
  const loc3 = await mkLoc("L3");
  // loc4: synchronize actors so the race window is observable.
  const loc4 = await mkLoc("L4");
  // loc5: synchronize actors so the race window is observable.
  const loc5 = await mkLoc("L5");

  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  await prisma.sectorLocation.createMany({
    // Execute the next setup or assertion step for this scenario.
    data: [
      // Execute the next setup or assertion step for this scenario.
      { sectorId: sectorA1.id, locationId: loc1.id },
      // Execute the next setup or assertion step for this scenario.
      { sectorId: sectorA1.id, locationId: loc2.id },
      // Execute the next setup or assertion step for this scenario.
      { sectorId: sectorA2.id, locationId: loc3.id },
      // Execute the next setup or assertion step for this scenario.
      { sectorId: sectorForeign.id, locationId: loc4.id },
    ],
  });

  // Return the arranged value/result to the caller.
  return {
    // Execute the next setup or assertion step for this scenario.
    stamp,
    // Execute the next setup or assertion step for this scenario.
    password,
    // Execute the next setup or assertion step for this scenario.
    propertyId: property.id,
    // Execute the next setup or assertion step for this scenario.
    buildingId: building.id,
    // Execute the next setup or assertion step for this scenario.
    floorId: floor.id,
    // Execute the next setup or assertion step for this scenario.
    supervisorA,
    // Execute the next setup or assertion step for this scenario.
    supervisorB,
    // Execute the next setup or assertion step for this scenario.
    manager,
    // Execute the next setup or assertion step for this scenario.
    housekeeper,
    // Execute the next setup or assertion step for this scenario.
    technician,
    // Execute the next setup or assertion step for this scenario.
    sectorA1Id: sectorA1.id,
    // Execute the next setup or assertion step for this scenario.
    sectorA2Id: sectorA2.id,
    // Execute the next setup or assertion step for this scenario.
    sectorForeignId: sectorForeign.id,
    // Execute the next setup or assertion step for this scenario.
    loc1Id: loc1.id,
    // Execute the next setup or assertion step for this scenario.
    loc2Id: loc2.id,
    // Execute the next setup or assertion step for this scenario.
    loc3Id: loc3.id,
    // Execute the next setup or assertion step for this scenario.
    loc4Id: loc4.id,
    // Execute the next setup or assertion step for this scenario.
    loc5Id: loc5.id,
  };
}

/** Reset membership to the canonical fixture layout (no task cleanup). */
export async function resetSectorMemberships(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  world: SectorsWorld,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Bind locIds for later setup or assertions in this scope.
  const locIds = [
    // Execute the next setup or assertion step for this scenario.
    world.loc1Id,
    // Execute the next setup or assertion step for this scenario.
    world.loc2Id,
    // Execute the next setup or assertion step for this scenario.
    world.loc3Id,
    // Execute the next setup or assertion step for this scenario.
    world.loc4Id,
    // Execute the next setup or assertion step for this scenario.
    world.loc5Id,
  ];
  // Await async work before asserting or releasing locks.
  await prisma.sectorLocation.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { locationId: { in: locIds } },
  });
  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  await prisma.sectorLocation.createMany({
    // Execute the next setup or assertion step for this scenario.
    data: [
      // Execute the next setup or assertion step for this scenario.
      { sectorId: world.sectorA1Id, locationId: world.loc1Id },
      // Execute the next setup or assertion step for this scenario.
      { sectorId: world.sectorA1Id, locationId: world.loc2Id },
      // Execute the next setup or assertion step for this scenario.
      { sectorId: world.sectorA2Id, locationId: world.loc3Id },
      // Execute the next setup or assertion step for this scenario.
      { sectorId: world.sectorForeignId, locationId: world.loc4Id },
    ],
  });
  // Restore primaries on A sectors.
  await prisma.sector.update({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: world.sectorA1Id },
    // Execute the next setup or assertion step for this scenario.
    data: { primarySupervisorEmployeeId: world.supervisorA.employeeId },
  });
  // Await async work before asserting or releasing locks.
  await prisma.sector.update({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: world.sectorA2Id },
    // Execute the next setup or assertion step for this scenario.
    data: { primarySupervisorEmployeeId: world.supervisorA.employeeId },
  });
}

// Export helper membershipSnapshot for reuse across related tests.
export async function membershipSnapshot(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  locationIds: string[],
// Execute the next setup or assertion step for this scenario.
): Promise<Map<string, string | null>> {
  // rows: synchronize actors so the race window is observable.
  const rows = await prisma.sectorLocation.findMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { locationId: { in: locationIds } },
    // SQL fragment used to observe locks or assert DB state.
    select: { locationId: true, sectorId: true },
  });
  // Bind map for later setup or assertions in this scope.
  const map = new Map<string, string | null>();
  // Iterate to cover variants or wait until a condition holds.
  for (const id of locationIds) map.set(id, null);
  // Iterate to cover variants or wait until a condition holds.
  for (const r of rows) map.set(r.locationId, r.sectorId);
  // Return the arranged value/result to the caller.
  return map;
}

// Export helper sectorMemberIds for reuse across related tests.
export async function sectorMemberIds(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  sectorId: string,
// Execute the next setup or assertion step for this scenario.
): Promise<string[]> {
  // rows: synchronize actors so the race window is observable.
  const rows = await prisma.sectorLocation.findMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { sectorId },
    // SQL fragment used to observe locks or assert DB state.
    select: { locationId: true },
    // Execute the next setup or assertion step for this scenario.
    orderBy: { locationId: "asc" },
  });
  // Return the arranged value/result to the caller.
  return rows.map((r) => r.locationId);
}

// Export helper cleanupSectorsWorld for reuse across related tests.
export async function cleanupSectorsWorld(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  world: SectorsWorld,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Bind locIds for later setup or assertions in this scope.
  const locIds = [
    // Execute the next setup or assertion step for this scenario.
    world.loc1Id,
    // Execute the next setup or assertion step for this scenario.
    world.loc2Id,
    // Execute the next setup or assertion step for this scenario.
    world.loc3Id,
    // Execute the next setup or assertion step for this scenario.
    world.loc4Id,
    // Execute the next setup or assertion step for this scenario.
    world.loc5Id,
  ];
  // Await async work before asserting or releasing locks.
  await prisma.cleaningSession.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { task: { locationId: { in: locIds } } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.inspection.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { task: { locationId: { in: locIds } } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.cleaningTask.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { locationId: { in: locIds } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.ticketEvent.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { ticket: { locationId: { in: locIds } } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.maintenanceTicket.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { locationId: { in: locIds } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.dailyPlanEntry.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { locationId: { in: locIds } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.auditEvent.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // SQL fragment used to observe locks or assert DB state.
      OR: [
        // Execute the next setup or assertion step for this scenario.
        { locationId: { in: locIds } },
        {
          // Execute the next setup or assertion step for this scenario.
          entityType: "sector",
          // Execute the next setup or assertion step for this scenario.
          entityId: {
            // Execute the next setup or assertion step for this scenario.
            in: [world.sectorA1Id, world.sectorA2Id, world.sectorForeignId],
          },
        },
      ],
    },
  });
  // Await async work before asserting or releasing locks.
  await prisma.sectorLocation.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { locationId: { in: locIds } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.location.deleteMany({ where: { id: { in: locIds } } });
  // Await async work before asserting or releasing locks.
  await prisma.sector.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Execute the next setup or assertion step for this scenario.
      id: {
        // Execute the next setup or assertion step for this scenario.
        in: [world.sectorA1Id, world.sectorA2Id, world.sectorForeignId],
      },
    },
  });
  // Await async work before asserting or releasing locks.
  await prisma.floor.deleteMany({ where: { id: world.floorId } });
  // Await async work before asserting or releasing locks.
  await prisma.building.deleteMany({ where: { id: world.buildingId } });
  // Await async work before asserting or releasing locks.
  await prisma.property.deleteMany({ where: { id: world.propertyId } });
  // Await async work before asserting or releasing locks.
  await cleanupEmployeeGraph(prisma, [
    // Execute the next setup or assertion step for this scenario.
    world.supervisorA.employeeId,
    // Execute the next setup or assertion step for this scenario.
    world.supervisorB.employeeId,
    // Execute the next setup or assertion step for this scenario.
    world.manager.employeeId,
    // Execute the next setup or assertion step for this scenario.
    world.housekeeper.employeeId,
    // Execute the next setup or assertion step for this scenario.
    world.technician.employeeId,
  ]);
}

/** Hold Location FOR UPDATE; expose holder backend pid for blocking asserts. */
export async function runWhileLocationLocked<T>(opts: {
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient;
  // Execute the next setup or assertion step for this scenario.
  locationId: string;
  // Concurrency/isolation step for the race under test.
  startRace: () => Promise<T>;
  // Concurrency/isolation step for the race under test.
  whileBlocked: (ctx: {
    // Execute the next setup or assertion step for this scenario.
    holderPid: number;
    // Execute the next setup or assertion step for this scenario.
    tx: import("@prisma/client").Prisma.TransactionClient;
  // Execute the next setup or assertion step for this scenario.
  }) => Promise<void>;
  // Execute the next setup or assertion step for this scenario.
  timeoutMs?: number;
// Execute the next setup or assertion step for this scenario.
}): Promise<T> {
  // timeoutMs: bound how long the wait/poll may run.
  const timeoutMs = opts.timeoutMs ?? 15_000;
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

  // Bind holder for later setup or assertions in this scope.
  const holder = opts.prisma.$transaction(
    // Execute the next setup or assertion step for this scenario.
    async (tx) => {
      // pidRows: synchronize actors so the race window is observable.
      const pidRows = await tx.$queryRaw<{ pid: number }[]>`
        SELECT pg_backend_pid()::int AS pid
      `;
      // Execute the next setup or assertion step for this scenario.
      holderPid = pidRows[0]!.pid;
      // Await async work before asserting or releasing locks.
      await tx.$executeRaw`
        SELECT id FROM "Location" WHERE id = ${opts.locationId} FOR UPDATE
      `;
      // Concurrency/isolation step for the race under test.
      lockHeld = true;
      // Await async work before asserting or releasing locks.
      await gate;
    },
    // Runner option controlling stability or isolation of the suite.
    { timeout: 30_000, maxWait: 30_000 },
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
    // Surface a hard failure when isolation or contract is violated.
    throw new Error("expected holder to acquire Location FOR UPDATE");
  }

  // Bind raceP for later setup or assertions in this scope.
  const raceP = opts.startRace();
  // deadline: bound how long the wait/poll may run.
  const deadline = Date.now() + timeoutMs;
  // Concurrency/isolation step for the race under test.
  let blockedPid: number | null = null;
  // Repeat/poll to widen the race window or wait for lock waiters.
  while (Date.now() < deadline) {
    // rows: synchronize actors so the race window is observable.
    const rows = await opts.prisma.$queryRaw<{ pid: number }[]>`
      SELECT pid::int AS pid
      FROM pg_stat_activity
      WHERE wait_event_type = 'Lock'
        AND pid <> ${holderPid}
        AND datname = current_database()
        AND ${holderPid} = ANY (pg_blocking_pids(pid))
    `;
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (rows.length) {
      // Concurrency/isolation step for the race under test.
      blockedPid = rows[0]!.pid;
      // Execute the next setup or assertion step for this scenario.
      break;
    }
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise((r) => setTimeout(r, 25));
  }
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (blockedPid == null) {
    // Execute the next setup or assertion step for this scenario.
    release();
    // Await async work before asserting or releasing locks.
    await holder.catch(() => undefined);
    // Concurrency/isolation step for the race under test.
    raceP.catch(() => undefined);
    // Surface a hard failure when isolation or contract is violated.
    throw new Error(
      // Concurrency/isolation step for the race under test.
      `timed out waiting for a backend blocked by holder pid=${holderPid}`,
    );
  }

  // Try path where partial failure must not leak suite state.
  try {
    // Await async work before asserting or releasing locks.
    await opts.whileBlocked({ holderPid, tx: null as never });
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

  // whileBlocked may need the holder tx — re-run pattern for 61b below.
  release();
  // Await async work before asserting or releasing locks.
  await holder;
  // Return the arranged value/result to the caller.
  return raceP;
}

/**
 * Hold Location lock; while a raced production op is blocked on that lock,
 * run `whileBlocked` with the holder transaction still open (for replaceMembership).
 */
export async function runWhileLocationLockedWithTx<T>(opts: {
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient;
  // Execute the next setup or assertion step for this scenario.
  locationId: string;
  // Concurrency/isolation step for the race under test.
  startRace: () => Promise<T>;
  // Concurrency/isolation step for the race under test.
  whileBlocked: (ctx: {
    // Execute the next setup or assertion step for this scenario.
    holderPid: number;
    // Execute the next setup or assertion step for this scenario.
    tx: import("@prisma/client").Prisma.TransactionClient;
  // Execute the next setup or assertion step for this scenario.
  }) => Promise<void>;
  // Execute the next setup or assertion step for this scenario.
  timeoutMs?: number;
// Execute the next setup or assertion step for this scenario.
}): Promise<T> {
  // timeoutMs: bound how long the wait/poll may run.
  const timeoutMs = opts.timeoutMs ?? 15_000;
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
  // Execute the next setup or assertion step for this scenario.
  let holderTx: import("@prisma/client").Prisma.TransactionClient | null =
    // Execute the next setup or assertion step for this scenario.
    null;

  // Bind holder for later setup or assertions in this scope.
  const holder = opts.prisma.$transaction(
    // Execute the next setup or assertion step for this scenario.
    async (tx) => {
      // Execute the next setup or assertion step for this scenario.
      holderTx = tx;
      // pidRows: synchronize actors so the race window is observable.
      const pidRows = await tx.$queryRaw<{ pid: number }[]>`
        SELECT pg_backend_pid()::int AS pid
      `;
      // Execute the next setup or assertion step for this scenario.
      holderPid = pidRows[0]!.pid;
      // Await async work before asserting or releasing locks.
      await tx.$executeRaw`
        SELECT id FROM "Location" WHERE id = ${opts.locationId} FOR UPDATE
      `;
      // Concurrency/isolation step for the race under test.
      lockHeld = true;
      // Await async work before asserting or releasing locks.
      await gate;
    },
    // Runner option controlling stability or isolation of the suite.
    { timeout: 30_000, maxWait: 30_000 },
  );

  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let i = 0; i < 100 && !lockHeld; i += 1) {
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise((r) => setTimeout(r, 20));
  }
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (!lockHeld || holderPid == null || !holderTx) {
    // Execute the next setup or assertion step for this scenario.
    release();
    // Await async work before asserting or releasing locks.
    await holder.catch(() => undefined);
    // Surface a hard failure when isolation or contract is violated.
    throw new Error("expected holder to acquire Location FOR UPDATE");
  }

  // Bind raceP for later setup or assertions in this scope.
  const raceP = opts.startRace();
  // deadline: bound how long the wait/poll may run.
  const deadline = Date.now() + timeoutMs;
  // Bind sawBlocked for later setup or assertions in this scope.
  let sawBlocked = false;
  // Repeat/poll to widen the race window or wait for lock waiters.
  while (Date.now() < deadline) {
    // rows: synchronize actors so the race window is observable.
    const rows = await opts.prisma.$queryRaw<{ pid: number }[]>`
      SELECT pid::int AS pid
      FROM pg_stat_activity
      WHERE wait_event_type = 'Lock'
        AND pid <> ${holderPid}
        AND datname = current_database()
        AND ${holderPid} = ANY (pg_blocking_pids(pid))
    `;
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (rows.length) {
      // Concurrency/isolation step for the race under test.
      sawBlocked = true;
      // Execute the next setup or assertion step for this scenario.
      break;
    }
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise((r) => setTimeout(r, 25));
  }
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (!sawBlocked) {
    // Execute the next setup or assertion step for this scenario.
    release();
    // Await async work before asserting or releasing locks.
    await holder.catch(() => undefined);
    // Concurrency/isolation step for the race under test.
    raceP.catch(() => undefined);
    // Surface a hard failure when isolation or contract is violated.
    throw new Error(
      // Concurrency/isolation step for the race under test.
      `timed out waiting for production op blocked by holder pid=${holderPid}`,
    );
  }

  // Try path where partial failure must not leak suite state.
  try {
    // Await async work before asserting or releasing locks.
    await opts.whileBlocked({ holderPid, tx: holderTx });
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

/**
 * Wait until at least `minWaiters` backends are blocked by holderPid.
 * Includes the Lock queue behind the first waiter (transitive pg_blocking_pids),
 * so dual concurrent writers both count even when only one is directly blocked
 * by the holder.
 */
/** Current Sector.version for CAS in service-level tests. */
export async function currentSectorVersion(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  sectorId: string,
// Execute the next setup or assertion step for this scenario.
): Promise<number> {
  // row: synchronize actors so the race window is observable.
  const row = await prisma.sector.findUniqueOrThrow({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: sectorId },
    // SQL fragment used to observe locks or assert DB state.
    select: { version: true },
  });
  // Return the arranged value/result to the caller.
  return row.version;
}

/** updateSector with a freshly read expectedVersion (test convenience). */
export async function updateSectorAtHead(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  sectorId: string,
  // Execute the next setup or assertion step for this scenario.
  input: {
    // Execute the next setup or assertion step for this scenario.
    code?: string;
    // Execute the next setup or assertion step for this scenario.
    nameBg?: string;
    // Execute the next setup or assertion step for this scenario.
    nameEn?: string;
    // Execute the next setup or assertion step for this scenario.
    primarySupervisorEmployeeId?: string | null;
    // Execute the next setup or assertion step for this scenario.
    isActive?: boolean;
    // Execute the next setup or assertion step for this scenario.
    actorEmployeeId?: string;
    // Execute the next setup or assertion step for this scenario.
    actorUserId?: string;
    // Execute the next setup or assertion step for this scenario.
    actorRole?: Role;
    // Execute the next setup or assertion step for this scenario.
    scope?: DataScope;
    // Delivery/replay step for async notification paths.
    allowCrossSectorTransfer?: boolean;
  },
// Execute the next setup or assertion step for this scenario.
) {
  // Return the arranged value/result to the caller.
  return updateSector(sectorId, {
    // Continue the call chain for setup or assertion detail.
    ...input,
    // Await async work before asserting or releasing locks.
    expectedVersion: await currentSectorVersion(prisma, sectorId),
  });
}

/** setSectorLocations with a freshly read expectedVersion (test convenience). */
export async function setSectorLocationsAtHead(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  sectorId: string,
  // Execute the next setup or assertion step for this scenario.
  locationIds: string[],
  // Execute the next setup or assertion step for this scenario.
  options: {
    // Execute the next setup or assertion step for this scenario.
    actorEmployeeId?: string;
    // Execute the next setup or assertion step for this scenario.
    actorUserId?: string;
    // Execute the next setup or assertion step for this scenario.
    actorRole?: Role;
    // Execute the next setup or assertion step for this scenario.
    scope: DataScope;
    // Delivery/replay step for async notification paths.
    allowCrossSectorTransfer: boolean;
  },
// Execute the next setup or assertion step for this scenario.
) {
  // Return the arranged value/result to the caller.
  return setSectorLocations(sectorId, locationIds, {
    // Continue the call chain for setup or assertion detail.
    ...options,
    // Await async work before asserting or releasing locks.
    expectedVersion: await currentSectorVersion(prisma, sectorId),
  });
}

// Export helper waitForBlockedByHolder for reuse across related tests.
export async function waitForBlockedByHolder(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  holderPid: number,
  // Execute the next setup or assertion step for this scenario.
  minWaiters: number,
  // Execute the next setup or assertion step for this scenario.
  timeoutMs = 15_000,
// Execute the next setup or assertion step for this scenario.
): Promise<number[]> {
  // deadline: bound how long the wait/poll may run.
  const deadline = Date.now() + timeoutMs;
  // Repeat/poll to widen the race window or wait for lock waiters.
  while (Date.now() < deadline) {
    // rows: synchronize actors so the race window is observable.
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
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (rows.length >= minWaiters) {
      // Return the arranged value/result to the caller.
      return rows.map((r) => r.pid);
    }
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise((r) => setTimeout(r, 25));
  }
  // Surface a hard failure when isolation or contract is violated.
  throw new Error(
    // Concurrency/isolation step for the race under test.
    `timed out waiting for ${minWaiters} backends blocked by pid=${holderPid}`,
  );
}
