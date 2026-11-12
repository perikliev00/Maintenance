/**
 * revokeCard CAS: preserve prior issue history; one revoke audit;
 * concurrent loser 409; control card untouched.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Prisma client types/runtime for DB setup and assertions.
import { CardStatus, PrismaClient } from "@prisma/client";
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
// Shared test fixtures for seeding users, locations, and domain entities.
import { waitForBlockedByHolder } from "../sectors/fixtures";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupCardsWorld,
  // Execute the next setup or assertion step for this scenario.
  countCardAudits,
  // Execute the next setup or assertion step for this scenario.
  createCardsWorld,
  // Execute the next setup or assertion step for this scenario.
  createControlCard,
  // Execute the next setup or assertion step for this scenario.
  staffIssueBody,
  // Shape CardsWorld documents the fixture/response fields this suite touches.
  type CardsWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: card revoke CAS HTTP.
describe("card revoke CAS HTTP", () => {
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

  /** Issue via real HTTP path so card.issue history is non-empty. */
  async function issueTargetViaHttp() {
    // Bind body for later setup or assertions in this scope.
    const body = staffIssueBody(world, { label: `revoke-target-${world.stamp}` });
    // res: HTTP response captured for status/body checks.
    const res = await postJson(api, token, "/cards", body);
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 201);
    // Bind card for later setup or assertions in this scope.
    const card = res.body as { id: string; status: string };
    // issueAudits: synchronize actors so the race window is observable.
    const issueAudits = await prisma.auditEvent.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        entityType: "card",
        // Execute the next setup or assertion step for this scenario.
        entityId: card.id,
        // Execute the next setup or assertion step for this scenario.
        action: "card.issue",
      },
      // Execute the next setup or assertion step for this scenario.
      orderBy: { occurredAt: "asc" },
      // SQL fragment used to observe locks or assert DB state.
      select: { id: true, action: true, after: true, summary: true },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(
      // Execute the next setup or assertion step for this scenario.
      issueAudits.length >= 1,
      // Execute the next setup or assertion step for this scenario.
      "precondition: issued card must have card.issue history",
    );
    // grants: synchronize actors so the race window is observable.
    const grants = await prisma.accessGrant.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { cardId: card.id },
      // Execute the next setup or assertion step for this scenario.
      orderBy: { createdAt: "asc" },
    });
    // Assert collection size matches the expected post-condition.
    assert.ok(grants.length >= 1, "precondition: issued card must have grants");
    // Return the arranged value/result to the caller.
    return { cardId: card.id, issueAudits, grants, commandId: body.commandId };
  }

  // Helper assertIssueHistoryPreserved: assert expected post-condition.
  async function assertIssueHistoryPreserved(
    // Execute the next setup or assertion step for this scenario.
    cardId: string,
    // Execute the next setup or assertion step for this scenario.
    issueAudits: Array<{ id: string; action: string; after: unknown; summary: string | null }>,
    // Execute the next setup or assertion step for this scenario.
    grantIds: string[],
  // Execute the next setup or assertion step for this scenario.
  ) {
    // afterIssue: synchronize actors so the race window is observable.
    const afterIssue = await prisma.auditEvent.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        entityType: "card",
        // Execute the next setup or assertion step for this scenario.
        entityId: cardId,
        // Execute the next setup or assertion step for this scenario.
        action: "card.issue",
      },
      // Execute the next setup or assertion step for this scenario.
      orderBy: { occurredAt: "asc" },
      // SQL fragment used to observe locks or assert DB state.
      select: { id: true, action: true, after: true, summary: true },
    });
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Execute the next setup or assertion step for this scenario.
      afterIssue.map((a) => a.id),
      // Execute the next setup or assertion step for this scenario.
      issueAudits.map((a) => a.id),
      // Execute the next setup or assertion step for this scenario.
      "prior card.issue history must remain after revoke",
    );
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Execute the next setup or assertion step for this scenario.
      afterIssue.map((a) => ({ after: a.after, summary: a.summary })),
      // Execute the next setup or assertion step for this scenario.
      issueAudits.map((a) => ({ after: a.after, summary: a.summary })),
    );

    // grantsAfter: synchronize actors so the race window is observable.
    const grantsAfter = await prisma.accessGrant.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { cardId },
      // SQL fragment used to observe locks or assert DB state.
      select: { id: true },
      // Execute the next setup or assertion step for this scenario.
      orderBy: { id: "asc" },
    });
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Execute the next setup or assertion step for this scenario.
      grantsAfter.map((g) => g.id).sort(),
      // Execute the next setup or assertion step for this scenario.
      [...grantIds].sort(),
      // Execute the next setup or assertion step for this scenario.
      "grants remain attached after system revoke (no physical reprogram)",
    );
  }

  // Case: sequential: first revoke ok; second 409; prior history kept; revoke audit=1.
  it("sequential: first revoke ok; second 409; prior history kept; revoke audit=1", async () => {
    // target: HTTP response captured for status/body checks.
    const target = await issueTargetViaHttp();
    // control: seeded entity required before the mutation under test.
    const control = await createControlCard(prisma, world);
    // Bind grantIds for later setup or assertions in this scope.
    const grantIds = target.grants.map((g) => g.id);

    // first: HTTP response captured for status/body checks.
    const first = await postJson(api, token, `/cards/${target.cardId}/revoke`, {});
    // Assert HTTP status matches the contract for this path.
    assert.equal(first.status, 200);
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Execute the next setup or assertion step for this scenario.
      (first.body as { status: string }).status,
      // Execute the next setup or assertion step for this scenario.
      CardStatus.revoked,
    );

    // Await async work before asserting or releasing locks.
    await assertIssueHistoryPreserved(
      // Execute the next setup or assertion step for this scenario.
      target.cardId,
      // Execute the next setup or assertion step for this scenario.
      target.issueAudits,
      // Execute the next setup or assertion step for this scenario.
      grantIds,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await countCardAudits(prisma, "card.revoke", [target.cardId]),
      1,
    );

    // second: HTTP response captured for status/body checks.
    const second = await postJson(api, token, `/cards/${target.cardId}/revoke`, {});
    // Assert HTTP status matches the contract for this path.
    assert.equal(second.status, 409);
    // Bind err for later setup or assertions in this scope.
    const err = second.body as { error?: string };
    // Assert the observed value matches the intended post-condition.
    assert.equal(err.error, "invalid_state");

    // Await async work before asserting or releasing locks.
    await assertIssueHistoryPreserved(
      // Execute the next setup or assertion step for this scenario.
      target.cardId,
      // Execute the next setup or assertion step for this scenario.
      target.issueAudits,
      // Execute the next setup or assertion step for this scenario.
      grantIds,
    );
    // Assert the observed value matches the intended post-condition.
    assert.equal(
      // Await async work before asserting or releasing locks.
      await countCardAudits(prisma, "card.revoke", [target.cardId]),
      1,
      // Execute the next setup or assertion step for this scenario.
      "retry must not write a second card.revoke",
    );

    // controlRow: synchronize actors so the race window is observable.
    const controlRow = await prisma.accessCard.findUnique({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: control.id },
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(controlRow?.status, CardStatus.active);
  });

  // Case probes concurrency/isolation: concurrent: FOR UPDATE holder; dual revoke; one success one 409; history kept.
  it("concurrent: FOR UPDATE holder; dual revoke; one success one 409; history kept", async () => {
    // target: HTTP response captured for status/body checks.
    const target = await issueTargetViaHttp();
    // control: seeded entity required before the mutation under test.
    const control = await createControlCard(prisma, world);
    // Bind grantIds for later setup or assertions in this scope.
    const grantIds = target.grants.map((g) => g.id);

    // Execute the next setup or assertion step for this scenario.
    let release!: () => void;
    // Bind gate for later setup or assertions in this scope.
    const gate = new Promise<void>((r) => {
      // Execute the next setup or assertion step for this scenario.
      release = r;
    });
    // Execute the next setup or assertion step for this scenario.
    let holderPid: number | null = null;
    // Bind lockHeld for later setup or assertions in this scope.
    let lockHeld = false;

    // Bind holder for later setup or assertions in this scope.
    const holder = prisma.$transaction(
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
          SELECT id FROM "AccessCard" WHERE id = ${target.cardId} FOR UPDATE
        `;
        // Concurrency/isolation step for the race under test.
        lockHeld = true;
        // Await async work before asserting or releasing locks.
        await gate;
      },
      // Runner option controlling stability or isolation of the suite.
      { timeout: 60_000, maxWait: 60_000 },
    );

    // Execute the next setup or assertion step for this scenario.
    let p1: Promise<{ status: number; body: unknown }> | undefined;
    // Execute the next setup or assertion step for this scenario.
    let p2: Promise<{ status: number; body: unknown }> | undefined;
    // Try path where partial failure must not leak suite state.
    try {
      // Repeat/poll to widen the race window or wait for lock waiters.
      for (let i = 0; i < 100 && !lockHeld; i += 1) {
        // Brief yield so lock waiters/UI can settle before asserting.
        await new Promise((r) => setTimeout(r, 20));
      }
      // Assert the observed value matches the intended post-condition.
      assert.ok(lockHeld && holderPid != null);

      // Execute the next setup or assertion step for this scenario.
      p1 = postJson(api, token, `/cards/${target.cardId}/revoke`, {});
      // Execute the next setup or assertion step for this scenario.
      p2 = postJson(api, token, `/cards/${target.cardId}/revoke`, {});

      // blocked: synchronize actors so the race window is observable.
      const blocked = await waitForBlockedByHolder(prisma, holderPid!, 2, 15_000);
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.ok(blocked.length >= 2, `expected >=2 waiters, got ${blocked.length}`);
      // Assert the observed value matches the intended post-condition.
      assert.ok(!blocked.includes(holderPid!), "holder must not be a waiter");

      // Execute the next setup or assertion step for this scenario.
      release();
      // Await async work before asserting or releasing locks.
      await holder;

      // settled: capture concurrent outcomes for race assertions.
      const settled = await Promise.allSettled([p1, p2]);
      // Bind results for later setup or assertions in this scope.
      const results = settled.map((s) => {
        // Assert HTTP status matches the contract for this path.
        assert.equal(s.status, "fulfilled", String(s));
        // Return the arranged value/result to the caller.
        return (s as PromiseFulfilledResult<{ status: number; body: unknown }>)
          // Continue the call chain for setup or assertion detail.
          .value;
      });
      // Bind ok for later setup or assertions in this scope.
      const ok = results.filter((r) => r.status === 200);
      // Bind conflict for later setup or assertions in this scope.
      const conflict = results.filter((r) => r.status === 409);
      // Assert HTTP status matches the contract for this path.
      assert.equal(ok.length, 1, `statuses=${results.map((r) => r.status)}`);
      // Assert collection size matches the expected post-condition.
      assert.equal(conflict.length, 1);
      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Execute the next setup or assertion step for this scenario.
        (conflict[0]!.body as { error?: string }).error,
        // Execute the next setup or assertion step for this scenario.
        "invalid_state",
      );

      // row: synchronize actors so the race window is observable.
      const row = await prisma.accessCard.findUnique({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: target.cardId },
      });
      // Assert HTTP status matches the contract for this path.
      assert.equal(row?.status, CardStatus.revoked);
      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Await async work before asserting or releasing locks.
        await countCardAudits(prisma, "card.revoke", [target.cardId]),
        1,
      );
      // Await async work before asserting or releasing locks.
      await assertIssueHistoryPreserved(
        // Execute the next setup or assertion step for this scenario.
        target.cardId,
        // Execute the next setup or assertion step for this scenario.
        target.issueAudits,
        // Execute the next setup or assertion step for this scenario.
        grantIds,
      );

      // controlRow: synchronize actors so the race window is observable.
      const controlRow = await prisma.accessCard.findUnique({
        // SQL fragment used to observe locks or assert DB state.
        where: { id: control.id },
      });
      // Assert HTTP status matches the contract for this path.
      assert.equal(controlRow?.status, CardStatus.active);
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Execute the next setup or assertion step for this scenario.
      release();
      // Await async work before asserting or releasing locks.
      await holder.catch(() => undefined);
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (p1 && p2) await Promise.allSettled([p1, p2]);
    }
  });
});
