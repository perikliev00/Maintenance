/**
 * revokeCard CAS: preserve prior issue history; one revoke audit;
 * concurrent loser 409; control card untouched.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { CardStatus, PrismaClient } from "@prisma/client";
import { assertTestDatabase } from "../assertTestDatabase";
import {
  closeServer,
  listenApp,
  loginBearer,
  postJson,
} from "../httpHarness";
import { waitForBlockedByHolder } from "../sectors/fixtures";
import {
  cleanupCardsWorld,
  countCardAudits,
  createCardsWorld,
  createControlCard,
  staffIssueBody,
  type CardsWorld,
} from "./fixtures";

const prisma = new PrismaClient();

describe("card revoke CAS HTTP", () => {
  let world: CardsWorld;
  let api: string;
  let server: import("node:http").Server;
  let token: string;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
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

  /** Issue via real HTTP path so card.issue history is non-empty. */
  async function issueTargetViaHttp() {
    const body = staffIssueBody(world, { label: `revoke-target-${world.stamp}` });
    const res = await postJson(api, token, "/cards", body);
    assert.equal(res.status, 201);
    const card = res.body as { id: string; status: string };
    const issueAudits = await prisma.auditEvent.findMany({
      where: {
        entityType: "card",
        entityId: card.id,
        action: "card.issue",
      },
      orderBy: { occurredAt: "asc" },
      select: { id: true, action: true, after: true, summary: true },
    });
    assert.ok(
      issueAudits.length >= 1,
      "precondition: issued card must have card.issue history",
    );
    const grants = await prisma.accessGrant.findMany({
      where: { cardId: card.id },
      orderBy: { createdAt: "asc" },
    });
    assert.ok(grants.length >= 1, "precondition: issued card must have grants");
    return { cardId: card.id, issueAudits, grants, commandId: body.commandId };
  }

  async function assertIssueHistoryPreserved(
    cardId: string,
    issueAudits: Array<{ id: string; action: string; after: unknown; summary: string | null }>,
    grantIds: string[],
  ) {
    const afterIssue = await prisma.auditEvent.findMany({
      where: {
        entityType: "card",
        entityId: cardId,
        action: "card.issue",
      },
      orderBy: { occurredAt: "asc" },
      select: { id: true, action: true, after: true, summary: true },
    });
    assert.deepEqual(
      afterIssue.map((a) => a.id),
      issueAudits.map((a) => a.id),
      "prior card.issue history must remain after revoke",
    );
    assert.deepEqual(
      afterIssue.map((a) => ({ after: a.after, summary: a.summary })),
      issueAudits.map((a) => ({ after: a.after, summary: a.summary })),
    );

    const grantsAfter = await prisma.accessGrant.findMany({
      where: { cardId },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    assert.deepEqual(
      grantsAfter.map((g) => g.id).sort(),
      [...grantIds].sort(),
      "grants remain attached after system revoke (no physical reprogram)",
    );
  }

  it("sequential: first revoke ok; second 409; prior history kept; revoke audit=1", async () => {
    const target = await issueTargetViaHttp();
    const control = await createControlCard(prisma, world);
    const grantIds = target.grants.map((g) => g.id);

    const first = await postJson(api, token, `/cards/${target.cardId}/revoke`, {});
    assert.equal(first.status, 200);
    assert.equal(
      (first.body as { status: string }).status,
      CardStatus.revoked,
    );

    await assertIssueHistoryPreserved(
      target.cardId,
      target.issueAudits,
      grantIds,
    );
    assert.equal(
      await countCardAudits(prisma, "card.revoke", [target.cardId]),
      1,
    );

    const second = await postJson(api, token, `/cards/${target.cardId}/revoke`, {});
    assert.equal(second.status, 409);
    const err = second.body as { error?: string };
    assert.equal(err.error, "invalid_state");

    await assertIssueHistoryPreserved(
      target.cardId,
      target.issueAudits,
      grantIds,
    );
    assert.equal(
      await countCardAudits(prisma, "card.revoke", [target.cardId]),
      1,
      "retry must not write a second card.revoke",
    );

    const controlRow = await prisma.accessCard.findUnique({
      where: { id: control.id },
    });
    assert.equal(controlRow?.status, CardStatus.active);
  });

  it("concurrent: FOR UPDATE holder; dual revoke; one success one 409; history kept", async () => {
    const target = await issueTargetViaHttp();
    const control = await createControlCard(prisma, world);
    const grantIds = target.grants.map((g) => g.id);

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let holderPid: number | null = null;
    let lockHeld = false;

    const holder = prisma.$transaction(
      async (tx) => {
        const pidRows = await tx.$queryRaw<{ pid: number }[]>`
          SELECT pg_backend_pid()::int AS pid
        `;
        holderPid = pidRows[0]!.pid;
        await tx.$executeRaw`
          SELECT id FROM "AccessCard" WHERE id = ${target.cardId} FOR UPDATE
        `;
        lockHeld = true;
        await gate;
      },
      { timeout: 60_000, maxWait: 60_000 },
    );

    let p1: Promise<{ status: number; body: unknown }> | undefined;
    let p2: Promise<{ status: number; body: unknown }> | undefined;
    try {
      for (let i = 0; i < 100 && !lockHeld; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(lockHeld && holderPid != null);

      p1 = postJson(api, token, `/cards/${target.cardId}/revoke`, {});
      p2 = postJson(api, token, `/cards/${target.cardId}/revoke`, {});

      const blocked = await waitForBlockedByHolder(prisma, holderPid!, 2, 15_000);
      assert.ok(blocked.length >= 2, `expected >=2 waiters, got ${blocked.length}`);
      assert.ok(!blocked.includes(holderPid!), "holder must not be a waiter");

      release();
      await holder;

      const settled = await Promise.allSettled([p1, p2]);
      const results = settled.map((s) => {
        assert.equal(s.status, "fulfilled", String(s));
        return (s as PromiseFulfilledResult<{ status: number; body: unknown }>)
          .value;
      });
      const ok = results.filter((r) => r.status === 200);
      const conflict = results.filter((r) => r.status === 409);
      assert.equal(ok.length, 1, `statuses=${results.map((r) => r.status)}`);
      assert.equal(conflict.length, 1);
      assert.equal(
        (conflict[0]!.body as { error?: string }).error,
        "invalid_state",
      );

      const row = await prisma.accessCard.findUnique({
        where: { id: target.cardId },
      });
      assert.equal(row?.status, CardStatus.revoked);
      assert.equal(
        await countCardAudits(prisma, "card.revoke", [target.cardId]),
        1,
      );
      await assertIssueHistoryPreserved(
        target.cardId,
        target.issueAudits,
        grantIds,
      );

      const controlRow = await prisma.accessCard.findUnique({
        where: { id: control.id },
      });
      assert.equal(controlRow?.status, CardStatus.active);
    } finally {
      release();
      await holder.catch(() => undefined);
      if (p1 && p2) await Promise.allSettled([p1, p2]);
    }
  });
});
