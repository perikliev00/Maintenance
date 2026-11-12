/**
 * HTTP: GET /people pagination envelope when `limit` is set; bare array otherwise.
 */
import assert from "node:assert/strict";
// Import dependency node:path.
import path from "node:path";
// Import dependency node:test.
import { after, before, describe, it } from "node:test";
// Import dependency @prisma/client.
import { PrismaClient, Role } from "@prisma/client";
// Import dependency dotenv.
import dotenv from "dotenv";
// Continue named import list.
import {
  // Bring cleanupEmployeeGraph into scope from the import.
  cleanupEmployeeGraph,
  // Bring createEmployeeWithUser into scope from the import.
  createEmployeeWithUser,
  // Arrange or act for this test case.
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

// Arrange or act for this test case.
dotenv.config({
  // Provide path for the object/call below.
  path: path.resolve(__dirname, "../../.env"),
  // Provide override for the object/call below.
  override: true,
});
// Arrange or act for this test case.
process.env.JWT_SECRET =
  // Arrange or act for this test case.
  process.env.JWT_SECRET || "test-secret-for-people-list-http";

// Bind prisma for use in the handler below.
const prisma = new PrismaClient();
// Bind PASSWORD for use in the handler below.
const PASSWORD = "demo1234";

// Test suite grouping related cases.
describe("people list HTTP pagination", () => {
  // Arrange or act for this test case.
  let server: Awaited<ReturnType<typeof listenApp>>["server"];
  // Mutable api updated as the flow proceeds.
  let api = "";
  // Arrange or act for this test case.
  const fixtureIds: string[] = [];
  // Arrange or act for this test case.
  let ownerActor: EmployeeUserFixture;

  // Setup hook run before tests.
  before(async () => {
    // Assert expected outcome for this case.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Await side-effecting async work.
    await ensureDefaultRoleGrants();
    // Bind stamp for use in the handler below.
    const stamp = Date.now();
    // Arrange or act for this test case.
    ownerActor = await createEmployeeWithUser(prisma, {
      // Provide fullName for the object/call below.
      fullName: `People List Owner ${stamp}`,
      // Provide employeeNumber for the object/call below.
      employeeNumber: `PLO-${stamp}`,
      // Provide email for the object/call below.
      email: `people.list.owner.${stamp}@test.local`,
      // Provide role for the object/call below.
      role: Role.owner,
      // Provide password for the object/call below.
      password: PASSWORD,
    });
    // Arrange or act for this test case.
    fixtureIds.push(ownerActor.employeeId);
    // Iterate to process each item.
    for (let i = 0; i < 3; i++) {
      // Await async work into row.
      const row = await createEmployeeWithUser(prisma, {
        // Provide fullName for the object/call below.
        fullName: `People List Row ${stamp}-${i}`,
        // Provide employeeNumber for the object/call below.
        employeeNumber: `PLR-${stamp}-${i}`,
        // Provide email for the object/call below.
        email: `people.list.row.${stamp}.${i}@test.local`,
        // Provide role for the object/call below.
        role: Role.housekeeper,
        // Provide password for the object/call below.
        password: PASSWORD,
      });
      // Arrange or act for this test case.
      fixtureIds.push(row.employeeId);
    }
    // Arrange or act for this test case.
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
    // Bind token for use in the handler below.
    const token = (await loginBearer(api, ownerActor.email, PASSWORD)).token;
    // Await async work into res.
    const res = await getJson(api, token, "/people");
    // Assert expected outcome for this case.
    assert.equal(res.status, 200);
    // Assert expected outcome for this case.
    assert.ok(Array.isArray(res.body));
  });

  // Single test case asserting expected behavior.
  it("returns { items, nextCursor } and pages with cursor when limit is set", async () => {
    // Bind token for use in the handler below.
    const token = (await loginBearer(api, ownerActor.email, PASSWORD)).token;
    // Await async work into first.
    const first = await getJson(api, token, "/people?limit=2");
    // Assert expected outcome for this case.
    assert.equal(first.status, 200);
    // Bind page1 for use in the handler below.
    const page1 = first.body as { items: unknown[]; nextCursor: string | null };
    // Assert expected outcome for this case.
    assert.ok(Array.isArray(page1.items));
    // Assert expected outcome for this case.
    assert.equal(page1.items.length, 2);
    // Assert expected outcome for this case.
    assert.ok(typeof page1.nextCursor === "string" && page1.nextCursor.length > 0);

    // Await async work into second.
    const second = await getJson(
      // Pass api through.
      api,
      // Pass token through.
      token,
      // Arrange or act for this test case.
      `/people?limit=2&cursor=${encodeURIComponent(page1.nextCursor!)}`,
    );
    // Assert expected outcome for this case.
    assert.equal(second.status, 200);
    // Bind page2 for use in the handler below.
    const page2 = second.body as { items: Array<{ employeeId: string }>; nextCursor: string | null };
    // Assert expected outcome for this case.
    assert.ok(Array.isArray(page2.items));
    // Assert expected outcome for this case.
    assert.ok(page2.items.length >= 1);
    // Bind ids1 for use in the handler below.
    const ids1 = new Set(
      // Arrange or act for this test case.
      (page1.items as Array<{ employeeId: string }>).map((p) => p.employeeId),
    );
    // Iterate to process each item.
    for (const row of page2.items) {
      // Assert expected outcome for this case.
      assert.equal(ids1.has(row.employeeId), false);
    }
  });

  // Single test case asserting expected behavior.
  it("filters blocked accounts by default for invite-style lists", async () => {
    // Bind token for use in the handler below.
    const token = (await loginBearer(api, ownerActor.email, PASSWORD)).token;
    // Bind stamp for use in the handler below.
    const stamp = Date.now();
    // Await async work into blocked.
    const blocked = await createEmployeeWithUser(prisma, {
      // Provide fullName for the object/call below.
      fullName: `People List Blocked ${stamp}`,
      // Provide employeeNumber for the object/call below.
      employeeNumber: `PLB-${stamp}`,
      // Provide email for the object/call below.
      email: `people.list.blocked.${stamp}@test.local`,
      // Provide role for the object/call below.
      role: Role.housekeeper,
      // Provide password for the object/call below.
      password: PASSWORD,
    });
    // Arrange or act for this test case.
    fixtureIds.push(blocked.employeeId);
    // Await side-effecting async work.
    await prisma.user.update({
      // Provide where for the object/call below.
      where: { id: blocked.userId },
      // Provide data for the object/call below.
      data: { isActive: false },
    });

    // Await async work into hidden.
    const hidden = await getJson(api, token, "/people?limit=100");
    // Assert expected outcome for this case.
    assert.equal(hidden.status, 200);
    // Bind items for use in the handler below.
    const items = (hidden.body as { items: Array<{ employeeId: string }> }).items;
    // Assert expected outcome for this case.
    assert.equal(
      // Arrange or act for this test case.
      items.some((p) => p.employeeId === blocked.employeeId),
      // Pass false through.
      false,
    );

    // Await async work into shown.
    const shown = await getJson(
      // Pass api through.
      api,
      // Pass token through.
      token,
      // Pass string literal argument.
      "/people?limit=100&includeInactive=true",
    );
    // Assert expected outcome for this case.
    assert.equal(shown.status, 200);
    // Bind withInactive for use in the handler below.
    const withInactive = (shown.body as { items: Array<{ employeeId: string }> })
      // Arrange or act for this test case.
      .items;
    // Assert expected outcome for this case.
    assert.equal(
      // Arrange or act for this test case.
      withInactive.some((p) => p.employeeId === blocked.employeeId),
      // Pass true through.
      true,
    );
  });
});
