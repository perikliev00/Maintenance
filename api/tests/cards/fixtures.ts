/**
 * Access-card world for P1-79–P1-84 HTTP/DB suites.
 */
import type { PrismaClient } from "@prisma/client";
import {
  CardStatus,
  CardType,
  GrantKind,
  LocationKind,
  Role,
} from "@prisma/client";
import { randomUUID } from "crypto";
import { invalidateGrantCache } from "../../src/services/roleGrants";
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
  // Shape EmployeeUserFixture documents the fixture/response fields this suite touches.
  type EmployeeUserFixture,
} from "../fixtures";
// Shared test fixtures for seeding users, locations, and domain entities.
import { waitForBlockedByHolder } from "../sectors/fixtures";

// Export CARDS_PASSWORD for shared test/setup consumers.
export const CARDS_PASSWORD = "demo1234";

// Export CardsWorld for shared test/setup consumers.
export type CardsWorld = {
  stamp: string;
  password: string;
  propertyId: string;
  buildingId: string;
  floorId: string;
  roomId: string;
  commonAreaId: string;
  /** Staff holders for housekeeper / maintenance cards. */
  holderA: EmployeeUserFixture;
  holderB: EmployeeUserFixture;
  /** Issuer with cards.issue + cards.revoke (manager). */
  issuer: EmployeeUserFixture;
};

const ISSUER_ACTIONS = ["cards.issue", "cards.revoke", "cards.view"] as const;

// Export helper createCardsWorld for reuse across related tests.
export async function createCardsWorld(
  prisma: PrismaClient,
): Promise<CardsWorld> {
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const password = CARDS_PASSWORD;

  // holderA: seeded entity required before the mutation under test.
  const holderA = await createEmployeeWithUser(prisma, {
    employeeNumber: `CRD-HA-${stamp}`.slice(0, 32),
    email: `crd-ha-${stamp}@test.local`,
    role: Role.housekeeper,
    fullName: "CRD Holder A",
    password,
  });
  // holderB: seeded entity required before the mutation under test.
  const holderB = await createEmployeeWithUser(prisma, {
    employeeNumber: `CRD-HB-${stamp}`.slice(0, 32),
    email: `crd-hb-${stamp}@test.local`,
    role: Role.technician,
    fullName: "CRD Holder B",
    password,
  });
  // issuer: seeded entity required before the mutation under test.
  const issuer = await createEmployeeWithUser(prisma, {
    employeeNumber: `CRD-ISS-${stamp}`.slice(0, 32),
    email: `crd-iss-${stamp}@test.local`,
    role: Role.manager,
    fullName: "CRD Issuer",
    password,
  });

  for (const key of ISSUER_ACTIONS) {
    await prisma.roleGrant.upsert({
      where: {
        role_kind_key: {
          role: Role.manager,
          kind: GrantKind.action,
          key,
        },
      },
      create: { role: Role.manager, kind: GrantKind.action, key },
      update: {},
    });
  }
  invalidateGrantCache();

  // property: seeded entity required before the mutation under test.
  const property = await prisma.property.create({
    data: { name: `CRD Property ${stamp}` },
  });
  // building: seeded entity required before the mutation under test.
  const building = await prisma.building.create({
    data: {
      propertyId: property.id,
      name: "CRD Building",
      code: `CRDB-${stamp}`.slice(0, 32),
    },
  });
  // floor: seeded entity required before the mutation under test.
  const floor = await prisma.floor.create({
    data: { buildingId: building.id, number: 3, name: "CRD Floor" },
  });
  // room: seeded entity required before the mutation under test.
  const room = await prisma.location.create({
    data: {
      floorId: floor.id,
      number: `CRR-${stamp}`.slice(0, 24),
      kind: LocationKind.room,
    },
  });
  // common: seeded entity required before the mutation under test.
  const common = await prisma.location.create({
    data: {
      floorId: floor.id,
      number: `CRC-${stamp}`.slice(0, 24),
      kind: LocationKind.common_area,
    },
  });

  return {
    stamp,
    password,
    propertyId: property.id,
    buildingId: building.id,
    floorId: floor.id,
    roomId: room.id,
    commonAreaId: common.id,
    holderA,
    holderB,
    issuer,
  };
}

// Export helper cleanupCardsWorld for reuse across related tests.
export async function cleanupCardsWorld(
  prisma: PrismaClient,
  world: CardsWorld,
): Promise<void> {
  const empIds = [
    world.holderA.employeeId,
    world.holderB.employeeId,
    world.issuer.employeeId,
  ];
  const cards = await prisma.accessCard.findMany({
    where: {
      OR: [
        { employeeId: { in: empIds } },
        { issuedByEmployeeId: { in: empIds } },
      ],
    },
    select: { id: true },
  });
  const cardIds = cards.map((c) => c.id);
  if (cardIds.length) {
    await prisma.accessGrant.deleteMany({ where: { cardId: { in: cardIds } } });
    await prisma.auditEvent.deleteMany({
      where: {
        entityType: "card",
        entityId: { in: cardIds },
      },
    });
    await prisma.accessCard.deleteMany({ where: { id: { in: cardIds } } });
  }
  await prisma.location.deleteMany({
    where: { id: { in: [world.roomId, world.commonAreaId] } },
  });
  await prisma.floor.deleteMany({ where: { id: world.floorId } });
  await prisma.building.deleteMany({ where: { id: world.buildingId } });
  await prisma.property.deleteMany({ where: { id: world.propertyId } });
  await cleanupEmployeeGraph(prisma, empIds);
}

/** Default validity window for issue payloads (until after from). */
export function defaultValidity(offsetMs = 0): {
  validFrom: string;
  validUntil: string;
} {
  const from = new Date("2026-06-01T10:00:00.000Z");
  from.setTime(from.getTime() + offsetMs);
  const until = new Date(from.getTime() + 60 * 60 * 1000);
  return {
    validFrom: from.toISOString(),
    validUntil: until.toISOString(),
  };
}

// Export IssueBody for shared test/setup consumers.
export type IssueBody = {
  cardType: string;
  employeeId?: string | null;
  locationId?: string | null;
  validFrom: string;
  validUntil: string;
  label?: string | null;
  commandId: string;
};

// Export helper guestIssueBody for reuse across related tests.
export function guestIssueBody(
  world: CardsWorld,
  overrides: Partial<IssueBody> = {},
): IssueBody {
  const v = defaultValidity();
  return {
    cardType: CardType.guest,
    employeeId: null,
    locationId: world.roomId,
    validFrom: v.validFrom,
    validUntil: v.validUntil,
    label: `guest-${world.stamp}`,
    commandId: randomUUID(),
    ...overrides,
  };
}

// Export helper staffIssueBody for reuse across related tests.
export function staffIssueBody(
  world: CardsWorld,
  overrides: Partial<IssueBody> = {},
): IssueBody {
  const v = defaultValidity();
  return {
    cardType: CardType.housekeeper,
    employeeId: world.holderA.employeeId,
    locationId: world.roomId,
    validFrom: v.validFrom,
    validUntil: v.validUntil,
    label: `staff-${world.stamp}`,
    commandId: randomUUID(),
    ...overrides,
  };
}

// Export helper masterIssueBody for reuse across related tests.
export function masterIssueBody(
  world: CardsWorld,
  overrides: Partial<IssueBody> = {},
): IssueBody {
  const v = defaultValidity();
  return {
    cardType: CardType.master,
    employeeId: world.holderA.employeeId,
    locationId: null,
    validFrom: v.validFrom,
    validUntil: v.validUntil,
    label: `master-${world.stamp}`,
    commandId: randomUUID(),
    ...overrides,
  };
}

/** Direct DB control card that revoke suites must leave active. */
export async function createControlCard(
  prisma: PrismaClient,
  world: CardsWorld,
  opts?: { label?: string },
) {
  const v = defaultValidity(3_600_000);
  return prisma.accessCard.create({
    data: {
      cardType: CardType.maintenance,
      status: CardStatus.active,
      label: opts?.label ?? `control-${world.stamp}`,
      employeeId: world.holderB.employeeId,
      issuedByEmployeeId: world.issuer.employeeId,
      commandId: randomUUID(),
      grants: {
        create: {
          locationId: world.roomId,
          validFrom: new Date(v.validFrom),
          validUntil: new Date(v.validUntil),
          issuedByEmployeeId: world.issuer.employeeId,
        },
      },
    },
  });
}

// Export helper createActiveStaffCard for reuse across related tests.
export async function createActiveStaffCard(
  prisma: PrismaClient,
  world: CardsWorld,
  opts?: { employeeId?: string; label?: string },
) {
  const v = defaultValidity();
  return prisma.accessCard.create({
    data: {
      cardType: CardType.housekeeper,
      status: CardStatus.active,
      label: opts?.label ?? `target-${world.stamp}`,
      employeeId: opts?.employeeId ?? world.holderA.employeeId,
      issuedByEmployeeId: world.issuer.employeeId,
      commandId: randomUUID(),
      grants: {
        create: {
          locationId: world.roomId,
          validFrom: new Date(v.validFrom),
          validUntil: new Date(v.validUntil),
          issuedByEmployeeId: world.issuer.employeeId,
        },
      },
    },
  });
}

// Export helper countCardsByCommand for reuse across related tests.
export async function countCardsByCommand(
  prisma: PrismaClient,
  commandId: string,
) {
  return prisma.accessCard.count({ where: { commandId } });
}

// Export helper countGrantsForCommand for reuse across related tests.
export async function countGrantsForCommand(
  prisma: PrismaClient,
  commandId: string,
) {
  return prisma.accessGrant.count({
    where: { card: { commandId } },
  });
}

// Export helper countCardAudits for reuse across related tests.
export async function countCardAudits(
  prisma: PrismaClient,
  action: "card.issue" | "card.revoke",
  entityIds: string[],
) {
  if (!entityIds.length) return 0;
  return prisma.auditEvent.count({
    where: {
      action,
      entityType: "card",
      entityId: { in: entityIds },
    },
  });
}

// Export helper worldCardSnapshot for reuse across related tests.
export async function worldCardSnapshot(
  prisma: PrismaClient,
  world: CardsWorld,
) {
  const empIds = [
    world.holderA.employeeId,
    world.holderB.employeeId,
    world.issuer.employeeId,
  ];
  const cards = await prisma.accessCard.findMany({
    where: {
      OR: [
        { employeeId: { in: empIds } },
        { issuedByEmployeeId: { in: empIds } },
      ],
    },
    select: { id: true, commandId: true, status: true },
    orderBy: { id: "asc" },
  });
  const cardIds = cards.map((c) => c.id);
  const grants = cardIds.length
    ? await prisma.accessGrant.count({ where: { cardId: { in: cardIds } } })
    : 0;
  const audits = cardIds.length
    ? await prisma.auditEvent.count({
        where: { entityType: "card", entityId: { in: cardIds } },
      })
    : 0;
  return {
    cardCount: cards.length,
    grantCount: grants,
    auditCount: audits,
    cards,
  };
}

/**
 * Hold AccessCard in SHARE ROW EXCLUSIVE so concurrent INSERTs block.
 * Proves both HTTP waiters are Lock-blocked before release.
 */
export async function runWhileAccessCardTableLocked<T>(opts: {
  prisma: PrismaClient;
  startRace: () => Promise<T>;
  minWaiters?: number;
  timeoutMs?: number;
}): Promise<T> {
  // minWaiters: repetition count to amplify race windows.
  const minWaiters = opts.minWaiters ?? 2;
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
        LOCK TABLE "AccessCard" IN SHARE ROW EXCLUSIVE MODE
      `;
      lockHeld = true;
      await gate;
    },
    { timeout: 60_000, maxWait: 60_000 },
  );

  try {
    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let i = 0; i < 100 && !lockHeld; i += 1) {
      // Brief yield so lock waiters/UI can settle before asserting.
      await new Promise((r) => setTimeout(r, 20));
    }
    if (!lockHeld || holderPid == null) {
      // Surface a hard failure when isolation or contract is violated.
      throw new Error("expected holder to acquire AccessCard table lock");
    }

    const raceP = opts.startRace();
    const blocked = await waitForBlockedByHolder(
      opts.prisma,
      holderPid,
      minWaiters,
      timeoutMs,
    );
    if (blocked.length < minWaiters) {
      // Surface a hard failure when isolation or contract is violated.
      throw new Error(
        `expected >=${minWaiters} Lock waiters, got ${blocked.length}`,
      );
    }
    release();
    await holder;
    return raceP;
  } catch (err) {
    release();
    await holder.catch(() => undefined);
    // Surface a hard failure when isolation or contract is violated.
    throw err;
  }
}

// Re-export selected symbols for suite consumers.
export { waitForBlockedByHolder };