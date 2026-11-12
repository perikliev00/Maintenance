/**
 * HTTP: GET /people pagination envelope when `limit` is set; bare array otherwise.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PrismaClient, Role } from "@prisma/client";
import dotenv from "dotenv";
// Continue named import list.
import {
  // Bring cleanupEmployeeGraph into scope from the import.
  cleanupEmployeeGraph,
  // Bring createEmployeeWithUser into scope from the import.
  createEmployeeWithUser,
  type EmployeeUserFixture,
} from "../../tests/fixtures";
// Continue named import list.
import {
  // Bring closeServer into scope from the import.
  closeServer,
  // Bring getJson into scope from the import.
  getJson,
  // Bring listenApp into scope from the import.
  listenApp,
  // Bring loginBearer into scope from the import.
  loginBearer,
} from "../../tests/httpHarness";
// Import local module ../services/roleGrants.
import { ensureDefaultRoleGrants } from "../services/roleGrants";

dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
  override: true,
});
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-secret-for-people-list-http";

const prisma = new PrismaClient();
const PASSWORD = "demo1234";

// Test suite grouping related cases.
describe("people list HTTP pagination", () => {
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Mutable api updated as the flow proceeds.
  let api = "";
  const fixtureIds: string[] = [];
  let ownerActor: EmployeeUserFixture;

  // Setup hook run before tests.
  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Await side-effecting async work.
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
    // Iterate to process each item.
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

  // Teardown hook run after tests.
  after(async () => {
    // Branch when this condition holds.
    if (server) await closeServer(server);
    // Await side-effecting async work.
    await cleanupEmployeeGraph(prisma, fixtureIds);
    // Await side-effecting async work.
    await prisma.$disconnect();
  });

  // Single test case asserting expected behavior.
  it("returns a bare array when limit is omitted", async () => {
    const token = (await loginBearer(api, ownerActor.email, PASSWORD)).token;
    const res = await getJson(api, token, "/people");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
  });

  // Single test case asserting expected behavior.
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
    // Iterate to process each item.
    for (const row of page2.items) {
      assert.equal(ids1.has(row.employeeId), false);
    }
  });

  // Single test case asserting expected behavior.
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
    // Await side-effecting async work.
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
      // Pass string literal argument.
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
