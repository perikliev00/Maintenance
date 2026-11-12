// Load isolated P1 test env before any Prisma/DB clients connect.
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Import bindings from node:crypto.
import { randomUUID } from "node:crypto";
// Node test runner and strict assertions for API suite checks.
import { after, before, it } from "node:test";
// Import bindings from ../../src/db.
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Shared test fixtures for seeding users, locations, and domain entities.
import { createScopeSmokeFixture, cleanupScopeSmokeFixture, type ScopeSmokeFixture } from "../fixtures";
// HTTP harness to listen an in-process API for request-level tests.
import { closeServer, listenApp, loginBearer } from "../httpHarness";

// Execute the next setup or assertion step for this scenario.
let fx: ScopeSmokeFixture;
// Execute the next setup or assertion step for this scenario.
let api: string;
// Execute the next setup or assertion step for this scenario.
let server: Awaited<ReturnType<typeof listenApp>>["server"];
// Execute the next setup or assertion step for this scenario.
let token: string;
// Execute the next setup or assertion step for this scenario.
let extraFloor: string;
// Execute the next setup or assertion step for this scenario.
let extraBuilding: string;
// Execute the next setup or assertion step for this scenario.
const ids: string[] = [];
// Execute the next setup or assertion step for this scenario.
let lateRoom: string;

// Arrange shared preconditions before cases run.
before(async () => {
  // Refuse to mutate unless connected to the isolated test database.
  await assertTestDatabase(prisma);
  // Override env for isolation, rate-limit disable, or scheduler quieting.
  process.env.E2E_DISABLE_RATE_LIMIT = "1";
  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  fx = await createScopeSmokeFixture(prisma);
  // floor: synchronize actors so the race window is observable.
  const floor = await prisma.floor.findUniqueOrThrow({ where: { id: fx.floorId } });
  // building: unique stamp so parallel runs do not collide.
  const building = await prisma.building.create({ data: { propertyId: fx.propertyId, code: `PAGE-${randomUUID()}`, name: "Cursor ties" } });
  // Execute the next setup or assertion step for this scenario.
  extraBuilding = building.id;
  // Await async work before asserting or releasing locks.
  extraFloor = (await prisma.floor.create({ data: { buildingId: building.id, number: floor.number, name: "Same sort floor" } })).id;
  // Iterate to cover variants or wait until a condition holds.
  for (const kind of ["room", "common_area"] as const) {
    // rows: unique stamp so parallel runs do not collide.
    const rows = Array.from({ length: 501 }, (_, i) => ({ id: randomUUID(), floorId: fx.floorId, number: `${kind === "room" ? "PAGE" : "COMMON"}-${String(i).padStart(4, "0")}`, kind }));
    // Room numbers are unique per physical floor, so use the other floor for common areas.
    if (kind === "common_area") for (const row of rows) row.floorId = extraFloor;
    // Execute the next setup or assertion step for this scenario.
    ids.push(...rows.map(r => r.id));
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await prisma.location.createMany({ data: rows });
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (kind === "room") lateRoom = rows[500]!.id;
  }
  // Identical floor number + room number across buildings exercises the id tie-breaker.
  const tie = await prisma.location.create({ data: { floorId: extraFloor, number: "PAGE-0000", kind: "room" } });
  // Execute the next setup or assertion step for this scenario.
  ids.push(tie.id);
  // Await async work before asserting or releasing locks.
  ids.push((await prisma.location.create({ data: { floorId: fx.floorId, number: "COMMON-0000", kind: "common_area" } })).id);
  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  await prisma.sectorLocation.createMany({ data: ids.map(locationId => ({ sectorId: fx.sectorAId, locationId })) });
  // task: seeded entity required before the mutation under test.
  const task = await prisma.cleaningTask.create({ data: { locationId: lateRoom, hotelDate: new Date("2026-01-01"), sectorId: fx.sectorAId, assignedEmployeeId: fx.housekeeper.employeeId, status: "in_progress" } });
  // Await async work before asserting or releasing locks.
  await prisma.cleaningSession.create({ data: { taskId: task.id, employeeId: fx.housekeeper.employeeId, startedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), startCommandId: randomUUID(), status: "running" } });
  // Start or stop the in-process API server for this suite.
  ({ api, server } = await listenApp());
  // Await async work before asserting or releasing locks.
  token = (await loginBearer(api, fx.supervisorA.email, fx.password)).token;
});

// Release servers/DB clients so later suites stay isolated.
after(async () => {
  // Guard optional cleanup or alternate assertion paths.
  if (server) await closeServer(server);
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (ids.length) {
    // Await async work before asserting or releasing locks.
    await prisma.cleaningSession.deleteMany({ where: { task: { locationId: { in: ids } } } });
    // Await async work before asserting or releasing locks.
    await prisma.cleaningTask.deleteMany({ where: { locationId: { in: ids } } });
    // Await async work before asserting or releasing locks.
    await prisma.sectorLocation.deleteMany({ where: { locationId: { in: ids } } });
    // Await async work before asserting or releasing locks.
    await prisma.location.deleteMany({ where: { id: { in: ids } } });
  }
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (extraFloor) await prisma.floor.delete({ where: { id: extraFloor } });
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (extraBuilding) await prisma.building.delete({ where: { id: extraBuilding } });
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (fx) await cleanupScopeSmokeFixture(prisma, fx);
  // Disconnect Prisma so the pool does not leak across suites.
  await prisma.$disconnect();
});

// Iterate to cover variants or wait until a condition holds.
for (const [path, kind] of [["/rooms", "room"], ["/common-areas", "common_area"]] as const) {
  // Case: ${path}: pages beyond 500 without gaps, duplicates or foreign-sector rows.
  it(`${path}: pages beyond 500 without gaps, duplicates or foreign-sector rows`, async () => {
    // Bind headers for later setup or assertions in this scope.
    const headers = { Authorization: `Bearer ${token}`, Origin: (process.env.WEB_ORIGIN ?? "http://localhost:5173").split(",")[0]! };
    // first: HTTP response captured for status/body checks.
    const first = await fetch(`${api}${path}`, { headers });
    // Assert HTTP status matches the contract for this path.
    assert.equal(first.status, 200);
    // firstRows: synchronize actors so the race window is observable.
    const firstRows = await first.json() as Array<{ id: string }>;
    // Assert collection size matches the expected post-condition.
    assert.equal(firstRows.length, 500);
    // Assert the observed value matches the intended post-condition.
    assert.equal(first.headers.get("X-Result-Truncated"), "1");
    // Assert the observed value matches the intended post-condition.
    assert.ok(first.headers.get("X-Next-Cursor"));
    // Assert the observed value matches the intended post-condition.
    assert.match(first.headers.get("Access-Control-Expose-Headers") ?? "", /X-Next-Cursor/i);
    // expected: synchronize actors so the race window is observable.
    const expected = await prisma.location.findMany({ where: { catalogStatus: "active", kind, sectorMembership: { sectorId: fx.sectorAId } }, orderBy: [{ floor: { number: "asc" } }, { number: "asc" }, { id: "asc" }], select: { id: true } });
    // Execute the next setup or assertion step for this scenario.
    const seen: string[] = [];
    // Pagination step for list/contract coverage.
    let cursor: string | null = null;
    // Execute the next setup or assertion step for this scenario.
    do {
      // Issue HTTP request against the in-process or E2E API.
      const res: Response = await fetch(`${api}${path}?limit=173${cursor ? `&cursor=${cursor}` : ""}`, { headers });
      // Assert HTTP status matches the contract for this path.
      assert.equal(res.status, 200);
      // Await async work before asserting or releasing locks.
      seen.push(...((await res.json()) as Array<{ id: string }>).map(r => r.id));
      // Pagination step for list/contract coverage.
      cursor = res.headers.get("X-Next-Cursor");
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.ok(seen.length <= expected.length);
    // Pagination step for list/contract coverage.
    } while (cursor);
    // Assert we are on the isolated test DB, not a seed/prod database.
    assert.deepEqual(seen, expected.map(r => r.id));
    // Assert collection size matches the expected post-condition.
    assert.equal(new Set(seen).size, seen.length);
    // Assert the observed value matches the intended post-condition.
    assert.ok(!seen.includes(fx.locBId));
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (kind === "room") {
      // Assert the observed value matches the intended post-condition.
      assert.ok(!firstRows.some(r => r.id === lateRoom));
      // Assert the observed value matches the intended post-condition.
      assert.ok(seen.includes(lateRoom));
      // overdue: HTTP response captured for status/body checks.
      const overdue = await fetch(`${api}/cleaning/sessions/review`, { headers });
      // Assert HTTP status matches the contract for this path.
      assert.equal(overdue.status, 200);
      // Assert the observed value matches the intended post-condition.
      assert.ok(((await overdue.json()) as Array<{ room: { id: string } }>).some(s => s.room.id === lateRoom));
    }
    // invalid: unique stamp so parallel runs do not collide.
    const invalid = await fetch(`${api}${path}?cursor=not-a-valid-cursor`, { headers });
    // Assert HTTP status matches the contract for this path.
    assert.equal(invalid.status, 400);
  });
}

// Case: continuation rechecks current supervisor scope and survives archiving its preceding row.
it("continuation rechecks current supervisor scope and survives archiving its preceding row", async () => {
  // Bind headers for later setup or assertions in this scope.
  const headers = { Authorization: `Bearer ${token}` };
  // first: HTTP response captured for status/body checks.
  const first = await fetch(`${api}/rooms?limit=2`, { headers });
  // page: synchronize actors so the race window is observable.
  const page = await first.json() as Array<{ id: string }>;
  // Bind cursor for later setup or assertions in this scope.
  const cursor = first.headers.get("X-Next-Cursor");
  // Assert the observed value matches the intended post-condition.
  assert.ok(cursor);
  // Bind boundary for later setup or assertions in this scope.
  const boundary = page[page.length - 1]!.id;
  // Await async work before asserting or releasing locks.
  await prisma.location.update({ where: { id: boundary }, data: { catalogStatus: "archived" } });
  // Try path where partial failure must not leak suite state.
  try {
    // next: HTTP response captured for status/body checks.
    const next = await fetch(`${api}/rooms?limit=2&cursor=${cursor}`, { headers });
    // Assert HTTP status matches the contract for this path.
    assert.equal(next.status, 200);
    // rows: synchronize actors so the race window is observable.
    const rows = await next.json() as Array<{ id: string }>;
    // Assert collection size matches the expected post-condition.
    assert.equal(rows.length, 2);
    // Assert the observed value matches the intended post-condition.
    assert.ok(rows.every(r => !page.some(previous => previous.id === r.id)));
    // Await async work before asserting or releasing locks.
    await prisma.sector.update({ where: { id: fx.sectorAId }, data: { primarySupervisorEmployeeId: fx.supervisorB.employeeId } });
    // Try path where partial failure must not leak suite state.
    try {
      // denied: HTTP response captured for status/body checks.
      const denied = await fetch(`${api}/rooms?limit=2&cursor=${cursor}`, { headers });
      // Assert HTTP status matches the contract for this path.
      assert.equal(denied.status, 200);
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(await denied.json(), []);
      // Assert the observed value matches the intended post-condition.
      assert.equal(denied.headers.get("X-Next-Cursor"), null);
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await prisma.sector.update({ where: { id: fx.sectorAId }, data: { primarySupervisorEmployeeId: fx.supervisorA.employeeId } });
    }
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Await async work before asserting or releasing locks.
    await prisma.location.update({ where: { id: boundary }, data: { catalogStatus: "active" } });
  }
});
