// Load isolated P1 test env before any Prisma/DB clients connect.
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, it } from "node:test";
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Shared test fixtures for seeding users, locations, and domain entities.
import { createScopeSmokeFixture, cleanupScopeSmokeFixture, type ScopeSmokeFixture } from "../fixtures";
// HTTP harness to listen an in-process API for request-level tests.
import { closeServer, listenApp, loginBearer } from "../httpHarness";

let fx: ScopeSmokeFixture;
let api: string;
let server: Awaited<ReturnType<typeof listenApp>>["server"];
let token: string;
let extraFloor: string;
let extraBuilding: string;
const ids: string[] = [];
let lateRoom: string;

before(async () => {
  // Refuse to mutate unless connected to the isolated test database.
  await assertTestDatabase(prisma);
  process.env.E2E_DISABLE_RATE_LIMIT = "1";
  fx = await createScopeSmokeFixture(prisma);
  const floor = await prisma.floor.findUniqueOrThrow({ where: { id: fx.floorId } });
  const building = await prisma.building.create({ data: { propertyId: fx.propertyId, code: `PAGE-${randomUUID()}`, name: "Cursor ties" } });
  extraBuilding = building.id;
  extraFloor = (await prisma.floor.create({ data: { buildingId: building.id, number: floor.number, name: "Same sort floor" } })).id;
  for (const kind of ["room", "common_area"] as const) {
    const rows = Array.from({ length: 501 }, (_, i) => ({ id: randomUUID(), floorId: fx.floorId, number: `${kind === "room" ? "PAGE" : "COMMON"}-${String(i).padStart(4, "0")}`, kind }));
    // Room numbers are unique per physical floor, so use the other floor for common areas.
    if (kind === "common_area") for (const row of rows) row.floorId = extraFloor;
    ids.push(...rows.map(r => r.id));
    await prisma.location.createMany({ data: rows });
    if (kind === "room") lateRoom = rows[500]!.id;
  }
  // Identical floor number + room number across buildings exercises the id tie-breaker.
  const tie = await prisma.location.create({ data: { floorId: extraFloor, number: "PAGE-0000", kind: "room" } });
  ids.push(tie.id);
  ids.push((await prisma.location.create({ data: { floorId: fx.floorId, number: "COMMON-0000", kind: "common_area" } })).id);
  await prisma.sectorLocation.createMany({ data: ids.map(locationId => ({ sectorId: fx.sectorAId, locationId })) });
  const task = await prisma.cleaningTask.create({ data: { locationId: lateRoom, hotelDate: new Date("2026-01-01"), sectorId: fx.sectorAId, assignedEmployeeId: fx.housekeeper.employeeId, status: "in_progress" } });
  await prisma.cleaningSession.create({ data: { taskId: task.id, employeeId: fx.housekeeper.employeeId, startedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), startCommandId: randomUUID(), status: "running" } });
  ({ api, server } = await listenApp());
  token = (await loginBearer(api, fx.supervisorA.email, fx.password)).token;
});

after(async () => {
  if (server) await closeServer(server);
  if (ids.length) {
    await prisma.cleaningSession.deleteMany({ where: { task: { locationId: { in: ids } } } });
    await prisma.cleaningTask.deleteMany({ where: { locationId: { in: ids } } });
    await prisma.sectorLocation.deleteMany({ where: { locationId: { in: ids } } });
    await prisma.location.deleteMany({ where: { id: { in: ids } } });
  }
  if (extraFloor) await prisma.floor.delete({ where: { id: extraFloor } });
  if (extraBuilding) await prisma.building.delete({ where: { id: extraBuilding } });
  if (fx) await cleanupScopeSmokeFixture(prisma, fx);
  await prisma.$disconnect();
});

for (const [path, kind] of [["/rooms", "room"], ["/common-areas", "common_area"]] as const) {
  // Case: ${path}: pages beyond 500 without gaps, duplicates or foreign-sector rows.
  it(`${path}: pages beyond 500 without gaps, duplicates or foreign-sector rows`, async () => {
    const headers = { Authorization: `Bearer ${token}`, Origin: (process.env.WEB_ORIGIN ?? "http://localhost:5173").split(",")[0]! };
    const first = await fetch(`${api}${path}`, { headers });
    assert.equal(first.status, 200);
    const firstRows = await first.json() as Array<{ id: string }>;
    assert.equal(firstRows.length, 500);
    assert.equal(first.headers.get("X-Result-Truncated"), "1");
    assert.ok(first.headers.get("X-Next-Cursor"));
    assert.match(first.headers.get("Access-Control-Expose-Headers") ?? "", /X-Next-Cursor/i);
    const expected = await prisma.location.findMany({ where: { catalogStatus: "active", kind, sectorMembership: { sectorId: fx.sectorAId } }, orderBy: [{ floor: { number: "asc" } }, { number: "asc" }, { id: "asc" }], select: { id: true } });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      // Issue HTTP request against the in-process or E2E API.
      const res: Response = await fetch(`${api}${path}?limit=173${cursor ? `&cursor=${cursor}` : ""}`, { headers });
      assert.equal(res.status, 200);
      seen.push(...((await res.json()) as Array<{ id: string }>).map(r => r.id));
      cursor = res.headers.get("X-Next-Cursor");
      assert.ok(seen.length <= expected.length);
    } while (cursor);
    assert.deepEqual(seen, expected.map(r => r.id));
    assert.equal(new Set(seen).size, seen.length);
    assert.ok(!seen.includes(fx.locBId));
    if (kind === "room") {
      assert.ok(!firstRows.some(r => r.id === lateRoom));
      assert.ok(seen.includes(lateRoom));
      const overdue = await fetch(`${api}/cleaning/sessions/review`, { headers });
      assert.equal(overdue.status, 200);
      assert.ok(((await overdue.json()) as Array<{ room: { id: string } }>).some(s => s.room.id === lateRoom));
    }
    const invalid = await fetch(`${api}${path}?cursor=not-a-valid-cursor`, { headers });
    assert.equal(invalid.status, 400);
  });
}

// Case: continuation rechecks current supervisor scope and survives archiving its preceding row.
it("continuation rechecks current supervisor scope and survives archiving its preceding row", async () => {
  const headers = { Authorization: `Bearer ${token}` };
  const first = await fetch(`${api}/rooms?limit=2`, { headers });
  const page = await first.json() as Array<{ id: string }>;
  const cursor = first.headers.get("X-Next-Cursor");
  assert.ok(cursor);
  const boundary = page[page.length - 1]!.id;
  await prisma.location.update({ where: { id: boundary }, data: { catalogStatus: "archived" } });
  try {
    const next = await fetch(`${api}/rooms?limit=2&cursor=${cursor}`, { headers });
    assert.equal(next.status, 200);
    const rows = await next.json() as Array<{ id: string }>;
    assert.equal(rows.length, 2);
    assert.ok(rows.every(r => !page.some(previous => previous.id === r.id)));
    await prisma.sector.update({ where: { id: fx.sectorAId }, data: { primarySupervisorEmployeeId: fx.supervisorB.employeeId } });
    try {
      const denied = await fetch(`${api}/rooms?limit=2&cursor=${cursor}`, { headers });
      assert.equal(denied.status, 200);
      assert.deepEqual(await denied.json(), []);
      assert.equal(denied.headers.get("X-Next-Cursor"), null);
    } finally {
      await prisma.sector.update({ where: { id: fx.sectorAId }, data: { primarySupervisorEmployeeId: fx.supervisorA.employeeId } });
    }
  } finally {
    await prisma.location.update({ where: { id: boundary }, data: { catalogStatus: "active" } });
  }
});
