/**
 * card issue commandId idempotency + fingerprint.
 *
 * Diagnostics note: fingerprint only on the early `existing` path
 * would still let the P2002 loser return 200 without comparing payload.
 * Both existing + raced paths must fingerprint (implemented in cards.ts).
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
import {
  closeServer,
  listenApp,
  loginBearer,
  postJson,
} from "../httpHarness";
import {
  cleanupCardsWorld,
  countCardAudits,
  countCardsByCommand,
  countGrantsForCommand,
  createCardsWorld,
  runWhileAccessCardTableLocked,
  staffIssueBody,
  worldCardSnapshot,
  // Shape CardsWorld documents the fixture/response fields this suite touches.
  type CardsWorld,
  // Shape IssueBody documents the fixture/response fields this suite touches.
  type IssueBody,
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Suite: card issue idempotency HTTP.
describe("card issue idempotency HTTP", () => {
  let world: CardsWorld;
  let api: string;
  let server: import("node:http").Server;
  let token: string;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    world = await createCardsWorld(prisma);
    ({ server, api } = await listenApp());
    const login = await loginBearer(api, world.issuer.email, world.password);
    token = login.token;
  });

  after(async () => {
    if (server) await closeServer(server);
    if (world) await cleanupCardsWorld(prisma, world);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
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
    const ids = cards.map((c) => c.id);
    if (ids.length) {
      await prisma.accessGrant.deleteMany({ where: { cardId: { in: ids } } });
      await prisma.auditEvent.deleteMany({
        where: { entityType: "card", entityId: { in: ids } },
      });
      await prisma.accessCard.deleteMany({ where: { id: { in: ids } } });
    }
  });

  // Helper assertCounts: assert expected post-condition.
  async function assertCounts(commandId: string, cardId: string) {
    assert.equal(await countCardsByCommand(prisma, commandId), 1);
    assert.equal(await countGrantsForCommand(prisma, commandId), 1);
    assert.equal(await countCardAudits(prisma, "card.issue", [cardId]), 1);
  }

  // Case: sequential same commandId+payload → 201 then 200; counts=1.
  it("sequential same commandId+payload → 201 then 200; counts=1", async () => {
    const body = staffIssueBody(world);
    const first = await postJson(api, token, "/cards", body);
    assert.equal(first.status, 201);
    const card = first.body as { id: string };
    const second = await postJson(api, token, "/cards", body);
    assert.equal(second.status, 200);
    assert.equal((second.body as { id: string }).id, card.id);
    await assertCounts(body.commandId, card.id);
  });

  // Case probes concurrency/isolation: concurrent same payload behind AccessCard table lock; both wait; counts=1.
  it("concurrent same payload behind AccessCard table lock; both wait; counts=1", async () => {
    const body = staffIssueBody(world);
    const settled = await runWhileAccessCardTableLocked({
      prisma,
      minWaiters: 2,
      startRace: () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          postJson(api, token, "/cards", body),
          postJson(api, token, "/cards", body),
        ]),
    });

    const statuses = settled
      .filter((s): s is PromiseFulfilledResult<{ status: number; body: unknown }> =>
        s.status === "fulfilled",
      )
      .map((s) => s.value.status)
      .sort();
    assert.equal(settled.length, 2);
    assert.deepEqual(statuses, [200, 201]);

    const card = await prisma.accessCard.findUnique({
      where: { commandId: body.commandId },
    });
    assert.ok(card);
    await assertCounts(body.commandId, card.id);
  });

  // Case: sequential mismatch employee → 409; DB unchanged; identical replay 200.
  it("sequential mismatch employee → 409; DB unchanged; identical replay 200", async () => {
    const body = staffIssueBody(world);
    const first = await postJson(api, token, "/cards", body);
    assert.equal(first.status, 201);
    const card = first.body as { id: string };
    const snap = await worldCardSnapshot(prisma, world);

    const mismatch: IssueBody = {
      ...body,
      employeeId: world.holderB.employeeId,
    };
    const bad = await postJson(api, token, "/cards", mismatch);
    assert.equal(bad.status, 409);
    const err = bad.body as { error?: string; message?: string };
    assert.equal(err.error, "conflict");
    assert.match(err.message ?? "", /commandId reused/i);

    const after = await worldCardSnapshot(prisma, world);
    assert.equal(after.cardCount, snap.cardCount);
    assert.equal(after.grantCount, snap.grantCount);
    assert.equal(after.auditCount, snap.auditCount);

    const replay = await postJson(api, token, "/cards", body);
    assert.equal(replay.status, 200);
    // Assert replay/idempotent path did not create duplicates.
    assert.equal((replay.body as { id: string }).id, card.id);
    await assertCounts(body.commandId, card.id);
  });

  // Case: sequential mismatch location → 409; DB unchanged.
  it("sequential mismatch location → 409; DB unchanged", async () => {
    const body = staffIssueBody(world);
    const first = await postJson(api, token, "/cards", body);
    assert.equal(first.status, 201);
    const snap = await worldCardSnapshot(prisma, world);

    const bad = await postJson(
      api,
      token,
      "/cards",
      { ...body, locationId: world.commonAreaId },
    );
    assert.equal(bad.status, 409);
    const after = await worldCardSnapshot(prisma, world);
    assert.equal(after.cardCount, snap.cardCount);
    assert.equal(after.grantCount, snap.grantCount);
    assert.equal(after.auditCount, snap.auditCount);
  });

  // Helper assertCardContentUnchanged: assert expected post-condition.
  async function assertCardContentUnchanged(cardId: string, before: {
    cardType: string;
    employeeId: string | null;
    label: string | null;
    status: string;
    commandId: string;
    grants: Array<{
      locationId: string | null;
      validFrom: Date;
      validUntil: Date;
    }>;
    issueAudits: Array<{ id: string; action: string; after: unknown }>;
  }) {
    const card = await prisma.accessCard.findUniqueOrThrow({
      where: { id: cardId },
      include: { grants: { orderBy: { createdAt: "asc" } } },
    });
    assert.equal(card.cardType, before.cardType);
    assert.equal(card.employeeId, before.employeeId);
    assert.equal(card.label, before.label);
    assert.equal(card.status, before.status);
    assert.equal(card.commandId, before.commandId);
    assert.equal(card.grants.length, before.grants.length);
    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let i = 0; i < before.grants.length; i += 1) {
      assert.equal(card.grants[i]!.locationId, before.grants[i]!.locationId);
      assert.equal(
        card.grants[i]!.validFrom.getTime(),
        before.grants[i]!.validFrom.getTime(),
      );
      assert.equal(
        card.grants[i]!.validUntil.getTime(),
        before.grants[i]!.validUntil.getTime(),
      );
    }
    const audits = await prisma.auditEvent.findMany({
      where: { entityType: "card", entityId: cardId, action: "card.issue" },
      orderBy: { occurredAt: "asc" },
      select: { id: true, action: true, after: true },
    });
    assert.deepEqual(
      audits.map((a) => a.id),
      before.issueAudits.map((a) => a.id),
    );
    assert.deepEqual(
      audits.map((a) => a.after),
      before.issueAudits.map((a) => a.after),
    );
  }

  // Local helper snapshotIssuedCard used by cases in this file.
  async function snapshotIssuedCard(cardId: string) {
    const card = await prisma.accessCard.findUniqueOrThrow({
      where: { id: cardId },
      include: { grants: { orderBy: { createdAt: "asc" } } },
    });
    const issueAudits = await prisma.auditEvent.findMany({
      where: { entityType: "card", entityId: cardId, action: "card.issue" },
      orderBy: { occurredAt: "asc" },
      select: { id: true, action: true, after: true },
    });
    assert.ok(issueAudits.length >= 1, "issued card must have card.issue audit");
    return {
      cardType: card.cardType,
      employeeId: card.employeeId,
      label: card.label,
      status: card.status,
      commandId: card.commandId,
      grants: card.grants.map((g) => ({
        locationId: g.locationId,
        validFrom: g.validFrom,
        validUntil: g.validUntil,
      })),
      issueAudits,
    };
  }

  // Case: sequential mismatch validFrom only → 409; content unchanged.
  it("sequential mismatch validFrom only → 409; content unchanged", async () => {
    const body = staffIssueBody(world);
    const first = await postJson(api, token, "/cards", body);
    assert.equal(first.status, 201);
    const cardId = (first.body as { id: string }).id;
    const content = await snapshotIssuedCard(cardId);
    const from = new Date(body.validFrom);
    const until = new Date(body.validUntil);
    // Independently valid window: later start, same end (still until > from).
    const badFrom = new Date(from.getTime() + 60_000);
    assert.ok(badFrom.getTime() < until.getTime());

    const bad = await postJson(api, token, "/cards", {
      ...body,
      validFrom: badFrom.toISOString(),
      // validUntil unchanged
    });
    assert.equal(bad.status, 409);
    assert.equal((bad.body as { error?: string }).error, "conflict");
    await assertCardContentUnchanged(cardId, content);
  });

  // Case: sequential mismatch validUntil only → 409; content unchanged.
  it("sequential mismatch validUntil only → 409; content unchanged", async () => {
    const body = staffIssueBody(world);
    const first = await postJson(api, token, "/cards", body);
    assert.equal(first.status, 201);
    const cardId = (first.body as { id: string }).id;
    const content = await snapshotIssuedCard(cardId);
    const from = new Date(body.validFrom);
    const until = new Date(body.validUntil);
    const badUntil = new Date(until.getTime() + 60_000);
    assert.ok(badUntil.getTime() > from.getTime());

    const bad = await postJson(api, token, "/cards", {
      ...body,
      validUntil: badUntil.toISOString(),
      // validFrom unchanged
    });
    assert.equal(bad.status, 409);
    assert.equal((bad.body as { error?: string }).error, "conflict");
    await assertCardContentUnchanged(cardId, content);
  });

  // Case probes concurrency/isolation: concurrent mismatch different valid payloads same commandId; one card one audit; loser 409.
  it("concurrent mismatch different valid payloads same commandId; one card one audit; loser 409", async () => {
    const base = staffIssueBody(world);
    const bodyA: IssueBody = {
      ...base,
      employeeId: world.holderA.employeeId,
      label: "race-a",
    };
    const bodyB: IssueBody = {
      ...base,
      commandId: base.commandId,
      employeeId: world.holderB.employeeId,
      label: "race-b",
    };

    const settled = await runWhileAccessCardTableLocked({
      prisma,
      minWaiters: 2,
      startRace: () =>
        // Run actors together to expose races and serialization bugs.
        Promise.allSettled([
          postJson(api, token, "/cards", bodyA),
          postJson(api, token, "/cards", bodyB),
        ]),
    });

    const results = settled.map((s) => {
      assert.equal(s.status, "fulfilled", String(s));
      return (s as PromiseFulfilledResult<{ status: number; body: unknown }>)
        .value;
    });
    const ok = results.filter((r) => r.status === 201 || r.status === 200);
    const conflict = results.filter((r) => r.status === 409);
    assert.equal(ok.length, 1, `expected one success, got ${JSON.stringify(results.map((r) => r.status))}`);
    assert.equal(conflict.length, 1, "expected one 409 loser");
    const err = conflict[0]!.body as { error?: string };
    assert.equal(err.error, "conflict");

    assert.equal(await countCardsByCommand(prisma, base.commandId), 1);
    assert.equal(await countGrantsForCommand(prisma, base.commandId), 1);
    const card = await prisma.accessCard.findUnique({
      where: { commandId: base.commandId },
    });
    assert.ok(card);
    assert.equal(await countCardAudits(prisma, "card.issue", [card.id]), 1);
  });
});