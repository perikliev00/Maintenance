/**
 * Shared world for attendance P1-69-78 HTTP/DB suites.
 */
import type { PrismaClient } from "@prisma/client";
import {
  AttendanceIntervalStatus,
  GrantKind,
  LocationKind,
  Role,
} from "@prisma/client";
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
  ensureUnrelatedControlFixture,
  type EmployeeUserFixture,
} from "../fixtures";
import { invalidateGrantCache } from "../../src/services/roleGrants";

export const ATT_PASSWORD = "demo1234";

export type AttendanceWorld = {
  stamp: string;
  password: string;
  propertyId: string;
  roomId: string;
  commonAreaId: string;
  housekeeper: EmployeeUserFixture;
  technician: EmployeeUserFixture;
  otherHk: EmployeeUserFixture;
  supervisor: EmployeeUserFixture;
  manager: EmployeeUserFixture;
  owner: EmployeeUserFixture;
  control: EmployeeUserFixture;
  grantRoles: Role[];
};

const GRANT_ROLES: Role[] = [
  Role.housekeeper,
  Role.technician,
  Role.supervisor,
  Role.manager,
];

export async function createAttendanceWorld(
  prisma: PrismaClient,
): Promise<AttendanceWorld> {
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const password = ATT_PASSWORD;
  const control = await ensureUnrelatedControlFixture(prisma);

  const housekeeper = await createEmployeeWithUser(prisma, {
    employeeNumber: `ATT-HK-${stamp}`.slice(0, 32),
    email: `att-hk-${stamp}@test.local`,
    role: Role.housekeeper,
    fullName: "ATT Housekeeper",
    password,
  });
  const technician = await createEmployeeWithUser(prisma, {
    employeeNumber: `ATT-TECH-${stamp}`.slice(0, 32),
    email: `att-tech-${stamp}@test.local`,
    role: Role.technician,
    fullName: "ATT Technician",
    password,
  });
  const otherHk = await createEmployeeWithUser(prisma, {
    employeeNumber: `ATT-HK2-${stamp}`.slice(0, 32),
    email: `att-hk2-${stamp}@test.local`,
    role: Role.housekeeper,
    fullName: "ATT Other HK",
    password,
  });
  const supervisor = await createEmployeeWithUser(prisma, {
    employeeNumber: `ATT-SUP-${stamp}`.slice(0, 32),
    email: `att-sup-${stamp}@test.local`,
    role: Role.supervisor,
    fullName: "ATT Supervisor",
    password,
  });
  const manager = await createEmployeeWithUser(prisma, {
    employeeNumber: `ATT-MGR-${stamp}`.slice(0, 32),
    email: `att-mgr-${stamp}@test.local`,
    role: Role.manager,
    fullName: "ATT Manager",
    password,
  });
  const owner = await createEmployeeWithUser(prisma, {
    employeeNumber: `ATT-OWN-${stamp}`.slice(0, 32),
    email: `att-own-${stamp}@test.local`,
    role: Role.owner,
    fullName: "ATT Owner",
    password,
  });

  const property = await prisma.property.create({
    data: { name: `ATT Property ${stamp}` },
  });
  const building = await prisma.building.create({
    data: {
      propertyId: property.id,
      name: "ATT Building",
      code: `ATTB-${stamp}`.slice(0, 32),
    },
  });
  const floor = await prisma.floor.create({
    data: { buildingId: building.id, number: 1, name: "ATT Floor" },
  });
  const room = await prisma.location.create({
    data: {
      floorId: floor.id,
      number: `ATR-${stamp}`.slice(0, 24),
      kind: LocationKind.room,
    },
  });
  const common = await prisma.location.create({
    data: {
      floorId: floor.id,
      number: `ATC-${stamp}`.slice(0, 24),
      kind: LocationKind.common_area,
    },
  });

  return {
    stamp,
    password,
    propertyId: property.id,
    roomId: room.id,
    commonAreaId: common.id,
    housekeeper,
    technician,
    otherHk,
    supervisor,
    manager,
    owner,
    control,
    grantRoles: [...GRANT_ROLES],
  };
}

export async function cleanupAttendanceWorld(
  prisma: PrismaClient,
  world: AttendanceWorld,
): Promise<void> {
  const empIds = [
    world.housekeeper.employeeId,
    world.technician.employeeId,
    world.otherHk.employeeId,
    world.supervisor.employeeId,
    world.manager.employeeId,
    world.owner.employeeId,
  ];
  await prisma.attendanceAdjustment.deleteMany({
    where: { interval: { employeeId: { in: empIds } } },
  });
  await prisma.attendanceInterval.deleteMany({
    where: { employeeId: { in: empIds } },
  });
  await prisma.attendanceEvent.deleteMany({
    where: { employeeId: { in: empIds } },
  });
  await prisma.location.deleteMany({
    where: { id: { in: [world.roomId, world.commonAreaId] } },
  });
  const floors = await prisma.floor.findMany({
    where: { building: { propertyId: world.propertyId } },
    select: { id: true },
  });
  await prisma.floor.deleteMany({
    where: { id: { in: floors.map((f) => f.id) } },
  });
  await prisma.building.deleteMany({ where: { propertyId: world.propertyId } });
  await prisma.property.deleteMany({ where: { id: world.propertyId } });
  await cleanupEmployeeGraph(prisma, empIds);
}

/** Ensure role has action grant; returns disposer that restores prior rows for that role+key. */
export async function ensureActionGrant(
  prisma: PrismaClient,
  role: Role,
  key: string,
): Promise<() => Promise<void>> {
  const existing = await prisma.roleGrant.findUnique({
    where: { role_kind_key: { role, kind: GrantKind.action, key } },
  });
  if (!existing) {
    await prisma.roleGrant.create({
      data: { role, kind: GrantKind.action, key },
    });
    invalidateGrantCache();
  }
  return async () => {
    if (!existing) {
      await prisma.roleGrant.deleteMany({
        where: { role, kind: GrantKind.action, key },
      });
      invalidateGrantCache();
    }
  };
}

export async function removeActionGrant(
  prisma: PrismaClient,
  role: Role,
  key: string,
): Promise<() => Promise<void>> {
  const existing = await prisma.roleGrant.findUnique({
    where: { role_kind_key: { role, kind: GrantKind.action, key } },
  });
  if (existing) {
    await prisma.roleGrant.delete({
      where: { role_kind_key: { role, kind: GrantKind.action, key } },
    });
    invalidateGrantCache();
  }
  return async () => {
    if (existing) {
      await prisma.roleGrant.create({
        data: { role, kind: GrantKind.action, key },
      });
      invalidateGrantCache();
    }
  };
}

export async function createClosedInterval(
  prisma: PrismaClient,
  input: {
    employeeId: string;
    hotelDate: Date;
    startedAt: Date;
    endedAt: Date;
    breakMinutes?: number;
    workedMinutes?: number;
    anomalyFlags?: string[];
    status?: AttendanceIntervalStatus;
  },
) {
  const breakMinutes = input.breakMinutes ?? 0;
  const workedMinutes =
    input.workedMinutes ??
    Math.max(
      0,
      Math.round(
        (input.endedAt.getTime() - input.startedAt.getTime()) / 60_000,
      ) - breakMinutes,
    );
  return prisma.attendanceInterval.create({
    data: {
      employeeId: input.employeeId,
      hotelDate: input.hotelDate,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      breakMinutes,
      workedMinutes,
      status: input.status ?? AttendanceIntervalStatus.closed,
      anomalyFlags: input.anomalyFlags ?? [],
    },
  });
}

export async function waitForBackendsBlockedByHolder(
  prisma: PrismaClient,
  holderPid: number,
  minCount: number,
  timeoutMs = 15_000,
): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<{ pid: number }[]>`
      SELECT pid::int AS pid
      FROM pg_stat_activity
      WHERE wait_event_type = 'Lock'
        AND pid <> ${holderPid}
        AND datname = current_database()
        AND ${holderPid} = ANY (pg_blocking_pids(pid))
    `;
    const pids = [...new Set(rows.map((r) => r.pid))];
    if (pids.length >= minCount) return pids;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(
    `timed out waiting for >=${minCount} backends blocked by holder pid=${holderPid}`,
  );
}

/** Also accept waiters blocked indirectly (blocker chain includes holder). */
export async function waitForBackendsBlockedByHolderChain(
  prisma: PrismaClient,
  holderPid: number,
  minCount: number,
  timeoutMs = 15_000,
): Promise<number[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<{ pid: number; blockers: number[] }[]>`
      SELECT pid::int AS pid, pg_blocking_pids(pid) AS blockers
      FROM pg_stat_activity
      WHERE wait_event_type = 'Lock'
        AND pid <> ${holderPid}
        AND datname = current_database()
    `;
    const pids = rows
      .filter((r) => {
        const chain = r.blockers ?? [];
        return chain.includes(holderPid) || chain.some((b) =>
          rows.some((o) => o.pid === b && (o.blockers ?? []).includes(holderPid)),
        );
      })
      .map((r) => r.pid);
    const uniq = [...new Set(pids)];
    if (uniq.length >= minCount) return uniq;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(
    `timed out waiting (incl. lock chains) for >=${minCount} waiters; holder=${holderPid}`,
  );
}

