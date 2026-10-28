/**
 * HTTP: GET /people pagination envelope when `limit` is set; bare array otherwise.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PrismaClient, Role } from "@prisma/client";
import dotenv from "dotenv";
import {
  cleanupEmployeeGraph,
  createEmployeeWithUser,
  type EmployeeUserFixture,
} from "../../tests/fixtures";
import {
  closeServer,
  getJson,
  listenApp,
  loginBearer,
} from "../../tests/httpHarness";
import { ensureDefaultRoleGrants } from "../services/roleGrants";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-secret-for-people-list-http";

const prisma = new PrismaClient();
const PASSWORD = "demo1234";

describe("people list HTTP pagination", () => {
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  let api = "";
  const fixtureIds: string[] = [];
  let ownerActor: EmployeeUserFixture;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await ensureDefaultRoleGrants();
    const stamp = Date.now();
    ownerActor = await createEmployeeWithUser(prisma, {
      fullName: `People List Owner ${stamp}`,
      employeeNumber: `PLO-${stamp}`,
      email: `people.list.owner.${stamp}@test.local`,
      role: Role.owner,
      password: PASSWORD,
    });
    fixtureIds.push(ownerActor.employeeId);
    for (let i = 0; i < 3; i++) {
      const row = await createEmployeeWithUser(prisma, {
        fullName: `People List Row ${stamp}-${i}`,
        employeeNumber: `PLR-${stamp}-${i}`,
        email: `people.list.row.${stamp}.${i}@test.local`,
        role: Role.housekeeper,
        password: PASSWORD,
      });
      fixtureIds.push(row.employeeId);
    }
    ({ server, api } = await listenApp());
  });

  after(async () => {
    if (server) await closeServer(server);
    await cleanupEmployeeGraph(prisma, fixtureIds);
    await prisma.$disconnect();
  });

  it("returns a bare array when limit is omitted", async () => {
    const token = (await loginBearer(api, ownerActor.email, PASSWORD)).token;
    const res = await getJson(api, token, "/people");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  it("returns { items, nextCursor } and pages with cursor when limit is set", async () => {
    const token = (await loginBearer(api, ownerActor.email, PASSWORD)).token;
    const first = await getJson(api, token, "/people?limit=2");
    assert.equal(first.status, 200);
    const page1 = first.body as { items: unknown[]; nextCursor: string | null };
    assert.ok(Array.isArray(page1.items));
    assert.equal(page1.items.length, 2);
    assert.ok(typeof page1.nextCursor === "string" && page1.nextCursor.length > 0);

    const second = await getJson(
      api,
      token,
      `/people?limit=2&cursor=${encodeURIComponent(page1.nextCursor!)}`,
    );
    assert.equal(second.status, 200);
    const page2 = second.body as { items: Array<{ employeeId: string }>; nextCursor: string | null };
    assert.ok(Array.isArray(page2.items));
    assert.ok(page2.items.length >= 1);
    const ids1 = new Set(
      (page1.items as Array<{ employeeId: string }>).map((p) => p.employeeId),
    );
    for (const row of page2.items) {
      assert.equal(ids1.has(row.employeeId), false);
    }
  });

  it("filters blocked accounts by default for invite-style lists", async () => {
    const token = (await loginBearer(api, ownerActor.email, PASSWORD)).token;
    const stamp = Date.now();
    const blocked = await createEmployeeWithUser(prisma, {
      fullName: `People List Blocked ${stamp}`,
      employeeNumber: `PLB-${stamp}`,
      email: `people.list.blocked.${stamp}@test.local`,
      role: Role.housekeeper,
      password: PASSWORD,
    });
    fixtureIds.push(blocked.employeeId);
    await prisma.user.update({
      where: { id: blocked.userId },
      data: { isActive: false },
    });

    const hidden = await getJson(api, token, "/people?limit=100");
    assert.equal(hidden.status, 200);
    const items = (hidden.body as { items: Array<{ employeeId: string }> }).items;
    assert.equal(
      items.some((p) => p.employeeId === blocked.employeeId),
      false,
    );

    const shown = await getJson(
      api,
      token,
      "/people?limit=100&includeInactive=true",
    );
    assert.equal(shown.status, 200);
    const withInactive = (shown.body as { items: Array<{ employeeId: string }> })
      .items;
    assert.equal(
      withInactive.some((p) => p.employeeId === blocked.employeeId),
      true,
    );
  });
});
