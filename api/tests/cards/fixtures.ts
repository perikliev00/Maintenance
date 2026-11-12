/**
 * Access-card world for P1-79–P1-84 HTTP/DB suites.
 */
import type { PrismaClient } from "@prisma/client";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  CardStatus,
  // Execute the next setup or assertion step for this scenario.
  CardType,
  // Execute the next setup or assertion step for this scenario.
  GrantKind,
  // Execute the next setup or assertion step for this scenario.
  LocationKind,
  // Execute the next setup or assertion step for this scenario.
  Role,
// Execute the next setup or assertion step for this scenario.
} from "@prisma/client";
// Import bindings from crypto.
import { randomUUID } from "crypto";
// Import bindings from ../../src/services/roleGrants.
import { invalidateGrantCache } from "../../src/services/roleGrants";
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
// Shared test fixtures for seeding users, locations, and domain entities.
import { waitForBlockedByHolder } from "../sectors/fixtures";

// Export CARDS_PASSWORD for shared test/setup consumers.
export const CARDS_PASSWORD = "demo1234";

// Export CardsWorld for shared test/setup consumers.
export type CardsWorld = {
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
  // Execute the next setup or assertion step for this scenario.
  roomId: string;
  // Execute the next setup or assertion step for this scenario.
  commonAreaId: string;
  /** Staff holders for housekeeper / maintenance cards. */
  holderA: EmployeeUserFixture;
  // Execute the next setup or assertion step for this scenario.
  holderB: EmployeeUserFixture;
  /** Issuer with cards.issue + cards.revoke (manager). */
  issuer: EmployeeUserFixture;
};

// Bind ISSUER_ACTIONS for later setup or assertions in this scope.
const ISSUER_ACTIONS = ["cards.issue", "cards.revoke", "cards.view"] as const;

// Export helper createCardsWorld for reuse across related tests.
export async function createCardsWorld(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
// Execute the next setup or assertion step for this scenario.
): Promise<CardsWorld> {
  // stamp: unique stamp so parallel runs do not collide.
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // password: credential/token material for auth flows.
  const password = CARDS_PASSWORD;

  // holderA: seeded entity required before the mutation under test.
  const holderA = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `CRD-HA-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `crd-ha-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.housekeeper,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "CRD Holder A",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // holderB: seeded entity required before the mutation under test.
  const holderB = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `CRD-HB-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `crd-hb-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.technician,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "CRD Holder B",
    // Execute the next setup or assertion step for this scenario.
    password,
  });
  // issuer: seeded entity required before the mutation under test.
  const issuer = await createEmployeeWithUser(prisma, {
    // Fixture field employeeNumber for the seeded actor/entity.
    employeeNumber: `CRD-ISS-${stamp}`.slice(0, 32),
    // Fixture field email for the seeded actor/entity.
    email: `crd-iss-${stamp}@test.local`,
    // Fixture field role for the seeded actor/entity.
    role: Role.manager,
    // Fixture field fullName for the seeded actor/entity.
    fullName: "CRD Issuer",
    // Execute the next setup or assertion step for this scenario.
    password,
  });

  // Iterate to cover variants or wait until a condition holds.
  for (const key of ISSUER_ACTIONS) {
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await prisma.roleGrant.upsert({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        role_kind_key: {
          // Fixture field role for the seeded actor/entity.
          role: Role.manager,
          // Execute the next setup or assertion step for this scenario.
          kind: GrantKind.action,
          // Execute the next setup or assertion step for this scenario.
          key,
        },
      },
      // Execute the next setup or assertion step for this scenario.
      create: { role: Role.manager, kind: GrantKind.action, key },
      // SQL fragment used to observe locks or assert DB state.
      update: {},
    });
  }
  // Execute the next setup or assertion step for this scenario.
  invalidateGrantCache();

  // property: seeded entity required before the mutation under test.
  const property = await prisma.property.create({
    // Execute the next setup or assertion step for this scenario.
    data: { name: `CRD Property ${stamp}` },
  });
  // building: seeded entity required before the mutation under test.
  const building = await prisma.building.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      propertyId: property.id,
      // Fixture field name for the seeded actor/entity.
      name: "CRD Building",
      // Execute the next setup or assertion step for this scenario.
      code: `CRDB-${stamp}`.slice(0, 32),
    },
  });
  // floor: seeded entity required before the mutation under test.
  const floor = await prisma.floor.create({
    // Execute the next setup or assertion step for this scenario.
    data: { buildingId: building.id, number: 3, name: "CRD Floor" },
  });
  // room: seeded entity required before the mutation under test.
  const room = await prisma.location.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      floorId: floor.id,
      // Execute the next setup or assertion step for this scenario.
      number: `CRR-${stamp}`.slice(0, 24),
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
      number: `CRC-${stamp}`.slice(0, 24),
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
    buildingId: building.id,
    // Execute the next setup or assertion step for this scenario.
    floorId: floor.id,
    // Execute the next setup or assertion step for this scenario.
    roomId: room.id,
    // Execute the next setup or assertion step for this scenario.
    commonAreaId: common.id,
    // Execute the next setup or assertion step for this scenario.
    holderA,
    // Execute the next setup or assertion step for this scenario.
    holderB,
    // Execute the next setup or assertion step for this scenario.
    issuer,
  };
}

// Export helper cleanupCardsWorld for reuse across related tests.
export async function cleanupCardsWorld(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  world: CardsWorld,
// Execute the next setup or assertion step for this scenario.
): Promise<void> {
  // Bind empIds for later setup or assertions in this scope.
  const empIds = [
    // Execute the next setup or assertion step for this scenario.
    world.holderA.employeeId,
    // Execute the next setup or assertion step for this scenario.
    world.holderB.employeeId,
    // Execute the next setup or assertion step for this scenario.
    world.issuer.employeeId,
  ];
  // cards: synchronize actors so the race window is observable.
  const cards = await prisma.accessCard.findMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // SQL fragment used to observe locks or assert DB state.
      OR: [
        // Execute the next setup or assertion step for this scenario.
        { employeeId: { in: empIds } },
        // Execute the next setup or assertion step for this scenario.
        { issuedByEmployeeId: { in: empIds } },
      ],
    },
    // SQL fragment used to observe locks or assert DB state.
    select: { id: true },
  });
  // Bind cardIds for later setup or assertions in this scope.
  const cardIds = cards.map((c) => c.id);
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (cardIds.length) {
    // Await async work before asserting or releasing locks.
    await prisma.accessGrant.deleteMany({ where: { cardId: { in: cardIds } } });
    // Await async work before asserting or releasing locks.
    await prisma.auditEvent.deleteMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        entityType: "card",
        // Execute the next setup or assertion step for this scenario.
        entityId: { in: cardIds },
      },
    });
    // Await async work before asserting or releasing locks.
    await prisma.accessCard.deleteMany({ where: { id: { in: cardIds } } });
  }
  // Await async work before asserting or releasing locks.
  await prisma.location.deleteMany({
    // SQL fragment used to observe locks or assert DB state.
    where: { id: { in: [world.roomId, world.commonAreaId] } },
  });
  // Await async work before asserting or releasing locks.
  await prisma.floor.deleteMany({ where: { id: world.floorId } });
  // Await async work before asserting or releasing locks.
  await prisma.building.deleteMany({ where: { id: world.buildingId } });
  // Await async work before asserting or releasing locks.
  await prisma.property.deleteMany({ where: { id: world.propertyId } });
  // Await async work before asserting or releasing locks.
  await cleanupEmployeeGraph(prisma, empIds);
}

/** Default validity window for issue payloads (until after from). */
export function defaultValidity(offsetMs = 0): {
  // Execute the next setup or assertion step for this scenario.
  validFrom: string;
  // Execute the next setup or assertion step for this scenario.
  validUntil: string;
// Execute the next setup or assertion step for this scenario.
} {
  // Bind from for later setup or assertions in this scope.
  const from = new Date("2026-06-01T10:00:00.000Z");
  // SQL fragment used to observe locks or assert DB state.
  from.setTime(from.getTime() + offsetMs);
  // Bind until for later setup or assertions in this scope.
  const until = new Date(from.getTime() + 60 * 60 * 1000);
  // Return the arranged value/result to the caller.
  return {
    // Execute the next setup or assertion step for this scenario.
    validFrom: from.toISOString(),
    // Execute the next setup or assertion step for this scenario.
    validUntil: until.toISOString(),
  };
}

// Export IssueBody for shared test/setup consumers.
export type IssueBody = {
  // Execute the next setup or assertion step for this scenario.
  cardType: string;
  // Execute the next setup or assertion step for this scenario.
  employeeId?: string | null;
  // Execute the next setup or assertion step for this scenario.
  locationId?: string | null;
  // Execute the next setup or assertion step for this scenario.
  validFrom: string;
  // Execute the next setup or assertion step for this scenario.
  validUntil: string;
  // Execute the next setup or assertion step for this scenario.
  label?: string | null;
  // Execute the next setup or assertion step for this scenario.
  commandId: string;
};

// Export helper guestIssueBody for reuse across related tests.
export function guestIssueBody(
  // Execute the next setup or assertion step for this scenario.
  world: CardsWorld,
  // Execute the next setup or assertion step for this scenario.
  overrides: Partial<IssueBody> = {},
// Execute the next setup or assertion step for this scenario.
): IssueBody {
  // Bind v for later setup or assertions in this scope.
  const v = defaultValidity();
  // Return the arranged value/result to the caller.
  return {
    // Execute the next setup or assertion step for this scenario.
    cardType: CardType.guest,
    // Execute the next setup or assertion step for this scenario.
    employeeId: null,
    // Execute the next setup or assertion step for this scenario.
    locationId: world.roomId,
    // Execute the next setup or assertion step for this scenario.
    validFrom: v.validFrom,
    // Execute the next setup or assertion step for this scenario.
    validUntil: v.validUntil,
    // Execute the next setup or assertion step for this scenario.
    label: `guest-${world.stamp}`,
    // Execute the next setup or assertion step for this scenario.
    commandId: randomUUID(),
    // Continue the call chain for setup or assertion detail.
    ...overrides,
  };
}

// Export helper staffIssueBody for reuse across related tests.
export function staffIssueBody(
  // Execute the next setup or assertion step for this scenario.
  world: CardsWorld,
  // Execute the next setup or assertion step for this scenario.
  overrides: Partial<IssueBody> = {},
// Execute the next setup or assertion step for this scenario.
): IssueBody {
  // Bind v for later setup or assertions in this scope.
  const v = defaultValidity();
  // Return the arranged value/result to the caller.
  return {
    // Execute the next setup or assertion step for this scenario.
    cardType: CardType.housekeeper,
    // Execute the next setup or assertion step for this scenario.
    employeeId: world.holderA.employeeId,
    // Execute the next setup or assertion step for this scenario.
    locationId: world.roomId,
    // Execute the next setup or assertion step for this scenario.
    validFrom: v.validFrom,
    // Execute the next setup or assertion step for this scenario.
    validUntil: v.validUntil,
    // Execute the next setup or assertion step for this scenario.
    label: `staff-${world.stamp}`,
    // Execute the next setup or assertion step for this scenario.
    commandId: randomUUID(),
    // Continue the call chain for setup or assertion detail.
    ...overrides,
  };
}

// Export helper masterIssueBody for reuse across related tests.
export function masterIssueBody(
  // Execute the next setup or assertion step for this scenario.
  world: CardsWorld,
  // Execute the next setup or assertion step for this scenario.
  overrides: Partial<IssueBody> = {},
// Execute the next setup or assertion step for this scenario.
): IssueBody {
  // Bind v for later setup or assertions in this scope.
  const v = defaultValidity();
  // Return the arranged value/result to the caller.
  return {
    // Execute the next setup or assertion step for this scenario.
    cardType: CardType.master,
    // Execute the next setup or assertion step for this scenario.
    employeeId: world.holderA.employeeId,
    // Execute the next setup or assertion step for this scenario.
    locationId: null,
    // Execute the next setup or assertion step for this scenario.
    validFrom: v.validFrom,
    // Execute the next setup or assertion step for this scenario.
    validUntil: v.validUntil,
    // Execute the next setup or assertion step for this scenario.
    label: `master-${world.stamp}`,
    // Execute the next setup or assertion step for this scenario.
    commandId: randomUUID(),
    // Continue the call chain for setup or assertion detail.
    ...overrides,
  };
}

/** Direct DB control card that revoke suites must leave active. */
export async function createControlCard(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  world: CardsWorld,
  // Execute the next setup or assertion step for this scenario.
  opts?: { label?: string },
// Execute the next setup or assertion step for this scenario.
) {
  // Bind v for later setup or assertions in this scope.
  const v = defaultValidity(3_600_000);
  // Return the arranged value/result to the caller.
  return prisma.accessCard.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      cardType: CardType.maintenance,
      // Fixture field status for the seeded actor/entity.
      status: CardStatus.active,
      // Execute the next setup or assertion step for this scenario.
      label: opts?.label ?? `control-${world.stamp}`,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.holderB.employeeId,
      // Execute the next setup or assertion step for this scenario.
      issuedByEmployeeId: world.issuer.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      grants: {
        // Execute the next setup or assertion step for this scenario.
        create: {
          // Execute the next setup or assertion step for this scenario.
          locationId: world.roomId,
          // Execute the next setup or assertion step for this scenario.
          validFrom: new Date(v.validFrom),
          // Execute the next setup or assertion step for this scenario.
          validUntil: new Date(v.validUntil),
          // Execute the next setup or assertion step for this scenario.
          issuedByEmployeeId: world.issuer.employeeId,
        },
      },
    },
  });
}

// Export helper createActiveStaffCard for reuse across related tests.
export async function createActiveStaffCard(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  world: CardsWorld,
  // Execute the next setup or assertion step for this scenario.
  opts?: { employeeId?: string; label?: string },
// Execute the next setup or assertion step for this scenario.
) {
  // Bind v for later setup or assertions in this scope.
  const v = defaultValidity();
  // Return the arranged value/result to the caller.
  return prisma.accessCard.create({
    // Execute the next setup or assertion step for this scenario.
    data: {
      // Execute the next setup or assertion step for this scenario.
      cardType: CardType.housekeeper,
      // Fixture field status for the seeded actor/entity.
      status: CardStatus.active,
      // Execute the next setup or assertion step for this scenario.
      label: opts?.label ?? `target-${world.stamp}`,
      // Execute the next setup or assertion step for this scenario.
      employeeId: opts?.employeeId ?? world.holderA.employeeId,
      // Execute the next setup or assertion step for this scenario.
      issuedByEmployeeId: world.issuer.employeeId,
      // Execute the next setup or assertion step for this scenario.
      commandId: randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      grants: {
        // Execute the next setup or assertion step for this scenario.
        create: {
          // Execute the next setup or assertion step for this scenario.
          locationId: world.roomId,
          // Execute the next setup or assertion step for this scenario.
          validFrom: new Date(v.validFrom),
          // Execute the next setup or assertion step for this scenario.
          validUntil: new Date(v.validUntil),
          // Execute the next setup or assertion step for this scenario.
          issuedByEmployeeId: world.issuer.employeeId,
        },
      },
    },
  });
}

// Export helper countCardsByCommand for reuse across related tests.
export async function countCardsByCommand(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  commandId: string,
// Execute the next setup or assertion step for this scenario.
) {
  // Return the arranged value/result to the caller.
  return prisma.accessCard.count({ where: { commandId } });
}

// Export helper countGrantsForCommand for reuse across related tests.
export async function countGrantsForCommand(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  commandId: string,
// Execute the next setup or assertion step for this scenario.
) {
  // Return the arranged value/result to the caller.
  return prisma.accessGrant.count({
    // SQL fragment used to observe locks or assert DB state.
    where: { card: { commandId } },
  });
}

// Export helper countCardAudits for reuse across related tests.
export async function countCardAudits(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  action: "card.issue" | "card.revoke",
  // Execute the next setup or assertion step for this scenario.
  entityIds: string[],
// Execute the next setup or assertion step for this scenario.
) {
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (!entityIds.length) return 0;
  // Return the arranged value/result to the caller.
  return prisma.auditEvent.count({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // Execute the next setup or assertion step for this scenario.
      action,
      // Execute the next setup or assertion step for this scenario.
      entityType: "card",
      // Execute the next setup or assertion step for this scenario.
      entityId: { in: entityIds },
    },
  });
}

// Export helper worldCardSnapshot for reuse across related tests.
export async function worldCardSnapshot(
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  world: CardsWorld,
// Execute the next setup or assertion step for this scenario.
) {
  // Bind empIds for later setup or assertions in this scope.
  const empIds = [
    // Execute the next setup or assertion step for this scenario.
    world.holderA.employeeId,
    // Execute the next setup or assertion step for this scenario.
    world.holderB.employeeId,
    // Execute the next setup or assertion step for this scenario.
    world.issuer.employeeId,
  ];
  // cards: synchronize actors so the race window is observable.
  const cards = await prisma.accessCard.findMany({
    // SQL fragment used to observe locks or assert DB state.
    where: {
      // SQL fragment used to observe locks or assert DB state.
      OR: [
        // Execute the next setup or assertion step for this scenario.
        { employeeId: { in: empIds } },
        // Execute the next setup or assertion step for this scenario.
        { issuedByEmployeeId: { in: empIds } },
      ],
    },
    // SQL fragment used to observe locks or assert DB state.
    select: { id: true, commandId: true, status: true },
    // Execute the next setup or assertion step for this scenario.
    orderBy: { id: "asc" },
  });
  // Bind cardIds for later setup or assertions in this scope.
  const cardIds = cards.map((c) => c.id);
  // Bind grants for later setup or assertions in this scope.
  const grants = cardIds.length
    // Await async work before asserting or releasing locks.
    ? await prisma.accessGrant.count({ where: { cardId: { in: cardIds } } })
    : 0;
  // Bind audits for later setup or assertions in this scope.
  const audits = cardIds.length
    // Await async work before asserting or releasing locks.
    ? await prisma.auditEvent.count({
        // SQL fragment used to observe locks or assert DB state.
        where: { entityType: "card", entityId: { in: cardIds } },
      })
    : 0;
  // Return the arranged value/result to the caller.
  return {
    // Execute the next setup or assertion step for this scenario.
    cardCount: cards.length,
    // Execute the next setup or assertion step for this scenario.
    grantCount: grants,
    // Execute the next setup or assertion step for this scenario.
    auditCount: audits,
    // Execute the next setup or assertion step for this scenario.
    cards,
  };
}

/**
 * Hold AccessCard in SHARE ROW EXCLUSIVE so concurrent INSERTs block.
 * Proves both HTTP waiters are Lock-blocked before release.
 */
export async function runWhileAccessCardTableLocked<T>(opts: {
  // Execute the next setup or assertion step for this scenario.
  prisma: PrismaClient;
  // Concurrency/isolation step for the race under test.
  startRace: () => Promise<T>;
  // Execute the next setup or assertion step for this scenario.
  minWaiters?: number;
  // Execute the next setup or assertion step for this scenario.
  timeoutMs?: number;
// Execute the next setup or assertion step for this scenario.
}): Promise<T> {
  // minWaiters: repetition count to amplify race windows.
  const minWaiters = opts.minWaiters ?? 2;
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
        LOCK TABLE "AccessCard" IN SHARE ROW EXCLUSIVE MODE
      `;
      // Concurrency/isolation step for the race under test.
      lockHeld = true;
      // Await async work before asserting or releasing locks.
      await gate;
    },
    // Runner option controlling stability or isolation of the suite.
    { timeout: 60_000, maxWait: 60_000 },
  );

  // Try path where partial failure must not leak suite state.
  try {
    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let i = 0; i < 100 && !lockHeld; i += 1) {
      // Brief yield so lock waiters/UI can settle before asserting.
      await new Promise((r) => setTimeout(r, 20));
    }
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (!lockHeld || holderPid == null) {
      // Surface a hard failure when isolation or contract is violated.
      throw new Error("expected holder to acquire AccessCard table lock");
    }

    // Bind raceP for later setup or assertions in this scope.
    const raceP = opts.startRace();
    // blocked: synchronize actors so the race window is observable.
    const blocked = await waitForBlockedByHolder(
      // Execute the next setup or assertion step for this scenario.
      opts.prisma,
      // Execute the next setup or assertion step for this scenario.
      holderPid,
      // Execute the next setup or assertion step for this scenario.
      minWaiters,
      // Execute the next setup or assertion step for this scenario.
      timeoutMs,
    );
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (blocked.length < minWaiters) {
      // Surface a hard failure when isolation or contract is violated.
      throw new Error(
        // Concurrency/isolation step for the race under test.
        `expected >=${minWaiters} Lock waiters, got ${blocked.length}`,
      );
    }
    // Execute the next setup or assertion step for this scenario.
    release();
    // Await async work before asserting or releasing locks.
    await holder;
    // Return the arranged value/result to the caller.
    return raceP;
  // Execute the next setup or assertion step for this scenario.
  } catch (err) {
    // Execute the next setup or assertion step for this scenario.
    release();
    // Await async work before asserting or releasing locks.
    await holder.catch(() => undefined);
    // Surface a hard failure when isolation or contract is violated.
    throw err;
  }
}

// Re-export selected symbols for suite consumers.
export { waitForBlockedByHolder };