/**
 * card issue commandId idempotency + fingerprint.
 *
 * Diagnostics note: fingerprint only on the early `existing` path
 * would still let the P2002 loser return 200 without comparing payload.
 * Both existing + raced paths must fingerprint (implemented in cards.ts).
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, beforeEach, describe, it } from "node:test";
// Prisma client types/runtime for DB setup and assertions.
import { PrismaClient } from "@prisma/client";
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
  countCardAudits,
  // Execute the next setup or assertion step for this scenario.
  countCardsByCommand,
  // Execute the next setup or assertion step for this scenario.
  countGrantsForCommand,
  // Execute the next setup or assertion step for this scenario.
  createCardsWorld,
  // Concurrency/isolation step for the race under test.
  runWhileAccessCardTableLocked,
  // Execute the next setup or assertion step for this scenario.
  staffIssueBody,
  // Execute the next setup or assertion step for this scenario.
  worldCardSnapshot,
  // Shape CardsWorld documents the fixture/response fields this suite touches.
  type CardsWorld,
  // Shape IssueBody documents the fixture/response fields this suite touches.
  type IssueBody,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: card issue idempotency HTTP.
describe("card issue idempotency HTTP", () => {
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

  // Helper assertCounts: assert expected post-condition.
  async function assertCounts(commandId: string, cardId: string) {
    // Assert collection size matches the expected post-condition.
    assert.equal(await countCardsByCommand(prisma, commandId), 1);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countGrantsForCommand(prisma, commandId), 1);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countCardAudits(prisma, "card.issue", [cardId]), 1);
  }

  // Case: sequential same commandId+payload → 201 then 200; counts=1.
  it("sequential same commandId+payload → 201 then 200; counts=1", async () => {
    // Bind body for later setup or assertions in this scope.
    const body = staffIssueBody(world);
    // first: HTTP response captured for status/body checks.
    const first = await postJson(api, token, "/cards", body);
    // Assert HTTP status matches the contract for this path.
    assert.equal(first.status, 201);
    // Bind card for later setup or assertions in this scope.
    const card = first.body as { id: string };
    // second: HTTP response captured for status/body checks.
    const second = await postJson(api, token, "/cards", body);
    // Assert HTTP status matches the contract for this path.
    assert.equal(second.status, 200);
    // Assert the observed value matches the intended post-condition.
    assert.equal((second.body as { id: string }).id, card.id);
    // Await async work before asserting or releasing locks.
    await assertCounts(body.commandId, card.id);
  });

  // Case probes concurrency/isolation: concurrent same payload behind AccessCard table lock; both wait; counts=1.
  it("concurrent same payload behind AccessCard table lock; both wait; counts=1", async () => {
    // Bind body for later setup or assertions in this scope.
    const body = staffIssueBody(world);
    // settled: synchronize actors so the race window is observable.
    const settled = await runWhileAccessCardTableLocked({
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      minWaiters: 2,
      // Concurrency/isolation step for the race under test.
      startRace: () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          // Execute the next setup or assertion step for this scenario.
          postJson(api, token, "/cards", body),
          // Execute the next setup or assertion step for this scenario.
          postJson(api, token, "/cards", body),
        ]),
    });

    // Bind statuses for later setup or assertions in this scope.
    const statuses = settled
      // Continue the call chain for setup or assertion detail.
      .filter((s): s is PromiseFulfilledResult<{ status: number; body: unknown }> =>
        // Execute the next setup or assertion step for this scenario.
        s.status === "fulfilled",
      )
      // Continue the call chain for setup or assertion detail.
      .map((s) => s.value.status)
      // Continue the call chain for setup or assertion detail.
      .sort();
    // Assert collection size matches the expected post-condition.
    assert.equal(settled.length, 2);
    // Assert HTTP status matches the contract for this path.
    assert.deepEqual(statuses, [200, 201]);

    // card: synchronize actors so the race window is observable.
    const card = await prisma.accessCard.findUnique({
      // SQL fragment used to observe locks or assert DB state.
      where: { commandId: body.commandId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(card);
    // Await async work before asserting or releasing locks.
    await assertCounts(body.commandId, card.id);
  });

  // Case: sequential mismatch employee → 409; DB unchanged; identical replay 200.
  it("sequential mismatch employee → 409; DB unchanged; identical replay 200", async () => {
    // Bind body for later setup or assertions in this scope.
    const body = staffIssueBody(world);
    // first: HTTP response captured for status/body checks.
    const first = await postJson(api, token, "/cards", body);
    // Assert HTTP status matches the contract for this path.
    assert.equal(first.status, 201);
    // Bind card for later setup or assertions in this scope.
    const card = first.body as { id: string };
    // snap: synchronize actors so the race window is observable.
    const snap = await worldCardSnapshot(prisma, world);

    // Execute the next setup or assertion step for this scenario.
    const mismatch: IssueBody = {
      // Continue the call chain for setup or assertion detail.
      ...body,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.holderB.employeeId,
    };
    // bad: HTTP response captured for status/body checks.
    const bad = await postJson(api, token, "/cards", mismatch);
    // Assert HTTP status matches the contract for this path.
    assert.equal(bad.status, 409);
    // Bind err for later setup or assertions in this scope.
    const err = bad.body as { error?: string; message?: string };
    // Assert the observed value matches the intended post-condition.
    assert.equal(err.error, "conflict");
    // Assert the observed value matches the intended post-condition.
    assert.match(err.message ?? "", /commandId reused/i);

    // after: synchronize actors so the race window is observable.
    const after = await worldCardSnapshot(prisma, world);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.cardCount, snap.cardCount);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.grantCount, snap.grantCount);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.auditCount, snap.auditCount);

    // replay: HTTP response captured for status/body checks.
    const replay = await postJson(api, token, "/cards", body);
    // Assert HTTP status matches the contract for this path.
    assert.equal(replay.status, 200);
    // Assert replay/idempotent path did not create duplicates.
    assert.equal((replay.body as { id: string }).id, card.id);
    // Await async work before asserting or releasing locks.
    await assertCounts(body.commandId, card.id);
  });

  // Case: sequential mismatch location → 409; DB unchanged.
  it("sequential mismatch location → 409; DB unchanged", async () => {
    // Bind body for later setup or assertions in this scope.
    const body = staffIssueBody(world);
    // first: HTTP response captured for status/body checks.
    const first = await postJson(api, token, "/cards", body);
    // Assert HTTP status matches the contract for this path.
    assert.equal(first.status, 201);
    // snap: synchronize actors so the race window is observable.
    const snap = await worldCardSnapshot(prisma, world);

    // bad: HTTP response captured for status/body checks.
    const bad = await postJson(
      // Execute the next setup or assertion step for this scenario.
      api,
      // Execute the next setup or assertion step for this scenario.
      token,
      // Execute the next setup or assertion step for this scenario.
      "/cards",
      // Execute the next setup or assertion step for this scenario.
      { ...body, locationId: world.commonAreaId },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(bad.status, 409);
    // after: synchronize actors so the race window is observable.
    const after = await worldCardSnapshot(prisma, world);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.cardCount, snap.cardCount);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.grantCount, snap.grantCount);
    // Assert the observed value matches the intended post-condition.
    assert.equal(after.auditCount, snap.auditCount);
  });

  // Helper assertCardContentUnchanged: assert expected post-condition.
  async function assertCardContentUnchanged(cardId: string, before: {
    // Execute the next setup or assertion step for this scenario.
    cardType: string;
    // Execute the next setup or assertion step for this scenario.
    employeeId: string | null;
    // Execute the next setup or assertion step for this scenario.
    label: string | null;
    // Fixture field status for the seeded actor/entity.
    status: string;
    // Execute the next setup or assertion step for this scenario.
    commandId: string;
    // Execute the next setup or assertion step for this scenario.
    grants: Array<{
      // Execute the next setup or assertion step for this scenario.
      locationId: string | null;
      // Execute the next setup or assertion step for this scenario.
      validFrom: Date;
      // Execute the next setup or assertion step for this scenario.
      validUntil: Date;
    // Execute the next setup or assertion step for this scenario.
    }>;
    // Execute the next setup or assertion step for this scenario.
    issueAudits: Array<{ id: string; action: string; after: unknown }>;
  }) {
    // card: synchronize actors so the race window is observable.
    const card = await prisma.accessCard.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: cardId },
      // Execute the next setup or assertion step for this scenario.
      include: { grants: { orderBy: { createdAt: "asc" } } },
    });
    // Assert the observed value matches the intended post-condition.
    assert.equal(card.cardType, before.cardType);
    // Assert the observed value matches the intended post-condition.
    assert.equal(card.employeeId, before.employeeId);
    // Assert the observed value matches the intended post-condition.
    assert.equal(card.label, before.label);
    // Assert HTTP status matches the contract for this path.
    assert.equal(card.status, before.status);
    // Assert the observed value matches the intended post-condition.
    assert.equal(card.commandId, before.commandId);
    // Assert collection size matches the expected post-condition.
    assert.equal(card.grants.length, before.grants.length);
    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let i = 0; i < before.grants.length; i += 1) {
      // Assert the observed value matches the intended post-condition.
      assert.equal(card.grants[i]!.locationId, before.grants[i]!.locationId);
      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Execute the next setup or assertion step for this scenario.
        card.grants[i]!.validFrom.getTime(),
        // Execute the next setup or assertion step for this scenario.
        before.grants[i]!.validFrom.getTime(),
      );
      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Execute the next setup or assertion step for this scenario.
        card.grants[i]!.validUntil.getTime(),
        // Execute the next setup or assertion step for this scenario.
        before.grants[i]!.validUntil.getTime(),
      );
    }
    // audits: synchronize actors so the race window is observable.
    const audits = await prisma.auditEvent.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { entityType: "card", entityId: cardId, action: "card.issue" },
      // Execute the next setup or assertion step for this scenario.
      orderBy: { occurredAt: "asc" },
      // SQL fragment used to observe locks or assert DB state.
      select: { id: true, action: true, after: true },
    });
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Execute the next setup or assertion step for this scenario.
      audits.map((a) => a.id),
      // Execute the next setup or assertion step for this scenario.
      before.issueAudits.map((a) => a.id),
    );
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Execute the next setup or assertion step for this scenario.
      audits.map((a) => a.after),
      // Execute the next setup or assertion step for this scenario.
      before.issueAudits.map((a) => a.after),
    );
  }

  // Local helper snapshotIssuedCard used by cases in this file.
  async function snapshotIssuedCard(cardId: string) {
    // card: synchronize actors so the race window is observable.
    const card = await prisma.accessCard.findUniqueOrThrow({
      // SQL fragment used to observe locks or assert DB state.
      where: { id: cardId },
      // Execute the next setup or assertion step for this scenario.
      include: { grants: { orderBy: { createdAt: "asc" } } },
    });
    // issueAudits: synchronize actors so the race window is observable.
    const issueAudits = await prisma.auditEvent.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: { entityType: "card", entityId: cardId, action: "card.issue" },
      // Execute the next setup or assertion step for this scenario.
      orderBy: { occurredAt: "asc" },
      // SQL fragment used to observe locks or assert DB state.
      select: { id: true, action: true, after: true },
    });
    // Assert collection size matches the expected post-condition.
    assert.ok(issueAudits.length >= 1, "issued card must have card.issue audit");
    // Return the arranged value/result to the caller.
    return {
      // Execute the next setup or assertion step for this scenario.
      cardType: card.cardType,
      // Execute the next setup or assertion step for this scenario.
      employeeId: card.employeeId,
      // Execute the next setup or assertion step for this scenario.
      label: card.label,
      // Fixture field status for the seeded actor/entity.
      status: card.status,
      // Execute the next setup or assertion step for this scenario.
      commandId: card.commandId,
      // Execute the next setup or assertion step for this scenario.
      grants: card.grants.map((g) => ({
        // Execute the next setup or assertion step for this scenario.
        locationId: g.locationId,
        // Execute the next setup or assertion step for this scenario.
        validFrom: g.validFrom,
        // Execute the next setup or assertion step for this scenario.
        validUntil: g.validUntil,
      })),
      // Execute the next setup or assertion step for this scenario.
      issueAudits,
    };
  }

  // Case: sequential mismatch validFrom only → 409; content unchanged.
  it("sequential mismatch validFrom only → 409; content unchanged", async () => {
    // Bind body for later setup or assertions in this scope.
    const body = staffIssueBody(world);
    // first: HTTP response captured for status/body checks.
    const first = await postJson(api, token, "/cards", body);
    // Assert HTTP status matches the contract for this path.
    assert.equal(first.status, 201);
    // cardId: unique stamp so parallel runs do not collide.
    const cardId = (first.body as { id: string }).id;
    // content: synchronize actors so the race window is observable.
    const content = await snapshotIssuedCard(cardId);
    // Bind from for later setup or assertions in this scope.
    const from = new Date(body.validFrom);
    // Bind until for later setup or assertions in this scope.
    const until = new Date(body.validUntil);
    // Independently valid window: later start, same end (still until > from).
    const badFrom = new Date(from.getTime() + 60_000);
    // Assert the observed value matches the intended post-condition.
    assert.ok(badFrom.getTime() < until.getTime());

    // bad: HTTP response captured for status/body checks.
    const bad = await postJson(api, token, "/cards", {
      // Continue the call chain for setup or assertion detail.
      ...body,
      // Execute the next setup or assertion step for this scenario.
      validFrom: badFrom.toISOString(),
      // validUntil unchanged
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(bad.status, 409);
    // Assert the observed value matches the intended post-condition.
    assert.equal((bad.body as { error?: string }).error, "conflict");
    // Await async work before asserting or releasing locks.
    await assertCardContentUnchanged(cardId, content);
  });

  // Case: sequential mismatch validUntil only → 409; content unchanged.
  it("sequential mismatch validUntil only → 409; content unchanged", async () => {
    // Bind body for later setup or assertions in this scope.
    const body = staffIssueBody(world);
    // first: HTTP response captured for status/body checks.
    const first = await postJson(api, token, "/cards", body);
    // Assert HTTP status matches the contract for this path.
    assert.equal(first.status, 201);
    // cardId: unique stamp so parallel runs do not collide.
    const cardId = (first.body as { id: string }).id;
    // content: synchronize actors so the race window is observable.
    const content = await snapshotIssuedCard(cardId);
    // Bind from for later setup or assertions in this scope.
    const from = new Date(body.validFrom);
    // Bind until for later setup or assertions in this scope.
    const until = new Date(body.validUntil);
    // Bind badUntil for later setup or assertions in this scope.
    const badUntil = new Date(until.getTime() + 60_000);
    // Assert the observed value matches the intended post-condition.
    assert.ok(badUntil.getTime() > from.getTime());

    // bad: HTTP response captured for status/body checks.
    const bad = await postJson(api, token, "/cards", {
      // Continue the call chain for setup or assertion detail.
      ...body,
      // Execute the next setup or assertion step for this scenario.
      validUntil: badUntil.toISOString(),
      // validFrom unchanged
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(bad.status, 409);
    // Assert the observed value matches the intended post-condition.
    assert.equal((bad.body as { error?: string }).error, "conflict");
    // Await async work before asserting or releasing locks.
    await assertCardContentUnchanged(cardId, content);
  });

  // Case probes concurrency/isolation: concurrent mismatch different valid payloads same commandId; one card one audit; loser 409.
  it("concurrent mismatch different valid payloads same commandId; one card one audit; loser 409", async () => {
    // Bind base for later setup or assertions in this scope.
    const base = staffIssueBody(world);
    // Execute the next setup or assertion step for this scenario.
    const bodyA: IssueBody = {
      // Continue the call chain for setup or assertion detail.
      ...base,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.holderA.employeeId,
      // Concurrency/isolation step for the race under test.
      label: "race-a",
    };
    // Execute the next setup or assertion step for this scenario.
    const bodyB: IssueBody = {
      // Continue the call chain for setup or assertion detail.
      ...base,
      // Execute the next setup or assertion step for this scenario.
      commandId: base.commandId,
      // Execute the next setup or assertion step for this scenario.
      employeeId: world.holderB.employeeId,
      // Concurrency/isolation step for the race under test.
      label: "race-b",
    };

    // settled: synchronize actors so the race window is observable.
    const settled = await runWhileAccessCardTableLocked({
      // Execute the next setup or assertion step for this scenario.
      prisma,
      // Execute the next setup or assertion step for this scenario.
      minWaiters: 2,
      // Concurrency/isolation step for the race under test.
      startRace: () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          // Execute the next setup or assertion step for this scenario.
          postJson(api, token, "/cards", bodyA),
          // Execute the next setup or assertion step for this scenario.
          postJson(api, token, "/cards", bodyB),
        ]),
    });

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
    const ok = results.filter((r) => r.status === 201 || r.status === 200);
    // Bind conflict for later setup or assertions in this scope.
    const conflict = results.filter((r) => r.status === 409);
    // Assert HTTP status matches the contract for this path.
    assert.equal(ok.length, 1, `expected one success, got ${JSON.stringify(results.map((r) => r.status))}`);
    // Assert we are on the isolated test DB, not a seed/prod database.
    assert.equal(conflict.length, 1, "expected one 409 loser");
    // Bind err for later setup or assertions in this scope.
    const err = conflict[0]!.body as { error?: string };
    // Assert the observed value matches the intended post-condition.
    assert.equal(err.error, "conflict");

    // Assert collection size matches the expected post-condition.
    assert.equal(await countCardsByCommand(prisma, base.commandId), 1);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countGrantsForCommand(prisma, base.commandId), 1);
    // card: synchronize actors so the race window is observable.
    const card = await prisma.accessCard.findUnique({
      // SQL fragment used to observe locks or assert DB state.
      where: { commandId: base.commandId },
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(card);
    // Assert collection size matches the expected post-condition.
    assert.equal(await countCardAudits(prisma, "card.issue", [card.id]), 1);
  });
});