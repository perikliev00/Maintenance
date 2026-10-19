/**
 * P1-79 / P1-80 / P1-81 — card issue validation via HTTP.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { CardType, PrismaClient } from "@prisma/client";
import { assertTestDatabase } from "../assertTestDatabase";
import {
  closeServer,
  listenApp,
  loginBearer,
  postJson,
} from "../httpHarness";
import {
  cleanupCardsWorld,
  createCardsWorld,
  defaultValidity,
  guestIssueBody,
  masterIssueBody,
  staffIssueBody,
  worldCardSnapshot,
  type CardsWorld,
} from "./fixtures";

const prisma = new PrismaClient();

describe("card issue validation HTTP (P1-79–81)", () => {
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

  async function assertNoPartial(before: Awaited<ReturnType<typeof worldCardSnapshot>>) {
    const after = await worldCardSnapshot(prisma, world);
    assert.equal(after.cardCount, before.cardCount, "no partial AccessCard");
    assert.equal(after.grantCount, before.grantCount, "no partial AccessGrant");
    assert.equal(after.auditCount, before.auditCount, "no partial audit");
  }

  it("P1-79 guest+room → 201; employeeId null; grant on room", async () => {
    const body = guestIssueBody(world);
    const res = await postJson(api, token, "/cards", body);
    assert.equal(res.status, 201);
    const card = res.body as {
      id: string;
      employeeId: string | null;
      cardType: string;
      grants: Array<{ locationId: string | null }>;
    };
    assert.equal(card.cardType, CardType.guest);
    assert.equal(card.employeeId, null);
    assert.equal(card.grants.length, 1);
    assert.equal(card.grants[0]!.locationId, world.roomId);
  });

  it("P1-79 guest+common_area → 400; no partial rows", async () => {
    const before = await worldCardSnapshot(prisma, world);
    const res = await postJson(
      api,
      token,
      "/cards",
      guestIssueBody(world, { locationId: world.commonAreaId }),
    );
    assert.equal(res.status, 400);
    await assertNoPartial(before);
  });

  it("P1-79 guest missing location → 400; no partial rows", async () => {
    const before = await worldCardSnapshot(prisma, world);
    const res = await postJson(
      api,
      token,
      "/cards",
      guestIssueBody(world, { locationId: null }),
    );
    assert.equal(res.status, 400);
    await assertNoPartial(before);
  });

  it("P1-79 guest+nonexistent locationId → 404; no partial rows", async () => {
    const before = await worldCardSnapshot(prisma, world);
    const res = await postJson(
      api,
      token,
      "/cards",
      guestIssueBody(world, {
        locationId: "loc_does_not_exist_p179_xxxx",
      }),
    );
    assert.equal(res.status, 404);
    const err = res.body as { error?: string; message?: string };
    assert.equal(err.error, "not_found");
    assert.match(err.message ?? "", /location/i);
    await assertNoPartial(before);
  });

  it("P1-79 guest+employeeId → 400; no partial rows", async () => {
    const before = await worldCardSnapshot(prisma, world);
    const res = await postJson(
      api,
      token,
      "/cards",
      guestIssueBody(world, { employeeId: world.holderA.employeeId }),
    );
    assert.equal(res.status, 400);
    await assertNoPartial(before);
  });

  it("P1-80 staff without holder → 400", async () => {
    const before = await worldCardSnapshot(prisma, world);
    const res = await postJson(
      api,
      token,
      "/cards",
      staffIssueBody(world, { employeeId: null }),
    );
    assert.equal(res.status, 400);
    await assertNoPartial(before);
  });

  it("P1-80 unknown employee → 404; no partial rows", async () => {
    const before = await worldCardSnapshot(prisma, world);
    const res = await postJson(
      api,
      token,
      "/cards",
      staffIssueBody(world, { employeeId: "emp_does_not_exist_xxx" }),
    );
    assert.equal(res.status, 404);
    await assertNoPartial(before);
  });

  it("P1-80 master+location → 400; no partial rows", async () => {
    const before = await worldCardSnapshot(prisma, world);
    const res = await postJson(
      api,
      token,
      "/cards",
      masterIssueBody(world, { locationId: world.roomId }),
    );
    assert.equal(res.status, 400);
    await assertNoPartial(before);
  });

  it("P1-80 master null location → 201; grant.locationId null", async () => {
    const res = await postJson(api, token, "/cards", masterIssueBody(world));
    assert.equal(res.status, 201);
    const card = res.body as {
      cardType: string;
      grants: Array<{ locationId: string | null }>;
    };
    assert.equal(card.cardType, CardType.master);
    assert.equal(card.grants.length, 1);
    assert.equal(card.grants[0]!.locationId, null);
  });

  it("P1-81 until < from → 400; snapshot unchanged", async () => {
    const before = await worldCardSnapshot(prisma, world);
    const from = "2026-06-01T12:00:00.000Z";
    const until = "2026-06-01T11:00:00.000Z";
    const res = await postJson(
      api,
      token,
      "/cards",
      staffIssueBody(world, { validFrom: from, validUntil: until }),
    );
    assert.equal(res.status, 400);
    await assertNoPartial(before);
  });

  it("P1-81 until === from → 400; snapshot unchanged", async () => {
    const before = await worldCardSnapshot(prisma, world);
    const t = "2026-06-01T12:00:00.000Z";
    const res = await postJson(
      api,
      token,
      "/cards",
      staffIssueBody(world, { validFrom: t, validUntil: t }),
    );
    assert.equal(res.status, 400);
    await assertNoPartial(before);
  });

  it("P1-81 invalid datetime strings → 400 via Zod; no partial", async () => {
    const before = await worldCardSnapshot(prisma, world);
    const v = defaultValidity();
    const badFrom = await postJson(
      api,
      token,
      "/cards",
      staffIssueBody(world, { validFrom: "not-a-date", validUntil: v.validUntil }),
    );
    assert.equal(badFrom.status, 400);
    const badUntil = await postJson(
      api,
      token,
      "/cards",
      staffIssueBody(world, {
        validFrom: v.validFrom,
        validUntil: "2026-06-01 12:00:00",
      }),
    );
    assert.equal(badUntil.status, 400);
    await assertNoPartial(before);
  });

  it("P1-81 +1s boundary OK → 201", async () => {
    const from = new Date("2026-06-01T10:00:00.000Z");
    const until = new Date(from.getTime() + 1000);
    const res = await postJson(
      api,
      token,
      "/cards",
      staffIssueBody(world, {
        validFrom: from.toISOString(),
        validUntil: until.toISOString(),
      }),
    );
    assert.equal(res.status, 201);
  });
});