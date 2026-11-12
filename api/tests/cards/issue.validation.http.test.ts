/**
 * card issue validation via HTTP.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Prisma client types/runtime for DB setup and assertions.
import { CardType, PrismaClient } from "@prisma/client";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Import module bindings used by this suite.
import {
  // Start or stop the in-process API server for this suite.
  closeServer,
  // Execute the next setup or assertion step for this scenario.
  listenApp,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
  // Execute the next setup or assertion step for this scenario.
  postJson,
// Execute the next setup or assertion step for this scenario.
} from "../httpHarness";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupCardsWorld,
  // Execute the next setup or assertion step for this scenario.
  createCardsWorld,
  // Execute the next setup or assertion step for this scenario.
  defaultValidity,
  // Execute the next setup or assertion step for this scenario.
  guestIssueBody,
  // Execute the next setup or assertion step for this scenario.
  masterIssueBody,
  // Execute the next setup or assertion step for this scenario.
  staffIssueBody,
  // Execute the next setup or assertion step for this scenario.
  worldCardSnapshot,
  // Shape CardsWorld documents the fixture/response fields this suite touches.
  type CardsWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: card issue validation HTTP.
describe("card issue validation HTTP", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: CardsWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: import("node:http").Server;
  // Execute the next setup or assertion step for this scenario.
  let token: string;

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createCardsWorld(prisma);
    // Start or stop the in-process API server for this suite.
    ({ server, api } = await listenApp());
    // login: synchronize actors so the race window is observable.
    const login = await loginBearer(api, world.issuer.email, world.password);
    // Session/CSRF step exercising auth lifecycle.
    token = login.token;
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Guard optional cleanup or alternate assertion paths.
    if (server) await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupCardsWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Arrange shared preconditions before cases run.
  beforeEach(async () => {
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
    // Bind ids for later setup or assertions in this scope.
    const ids = cards.map((c) => c.id);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (ids.length) {
      // Await async work before asserting or releasing locks.
      await prisma.accessGrant.deleteMany({ where: { cardId: { in: ids } } });
      // Await async work before asserting or releasing locks.
      await prisma.auditEvent.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: { entityType: "card", entityId: { in: ids } },
      });
      // Await async work before asserting or releasing locks.
      await prisma.accessCard.deleteMany({ where: { id: { in: ids } } });
    }
  });

  // Helper assertNoPartial: assert expected post-condition.
  async function assertNoPartial(before: Awaited<ReturnType<typeof worldCardSnapshot>>) {
    // after: synchronize actors so the race window is observable.
    const after = await worldCardSnapshot(prisma, world);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.cardCount, before.cardCount, "no partial AccessCard");
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.grantCount, before.grantCount, "no partial AccessGrant");
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.auditCount, before.auditCount, "no partial audit");
  }

  // Case: guest+room → 201; employeeId null; grant on room.
  it("guest+room → 201; employeeId null; grant on room", async () => {
    // Bind body for later setup or assertions in this scope.
    const body = guestIssueBody(world);
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, token, "/cards", body);
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 201);
    // Bind card for later setup or assertions in this scope.
    const card = res.body as {
      // Execute the next setup or assertion step for this scenario.
      id: string;
      // Execute the next setup or assertion step for this scenario.
      employeeId: string | null;
      // Execute the next setup or assertion step for this scenario.
      cardType: string;
      // Execute the next setup or assertion step for this scenario.
      grants: Array<{ locationId: string | null }>;
    };
    // Assert the observed value matches the intended post-condition.
    assert.equal(card.cardType, CardType.guest);
    // Assert the observed value matches the intended post-condition.
    assert.equal(card.employeeId, null);
    // Assert collection size matches the expected post-condition.
    assert.equal(card.grants.length, 1);
    // Assert the observed value matches the intended post-condition.
    assert.equal(card.grants[0]!.locationId, world.roomId);
  });

  // Case: guest+common_area → 400; no partial rows.
  it("guest+common_area → 400; no partial rows", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await worldCardSnapshot(prisma, world);
    // res: HTTP response captured for status/body checks.
    const res = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      token,
      // Execute the next setup or assertion step for this scenario.
      "/cards",
      // Execute the next setup or assertion step for this scenario.
      guestIssueBody(world, { locationId: world.commonAreaId }),
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 400);
    // Await async work before asserting or releasing locks.
    await assertNoPartial(before);
  });

  // Case: guest missing location → 400; no partial rows.
  it("guest missing location → 400; no partial rows", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await worldCardSnapshot(prisma, world);
    // res: HTTP response captured for status/body checks.
    const res = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      token,
      // Execute the next setup or assertion step for this scenario.
      "/cards",
      // Execute the next setup or assertion step for this scenario.
      guestIssueBody(world, { locationId: null }),
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 400);
    // Await async work before asserting or releasing locks.
    await assertNoPartial(before);
  });

  // Case: guest+nonexistent locationId → 404; no partial rows.
  it("guest+nonexistent locationId → 404; no partial rows", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await worldCardSnapshot(prisma, world);
    // res: HTTP response captured for status/body checks.
    const res = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      token,
      // Execute the next setup or assertion step for this scenario.
      "/cards",
      // Execute the next setup or assertion step for this scenario.
      guestIssueBody(world, {
        // Execute the next setup or assertion step for this scenario.
        locationId: "loc_does_not_exist_p179_xxxx",
      }),
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 404);
    // Bind err for later setup or assertions in this scope.
    const err = res.body as { error?: string; message?: string };
    // Assert the observed value matches the intended post-condition.
    assert.equal(err.error, "not_found");
    // Assert the observed value matches the intended post-condition.
    assert.match(err.message ?? "", /location/i);
    // Await async work before asserting or releasing locks.
    await assertNoPartial(before);
  });

  // Case: guest+employeeId → 400; no partial rows.
  it("guest+employeeId → 400; no partial rows", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await worldCardSnapshot(prisma, world);
    // res: HTTP response captured for status/body checks.
    const res = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      token,
      // Execute the next setup or assertion step for this scenario.
      "/cards",
      // Execute the next setup or assertion step for this scenario.
      guestIssueBody(world, { employeeId: world.holderA.employeeId }),
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 400);
    // Await async work before asserting or releasing locks.
    await assertNoPartial(before);
  });

  // Case: staff without holder → 400.
  it("staff without holder → 400", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await worldCardSnapshot(prisma, world);
    // res: HTTP response captured for status/body checks.
    const res = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      token,
      // Execute the next setup or assertion step for this scenario.
      "/cards",
      // Execute the next setup or assertion step for this scenario.
      staffIssueBody(world, { employeeId: null }),
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 400);
    // Await async work before asserting or releasing locks.
    await assertNoPartial(before);
  });

  // Case: unknown employee → 404; no partial rows.
  it("unknown employee → 404; no partial rows", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await worldCardSnapshot(prisma, world);
    // res: HTTP response captured for status/body checks.
    const res = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      token,
      // Execute the next setup or assertion step for this scenario.
      "/cards",
      // Execute the next setup or assertion step for this scenario.
      staffIssueBody(world, { employeeId: "emp_does_not_exist_xxx" }),
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 404);
    // Await async work before asserting or releasing locks.
    await assertNoPartial(before);
  });

  // Case: master+location → 400; no partial rows.
  it("master+location → 400; no partial rows", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await worldCardSnapshot(prisma, world);
    // res: HTTP response captured for status/body checks.
    const res = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      token,
      // Execute the next setup or assertion step for this scenario.
      "/cards",
      // Execute the next setup or assertion step for this scenario.
      masterIssueBody(world, { locationId: world.roomId }),
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 400);
    // Await async work before asserting or releasing locks.
    await assertNoPartial(before);
  });

  // Case: master null location → 201; grant.locationId null.
  it("master null location → 201; grant.locationId null", async () => {
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, token, "/cards", masterIssueBody(world));
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 201);
    // Bind card for later setup or assertions in this scope.
    const card = res.body as {
      // Execute the next setup or assertion step for this scenario.
      cardType: string;
      // Execute the next setup or assertion step for this scenario.
      grants: Array<{ locationId: string | null }>;
    };
    // Assert the observed value matches the intended post-condition.
    assert.equal(card.cardType, CardType.master);
    // Assert collection size matches the expected post-condition.
    assert.equal(card.grants.length, 1);
    // Assert the observed value matches the intended post-condition.
    assert.equal(card.grants[0]!.locationId, null);
  });

  // Case: until < from → 400; snapshot unchanged.
  it("until < from → 400; snapshot unchanged", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await worldCardSnapshot(prisma, world);
    // Bind from for later setup or assertions in this scope.
    const from = "2026-06-01T12:00:00.000Z";
    // Bind until for later setup or assertions in this scope.
    const until = "2026-06-01T11:00:00.000Z";
    // res: HTTP response captured for status/body checks.
    const res = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      token,
      // Execute the next setup or assertion step for this scenario.
      "/cards",
      // Execute the next setup or assertion step for this scenario.
      staffIssueBody(world, { validFrom: from, validUntil: until }),
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 400);
    // Await async work before asserting or releasing locks.
    await assertNoPartial(before);
  });

  // Case: until === from → 400; snapshot unchanged.
  it("until === from → 400; snapshot unchanged", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await worldCardSnapshot(prisma, world);
    // Bind t for later setup or assertions in this scope.
    const t = "2026-06-01T12:00:00.000Z";
    // res: HTTP response captured for status/body checks.
    const res = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      token,
      // Execute the next setup or assertion step for this scenario.
      "/cards",
      // Execute the next setup or assertion step for this scenario.
      staffIssueBody(world, { validFrom: t, validUntil: t }),
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 400);
    // Await async work before asserting or releasing locks.
    await assertNoPartial(before);
  });

  // Case: invalid datetime strings → 400 via Zod; no partial.
  it("invalid datetime strings → 400 via Zod; no partial", async () => {
    // before: synchronize actors so the race window is observable.
    const before = await worldCardSnapshot(prisma, world);
    // Bind v for later setup or assertions in this scope.
    const v = defaultValidity();
    // badFrom: HTTP response captured for status/body checks.
    const badFrom = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      token,
      // Execute the next setup or assertion step for this scenario.
      "/cards",
      // Execute the next setup or assertion step for this scenario.
      staffIssueBody(world, { validFrom: "not-a-date", validUntil: v.validUntil }),
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(badFrom.status, 400);
    // badUntil: HTTP response captured for status/body checks.
    const badUntil = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      token,
      // Execute the next setup or assertion step for this scenario.
      "/cards",
      // Execute the next setup or assertion step for this scenario.
      staffIssueBody(world, {
        // Execute the next setup or assertion step for this scenario.
        validFrom: v.validFrom,
        // Execute the next setup or assertion step for this scenario.
        validUntil: "2026-06-01 12:00:00",
      }),
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(badUntil.status, 400);
    // Await async work before asserting or releasing locks.
    await assertNoPartial(before);
  });

  // Case: +1s boundary OK → 201.
  it("+1s boundary OK → 201", async () => {
    // Bind from for later setup or assertions in this scope.
    const from = new Date("2026-06-01T10:00:00.000Z");
    // Bind until for later setup or assertions in this scope.
    const until = new Date(from.getTime() + 1000);
    // res: HTTP response captured for status/body checks.
    const res = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      token,
      // Execute the next setup or assertion step for this scenario.
      "/cards",
      // Execute the next setup or assertion step for this scenario.
      staffIssueBody(world, {
        // Execute the next setup or assertion step for this scenario.
        validFrom: from.toISOString(),
        // Execute the next setup or assertion step for this scenario.
        validUntil: until.toISOString(),
      }),
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 201);
  });
});