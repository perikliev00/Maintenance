/**
 * b — list cursor drain + CSV export for 1205 same-day intervals.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, describe, it } from "node:test";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  AttendanceIntervalStatus,
  // Execute the next setup or assertion step for this scenario.
  PrismaClient,
  // Execute the next setup or assertion step for this scenario.
  Role,
// Execute the next setup or assertion step for this scenario.
} from "@prisma/client";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// Import module bindings used by this suite.
import {
  // Start or stop the in-process API server for this suite.
  closeServer,
  // Execute the next setup or assertion step for this scenario.
  getJson,
  // Execute the next setup or assertion step for this scenario.
  listenApp,
  // Session/CSRF step exercising auth lifecycle.
  loginBearer,
// Execute the next setup or assertion step for this scenario.
} from "../httpHarness";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  ATT_PASSWORD,
  // Execute the next setup or assertion step for this scenario.
  cleanupAttendanceWorld,
  // Execute the next setup or assertion step for this scenario.
  createAttendanceWorld,
  // Execute the next setup or assertion step for this scenario.
  ensureActionGrant,
  // Shape AttendanceWorld documents the fixture/response fields this suite touches.
  type AttendanceWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();
// Bind N for later setup or assertions in this scope.
const N = 1205;
// Bind HOTEL_DATE for later setup or assertions in this scope.
const HOTEL_DATE = new Date("2026-10-15T00:00:00.000Z");
// Bind STARTED_AT for later setup or assertions in this scope.
const STARTED_AT = new Date("2026-10-15T08:00:00.000Z");

// Suite: attendance reports pagination HTTP/DB.
describe("attendance reports pagination HTTP/DB", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: AttendanceWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: import("node:http").Server;
  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  let seedIds: string[] = [];
  // Seed prerequisite rows so the mutation under test has a realistic baseline.
  let seedEndedAtIso: string[] = [];
  // Execute the next setup or assertion step for this scenario.
  let negSepIds: string[] = [];
  // Execute the next setup or assertion step for this scenario.
  let negCtrlIds: string[] = [];

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createAttendanceWorld(prisma);
    // Await async work before asserting or releasing locks.
    await ensureActionGrant(prisma, Role.manager, "attendance.view");
    // Start or stop the in-process API server for this suite.
    ({ server, api } = await listenApp());

    // Bind emp for later setup or assertions in this scope.
    const emp = world.technician.employeeId;
    // Execute the next setup or assertion step for this scenario.
    const rows: Array<{
      // Execute the next setup or assertion step for this scenario.
      employeeId: string;
      // Execute the next setup or assertion step for this scenario.
      hotelDate: Date;
      // Execute the next setup or assertion step for this scenario.
      startedAt: Date;
      // Execute the next setup or assertion step for this scenario.
      endedAt: Date;
      // Execute the next setup or assertion step for this scenario.
      breakMinutes: number;
      // Execute the next setup or assertion step for this scenario.
      workedMinutes: number;
      // Fixture field status for the seeded actor/entity.
      status: typeof AttendanceIntervalStatus.closed;
      // Execute the next setup or assertion step for this scenario.
      anomalyFlags: string[];
    // Execute the next setup or assertion step for this scenario.
    }> = [];
    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let i = 0; i < N; i += 1) {
      // Bind endedAt for later setup or assertions in this scope.
      const endedAt = new Date(STARTED_AT.getTime() + (i + 1) * 60_000);
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      seedEndedAtIso.push(endedAt.toISOString());
      // Execute the next setup or assertion step for this scenario.
      rows.push({
        // Execute the next setup or assertion step for this scenario.
        employeeId: emp,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: HOTEL_DATE,
        // Execute the next setup or assertion step for this scenario.
        startedAt: STARTED_AT,
        // Execute the next setup or assertion step for this scenario.
        endedAt,
        // Execute the next setup or assertion step for this scenario.
        breakMinutes: 0,
        // Execute the next setup or assertion step for this scenario.
        workedMinutes: i + 1,
        // Fixture field status for the seeded actor/entity.
        status: AttendanceIntervalStatus.closed,
        // Execute the next setup or assertion step for this scenario.
        anomalyFlags: [],
      });
    }
    // createMany does not return ids on Postgres without skipDuplicates tricks —
    // insert in chunks then reload.
    const chunk = 200;
    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let i = 0; i < rows.length; i += chunk) {
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      await prisma.attendanceInterval.createMany({
        // Execute the next setup or assertion step for this scenario.
        data: rows.slice(i, i + chunk),
      });
    }
    // seeded: seeded entity required before the mutation under test.
    const seeded = await prisma.attendanceInterval.findMany({
      // SQL fragment used to observe locks or assert DB state.
      where: {
        // Execute the next setup or assertion step for this scenario.
        employeeId: emp,
        // Execute the next setup or assertion step for this scenario.
        hotelDate: HOTEL_DATE,
        // Execute the next setup or assertion step for this scenario.
        startedAt: STARTED_AT,
      },
      // SQL fragment used to observe locks or assert DB state.
      select: { id: true, endedAt: true },
      // Execute the next setup or assertion step for this scenario.
      orderBy: { endedAt: "asc" },
    });
    // Assert collection size matches the expected post-condition.
    assert.equal(seeded.length, N);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    seedIds = seeded.map((r) => r.id);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    seedEndedAtIso = seeded.map((r) => r.endedAt!.toISOString());

    // Repeat/poll to widen the race window or wait for lock waiters.
    for (let i = 0; i < 10; i += 1) {
      // sep: seeded entity required before the mutation under test.
      const sep = await prisma.attendanceInterval.create({
        // Execute the next setup or assertion step for this scenario.
        data: {
          // Execute the next setup or assertion step for this scenario.
          employeeId: emp,
          // Execute the next setup or assertion step for this scenario.
          hotelDate: new Date("2026-09-01T00:00:00.000Z"),
          // Execute the next setup or assertion step for this scenario.
          startedAt: new Date("2026-09-01T08:00:00.000Z"),
          // Execute the next setup or assertion step for this scenario.
          endedAt: new Date(`2026-09-01T09:${String(i).padStart(2, "0")}:00.000Z`),
          // Execute the next setup or assertion step for this scenario.
          breakMinutes: 0,
          // Execute the next setup or assertion step for this scenario.
          workedMinutes: 60,
          // Fixture field status for the seeded actor/entity.
          status: AttendanceIntervalStatus.closed,
          // Execute the next setup or assertion step for this scenario.
          anomalyFlags: [],
        },
      });
      // Execute the next setup or assertion step for this scenario.
      negSepIds.push(sep.id);
      // ctrl: seeded entity required before the mutation under test.
      const ctrl = await prisma.attendanceInterval.create({
        // Execute the next setup or assertion step for this scenario.
        data: {
          // Execute the next setup or assertion step for this scenario.
          employeeId: world.control.employeeId,
          // Execute the next setup or assertion step for this scenario.
          hotelDate: HOTEL_DATE,
          // Execute the next setup or assertion step for this scenario.
          startedAt: STARTED_AT,
          // Execute the next setup or assertion step for this scenario.
          endedAt: new Date(STARTED_AT.getTime() + (2000 + i) * 60_000),
          // Execute the next setup or assertion step for this scenario.
          breakMinutes: 0,
          // Execute the next setup or assertion step for this scenario.
          workedMinutes: 60,
          // Fixture field status for the seeded actor/entity.
          status: AttendanceIntervalStatus.closed,
          // Execute the next setup or assertion step for this scenario.
          anomalyFlags: [],
        },
      });
      // Execute the next setup or assertion step for this scenario.
      negCtrlIds.push(ctrl.id);
    }
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Start or stop the in-process API server for this suite.
    await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (seedIds.length || negSepIds.length || negCtrlIds.length) {
      // Await async work before asserting or releasing locks.
      await prisma.attendanceInterval.deleteMany({
        // SQL fragment used to observe locks or assert DB state.
        where: {
          // Seed prerequisite rows so the mutation under test has a realistic baseline.
          id: { in: [...seedIds, ...negSepIds, ...negCtrlIds] },
        },
      });
    }
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupAttendanceWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: list drain limit=200 → 1205 ids; nextCursor null; no negatives.
  it("list drain limit=200 → 1205 ids; nextCursor null; no negatives", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, ATT_PASSWORD);
    // Bind emp for later setup or assertions in this scope.
    const emp = world.technician.employeeId;
    // Execute the next setup or assertion step for this scenario.
    const collected: string[] = [];
    // Pagination step for list/contract coverage.
    let cursor: string | null = null;
    // Bind pages for later setup or assertions in this scope.
    let pages = 0;
    // Execute the next setup or assertion step for this scenario.
    let totalSeen: number | null = null;

    // Iterate to cover variants or wait until a condition holds.
    for (;;) {
      // Bind qs for later setup or assertions in this scope.
      const qs = new URLSearchParams({
        // Execute the next setup or assertion step for this scenario.
        employeeId: emp,
        // Execute the next setup or assertion step for this scenario.
        month: "2026-10",
        // Pagination step for list/contract coverage.
        limit: "200",
      });
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (cursor) qs.set("cursor", cursor);
      // res: HTTP response captured for status/body checks.
      const res = await getJson(
        // Execute the next setup or assertion step for this scenario.
        api,
        // Execute the next setup or assertion step for this scenario.
        mgr.token,
        // Execute the next setup or assertion step for this scenario.
        `/attendance/intervals?${qs.toString()}`,
      );
      // Assert HTTP status matches the contract for this path.
      assert.equal(res.status, 200);
      // Bind body for later setup or assertions in this scope.
      const body = res.body as {
        // Execute the next setup or assertion step for this scenario.
        intervals: Array<{ id: string }>;
        // Execute the next setup or assertion step for this scenario.
        total: number;
        // Pagination step for list/contract coverage.
        nextCursor: string | null;
        // Pagination step for list/contract coverage.
        limit: number;
      };
      // Assert the observed value matches the intended post-condition.
      assert.equal(body.limit, 200);
      // Assert the observed value matches the intended post-condition.
      assert.equal(body.total, N);
      // Execute the next setup or assertion step for this scenario.
      totalSeen = body.total;
      // Iterate to cover variants or wait until a condition holds.
      for (const iv of body.intervals) collected.push(iv.id);
      // Execute the next setup or assertion step for this scenario.
      pages += 1;
      // Pagination step for list/contract coverage.
      cursor = body.nextCursor;
      // Conditional path for setup, cleanup, or alternate outcomes.
      if (cursor == null) break;
      // Assert the observed value matches the intended post-condition.
      assert.ok(pages < 20, "pagination must terminate");
    }

    // Assert we are on the isolated test DB, not a seed/prod database.
    assert.ok(pages >= 7, `expected >=7 pages, got ${pages}`);
    // Assert the observed value matches the intended post-condition.
    assert.equal(totalSeen, N);
    // Assert collection size matches the expected post-condition.
    assert.equal(collected.length, N);
    // Assert the observed value matches the intended post-condition.
    assert.equal(new Set(collected).size, N);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(
      // Execute the next setup or assertion step for this scenario.
      [...collected].sort(),
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      [...seedIds].sort(),
    );
    // Iterate to cover variants or wait until a condition holds.
    for (const id of negSepIds) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(!collected.includes(id));
    }
    // Iterate to cover variants or wait until a condition holds.
    for (const id of negCtrlIds) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(!collected.includes(id));
    }
  });

  // Case: CSV export 1205 rows; unique (startedAt,endedAt); no negatives.
  it("CSV export 1205 rows; unique (startedAt,endedAt); no negatives", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, ATT_PASSWORD);
    // Bind emp for later setup or assertions in this scope.
    const emp = world.technician.employeeId;
    // Bind qs for later setup or assertions in this scope.
    const qs = new URLSearchParams({
      // Execute the next setup or assertion step for this scenario.
      employeeId: emp,
      // Execute the next setup or assertion step for this scenario.
      month: "2026-10",
    });
    // res: HTTP response captured for status/body checks.
    const res = await fetch(
      // Execute the next setup or assertion step for this scenario.
      `${api}/attendance/export.csv?${qs.toString()}`,
      // Execute the next setup or assertion step for this scenario.
      { headers: { Authorization: `Bearer ${mgr.token}` } },
    );
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // Assert the observed value matches the intended post-condition.
    assert.equal(res.headers.get("X-Attendance-Total"), String(N));
    // Assert the observed value matches the intended post-condition.
    assert.equal(res.headers.get("X-Attendance-Truncated"), null);
    // text: synchronize actors so the race window is observable.
    const text = await res.text();
    // Bind lines for later setup or assertions in this scope.
    const lines = text.split(/\n/).filter((l) => l.length > 0);
    // Assert collection size matches the expected post-condition.
    assert.ok(lines.length >= N + 1);
    // Bind header for later setup or assertions in this scope.
    const header = lines[0]!;
    // Assert the observed value matches the intended post-condition.
    assert.ok(header.includes("startedAt"));
    // Assert the observed value matches the intended post-condition.
    assert.ok(header.includes("endedAt"));
    // Bind data for later setup or assertions in this scope.
    const data = lines.slice(1);
    // Assert collection size matches the expected post-condition.
    assert.equal(data.length, N);

    // Bind pairs for later setup or assertions in this scope.
    const pairs = new Set<string>();
    // Iterate to cover variants or wait until a condition holds.
    for (const line of data) {
      // Bind cols for later setup or assertions in this scope.
      const cols = line.split(",");
      // hotelDate,employeeNumber,fullName,department,startedAt,endedAt,...
      const startedAt = cols[4]!;
      // Bind endedAt for later setup or assertions in this scope.
      const endedAt = cols[5]!;
      // Execute the next setup or assertion step for this scenario.
      pairs.add(`${startedAt}|${endedAt}`);
      // Assert the observed value matches the intended post-condition.
      assert.equal(startedAt, STARTED_AT.toISOString());
      // Assert the observed value matches the intended post-condition.
      assert.ok(!endedAt.startsWith("2026-09-"));
    }
    // Assert the observed value matches the intended post-condition.
    assert.equal(pairs.size, N);
    // Iterate to cover variants or wait until a condition holds.
    for (const ended of seedEndedAtIso) {
      // Assert the observed value matches the intended post-condition.
      assert.ok(
        // Execute the next setup or assertion step for this scenario.
        pairs.has(`${STARTED_AT.toISOString()}|${ended}`),
        // Execute the next setup or assertion step for this scenario.
        `missing pair endedAt=${ended}`,
      );
    }
  });
});