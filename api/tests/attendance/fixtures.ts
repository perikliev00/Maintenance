/**
 * Shared world for attendance P1-69-78 HTTP/DB suites.
 */
import type { PrismaClient } from "@prisma/client";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  AttendanceIntervalStatus,
  // Execute the next setup or assertion step for this scenario.
  GrantKind,
  // Execute the next setup or assertion step for this scenario.
  LocationKind,
  // Execute the next setup or assertion step for this scenario.
  Role,
// Execute the next setup or assertion step for this scenario.
} from "@prisma/client";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupEmployeeGraph,
  // Execute the next setup or assertion step for this scenario.
  createEmployeeWithUser,
  // Execute the next setup or assertion step for this scenario.
  ensureUnrelatedControlFixture,
  // Shape EmployeeUserFixture documents the fixture/response fields this suite touches.
  type EmployeeUserFixture,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "../fixtures";
// Import bindings from ../../src/services/roleGrants.
import { invalidateGrantCache } from "../../src/services/roleGrants";

// Export ATT_PASSWORD for shared test/setup consumers.
export const ATT_PASSWORD = "demo1234";

// Export AttendanceWorld for shared test/setup consumers.
export type AttendanceWorld = {
  // Execute the next setup or assertion step for this scenario.
  stamp: string;
  // Fixture field password for the seeded actor/entity.
  password: string;
  // Execute the next setup or assertion step for this scenario.
  propertyId: string;
  // Execute the next setup or assertion step for this scenario.
  roomId: string;
  // Execute the next setup or assertion step for this scenario.
  commonAreaId: string;
  // Execute the next setup or assertion step for this scenario.
  housekeeper: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  technician: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  otherHk: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  supervisor: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  manager: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  owner: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  control: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  grantRoles: Role[];
};

// Execute the next setup or assertion step for this scenario.
const GRANT_ROLES: Role[] = [
  // Execute the next setup or assertion step for this scenario.
  Role.housekeeper,
  // Execute the next setup or assertion step for this scenario.
  Role.technician,
  // Execute the next setup or assertion step for this scenario.
  Role.supervisor,
  // Execute the next setup or assertion step for this scenario.
  Role.manager,
];

// Export helper createAttendanceWorld for reuse across related tests.
export async function createAttendanceWorld(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
// Execute the next setup or assertion step for this scenario.
): Promise<AttendanceWorld> {
  // stamp: unique stamp so parallel runs do not collide.
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // password: credential/token material for auth flows.
  const password = ATT_PASSWORD;
  // control: synchronize actors so the race window is observable.
  const control = await ensureUnrelatedControlFixture(prisma);

  // housekeeper: seeded entity required before the mutation under test.
  const housekeeper = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `ATT-HK-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `att-hk-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.housekeeper,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "ATT Housekeeper",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // technician: seeded entity required before the mutation under test.
  const technician = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `ATT-TECH-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `att-tech-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.technician,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "ATT Technician",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // otherHk: seeded entity required before the mutation under test.
  const otherHk = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `ATT-HK2-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `att-hk2-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.housekeeper,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "ATT Other HK",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // supervisor: seeded entity required before the mutation under test.
  const supervisor = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `ATT-SUP-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `att-sup-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.supervisor,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "ATT Supervisor",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // manager: seeded entity required before the mutation under test.
  const manager = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `ATT-MGR-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `att-mgr-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.manager,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "ATT Manager",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // owner: seeded entity required before the mutation under test.
  const owner = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `ATT-OWN-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `att-own-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.owner,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "ATT Owner",
    // Execute the next setup or assertion step for this scenario.
    password,
  });

  // property: seeded entity required before the mutation under test.
  const property = await prisma.property.create({
    // Execute the next setup or assertion step for this scenario.
    data: { name: `ATT Property ${stamp}` },
  });
  // building: seeded entity required before the mutation under test.
  const building = await prisma.building.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      propertyId: property.id,
      // Fixture field name for the seeded actor/entity.
      name: "ATT Building",
      // Execute the next setup or assertion step for this scenario.
      code: `ATTB-${stamp}`.slice(0, 32),
    },
  });
  // floor: seeded entity required before the mutation under test.
  const floor = await prisma.floor.create({
    // Execute the next setup or assertion step for this scenario.
    data: { buildingId: building.id, number: 1, name: "ATT Floor" },
  });
  // room: seeded entity required before the mutation under test.
  const room = await prisma.location.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      floorId: floor.id,
      // Execute the next setup or assertion step for this scenario.
      number: `ATR-${stamp}`.slice(0, 24),
      // Execute the next setup or assertion step for this scenario.
      kind: LocationKind.room,
    },
  });
  // common: seeded entity required before the mutation under test.
  const common = await prisma.location.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      floorId: floor.id,
      // Execute the next setup or assertion step for this scenario.
      number: `ATC-${stamp}`.slice(0, 24),
      // Execute the next setup or assertion step for this scenario.
      kind: LocationKind.common_area,
    },
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
    roomId: room.id,
    // Execute the next setup or assertion step for this scenario.
    commonAreaId: common.id,
    // Execute the next setup or assertion step for this scenario.
    housekeeper,
    // Execute the next setup or assertion step for this scenario.
    technician,
    // Execute the next setup or assertion step for this scenario.
    otherHk,
    // Execute the next setup or assertion step for this scenario.
    supervisor,
    // Execute the next setup or assertion step for this scenario.
    manager,
    // Execute the next setup or assertion step for this scenario.
    owner,
    // Execute the next setup or assertion step for this scenario.
    control,
    // Execute the next setup or assertion step for this scenario.
    grantRoles: [...GRANT_ROLES],
  };
}

// Export helper cleanupAttendanceWorld for reuse across related tests.
export async function cleanupAttendanceWorld(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  world: AttendanceWorld,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Bind empIds for later setup or assertions in this scope.
  const empIds = [
    // Execute the next setup or assertion step for this scenario.
    world.housekeeper.employeeId,
    // Execute the next setup or assertion step for this scenario.
    world.technician.employeeId,
    // Execute the next setup or assertion step for this scenario.
    world.otherHk.employeeId,
    // Execute the next setup or assertion step for this scenario.
    world.supervisor.employeeId,
    // Execute the next setup or assertion step for this scenario.
    world.manager.employeeId,
    // Execute the next setup or assertion step for this scenario.
    world.owner.employeeId,
  ];
  // Await async work before asserting or releasing locks.
  await prisma.attendanceAdjustment.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { interval: { employeeId: { in: empIds } } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.attendanceInterval.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { employeeId: { in: empIds } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.attendanceEvent.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { employeeId: { in: empIds } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.location.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: { in: [world.roomId, world.commonAreaId] } },
  });
  // floors: synchronize actors so the race window is observable.
  const floors = await prisma.floor.findMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { building: { propertyId: world.propertyId } },
    // SQL fragment used to observe locks or assert DB state.
    select: { id: true },
  });
  // Await async work before asserting or releasing locks.
  await prisma.floor.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: { in: floors.map((f) => f.id) } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.building.deleteMany({ where: { propertyId: world.propertyId } });
  // Await async work before asserting or releasing locks.
  await prisma.property.deleteMany({ where: { id: world.propertyId } });
  // Await async work before asserting or releasing locks.
  await cleanupEmployeeGraph(prisma, empIds);
}

/** Ensure role has action grant; returns disposer that restores prior rows for that role+key. */
export async function ensureActionGrant(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Fixture field role for the seeded actor/entity.
  role: Role,
  // Execute the next setup or assertion step for this scenario.
  key: string,
// Execute the next setup or assertion step for this scenario.
): Promise<() => Promise<void>> {
  // existing: synchronize actors so the race window is observable.
  const existing = await prisma.roleGrant.findUnique({
    // SQL fragment used to observe locks or assert DB state.
    where: { role_kind_key: { role, kind: GrantKind.action, key } },
  });
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (!existing) {
    // Await async work before asserting or releasing locks.
    await prisma.roleGrant.create({
      // Execute the next setup or assertion step for this scenario.
      data: { role, kind: GrantKind.action, key },
    });
    // Execute the next setup or assertion step for this scenario.
    invalidateGrantCache();
  }
  // Return the arranged value/result to the caller.
  return async () => {
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (!existing) {
      // Await async work before asserting or releasing locks.
      await prisma.roleGrant.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { role, kind: GrantKind.action, key },
      });
      // Execute the next setup or assertion step for this scenario.
      invalidateGrantCache();
    }
  };
}

// Export helper removeActionGrant for reuse across related tests.
export async function removeActionGrant(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Fixture field role for the seeded actor/entity.
  role: Role,
  // Execute the next setup or assertion step for this scenario.
  key: string,
// Execute the next setup or assertion step for this scenario.
): Promise<() => Promise<void>> {
  // existing: synchronize actors so the race window is observable.
  const existing = await prisma.roleGrant.findUnique({
    // SQL fragment used to observe locks or assert DB state.
    where: { role_kind_key: { role, kind: GrantKind.action, key } },
  });
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (existing) {
    // Await async work before asserting or releasing locks.
    await prisma.roleGrant.delete({
      // SQL fragment used to observe locks or assert DB state.
      where: { role_kind_key: { role, kind: GrantKind.action, key } },
    });
    // Execute the next setup or assertion step for this scenario.
    invalidateGrantCache();
  }
  // Return the arranged value/result to the caller.
  return async () => {
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (existing) {
      // Await async work before asserting or releasing locks.
      await prisma.roleGrant.create({
        // Execute the next setup or assertion step for this scenario.
        data: { role, kind: GrantKind.action, key },
      });
      // Execute the next setup or assertion step for this scenario.
      invalidateGrantCache();
    }
  };
}

// Export helper createClosedInterval for reuse across related tests.
export async function createClosedInterval(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  input: {
    // Execute the next setup or assertion step for this scenario.
    employeeId: string;
    // Execute the next setup or assertion step for this scenario.
    hotelDate: Date;
    // Execute the next setup or assertion step for this scenario.
    startedAt: Date;
    // Execute the next setup or assertion step for this scenario.
    endedAt: Date;
    // Execute the next setup or assertion step for this scenario.
    breakMinutes?: number;
    // Execute the next setup or assertion step for this scenario.
    workedMinutes?: number;
    // Execute the next setup or assertion step for this scenario.
    anomalyFlags?: string[];
    // Execute the next setup or assertion step for this scenario.
    status?: AttendanceIntervalStatus;
  },
// Execute the next setup or assertion step for this scenario.
) {
  // Bind breakMinutes for later setup or assertions in this scope.
  const breakMinutes = input.breakMinutes ?? 0;
  // Bind workedMinutes for later setup or assertions in this scope.
  const workedMinutes =
    // Execute the next setup or assertion step for this scenario.
    input.workedMinutes ??
    // Execute the next setup or assertion step for this scenario.
    Math.max(
      0,
      // Execute the next setup or assertion step for this scenario.
      Math.round(
        // Execute the next setup or assertion step for this scenario.
        (input.endedAt.getTime() - input.startedAt.getTime()) / 60_000,
      // Execute the next setup or assertion step for this scenario.
      ) - breakMinutes,
    );
  // Return the arranged value/result to the caller.
  return prisma.attendanceInterval.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      employeeId: input.employeeId,
      // Execute the next setup or assertion step for this scenario.
      hotelDate: input.hotelDate,
      // Execute the next setup or assertion step for this scenario.
      startedAt: input.startedAt,
      // Execute the next setup or assertion step for this scenario.
      endedAt: input.endedAt,
      // Execute the next setup or assertion step for this scenario.
      breakMinutes,
      // Execute the next setup or assertion step for this scenario.
      workedMinutes,
      // Fixture field status for the seeded actor/entity.
      status: input.status ?? AttendanceIntervalStatus.closed,
      // Execute the next setup or assertion step for this scenario.
      anomalyFlags: input.anomalyFlags ?? [],
    },
  });
}

// Export helper waitForBackendsBlockedByHolder for reuse across related tests.
export async function waitForBackendsBlockedByHolder(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  holderPid: number,
  // Execute the next setup or assertion step for this scenario.
  minCount: number,
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
      SELECT pid::int AS pid
      FROM pg_stat_activity
      WHERE wait_event_type = 'Lock'
        AND pid <> ${holderPid}
        AND datname = current_database()
        AND ${holderPid} = ANY (pg_blocking_pids(pid))
    `;
    // Bind pids for later setup or assertions in this scope.
    const pids = [...new Set(rows.map((r) => r.pid))];
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (pids.length >= minCount) return pids;
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise((r) => setTimeout(r, 25));
  }
  // Surface a hard failure when isolation or contract is violated.
  throw new Error(
    // Concurrency/isolation step for the race under test.
    `timed out waiting for >=${minCount} backends blocked by holder pid=${holderPid}`,
  );
}

/** Also accept waiters blocked indirectly (blocker chain includes holder). */
export async function waitForBackendsBlockedByHolderChain(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  holderPid: number,
  // Execute the next setup or assertion step for this scenario.
  minCount: number,
  // Execute the next setup or assertion step for this scenario.
  timeoutMs = 15_000,
// Execute the next setup or assertion step for this scenario.
): Promise<number[]> {
  // deadline: bound how long the wait/poll may run.
  const deadline = Date.now() + timeoutMs;
  // Repeat/poll to widen the race window or wait for lock waiters.
  while (Date.now() < deadline) {
    // rows: synchronize actors so the race window is observable.
    const rows = await prisma.$queryRaw<{ pid: number; blockers: number[] }[]>`
      SELECT pid::int AS pid, pg_blocking_pids(pid) AS blockers
      FROM pg_stat_activity
      WHERE wait_event_type = 'Lock'
        AND pid <> ${holderPid}
        AND datname = current_database()
    `;
    // Bind pids for later setup or assertions in this scope.
    const pids = rows
      // Continue the call chain for setup or assertion detail.
      .filter((r) => {
        // Bind chain for later setup or assertions in this scope.
        const chain = r.blockers ?? [];
        // Return the arranged value/result to the caller.
        return chain.includes(holderPid) || chain.some((b) =>
          // Concurrency/isolation step for the race under test.
          rows.some((o) => o.pid === b && (o.blockers ?? []).includes(holderPid)),
        );
      })
      // Continue the call chain for setup or assertion detail.
      .map((r) => r.pid);
    // Bind uniq for later setup or assertions in this scope.
    const uniq = [...new Set(pids)];
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (uniq.length >= minCount) return uniq;
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise((r) => setTimeout(r, 25));
  }
  // Surface a hard failure when isolation or contract is violated.
  throw new Error(
    // Concurrency/isolation step for the race under test.
    `timed out waiting (incl. lock chains) for >=${minCount} waiters; holder=${holderPid}`,
  );
}

