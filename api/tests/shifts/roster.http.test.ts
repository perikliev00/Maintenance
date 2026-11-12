/**
 * daily roster replace + validation + mid-TX rollback.
 */
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, describe, it } from "node:test";
// Prisma client types/runtime for DB setup and assertions.
import { PrismaClient } from "@prisma/client";
// Import bindings from ../../src/services/shifts.
import { upsertShiftRoster } from "../../src/services/shifts";
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
  putJson,
// Execute the next setup or assertion step for this scenario.
} from "../httpHarness";
// Import module bindings used by this suite.
import {
  // Execute the next setup or assertion step for this scenario.
  cleanupShiftsWorld,
  // Execute the next setup or assertion step for this scenario.
  createShiftsWorld,
  // Execute the next setup or assertion step for this scenario.
  rosterEntriesForDay,
  // Shape ShiftsWorld documents the fixture/response fields this suite touches.
  type ShiftsWorld,
// Seed prerequisite rows so the mutation under test has a realistic baseline.
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Local helper rosterMap used by cases in this file.
function rosterMap(
  // Execute the next setup or assertion step for this scenario.
  entries: Array<{ employeeId: string; shiftId: string }>,
// Execute the next setup or assertion step for this scenario.
): Record<string, string> {
  // Execute the next setup or assertion step for this scenario.
  const out: Record<string, string> = {};
  // Iterate to cover variants or wait until a condition holds.
  for (const e of [...entries].sort((a, b) =>
    // Execute the next setup or assertion step for this scenario.
    a.employeeId.localeCompare(b.employeeId),
  // Execute the next setup or assertion step for this scenario.
  )) {
    // Execute the next setup or assertion step for this scenario.
    out[e.employeeId] = e.shiftId;
  }
  // Return the arranged value/result to the caller.
  return out;
}

// Suite: shift roster HTTP.
describe("shift roster HTTP", () => {
  // Execute the next setup or assertion step for this scenario.
  let world: ShiftsWorld;
  // Execute the next setup or assertion step for this scenario.
  let api: string;
  // Execute the next setup or assertion step for this scenario.
  let server: import("node:http").Server;

  /** Known non-empty baseline for D (fixture seed shape). Independent of /64b order. */
  function knownRosterD(): Array<{ employeeId: string; shiftId: string }> {
    // Return the arranged value/result to the caller.
    return [
      {
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.employeeA.employeeId,
        // Execute the next setup or assertion step for this scenario.
        shiftId: world.shiftMorningId,
      },
      {
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.employeeB.employeeId,
        // Execute the next setup or assertion step for this scenario.
        shiftId: world.shiftEveningId,
      },
    ];
  }

  /** Control day D2 — never mutated by D-only PUT tests. */
  function knownRosterD2(): Array<{ employeeId: string; shiftId: string }> {
    // Return the arranged value/result to the caller.
    return [
      {
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.employeeA.employeeId,
        // Execute the next setup or assertion step for this scenario.
        shiftId: world.shiftEveningId,
      },
      {
        // Execute the next setup or assertion step for this scenario.
        employeeId: world.employeeC.employeeId,
        // Execute the next setup or assertion step for this scenario.
        shiftId: world.shiftMorningId,
      },
    ];
  }

  // Local helper restoreKnownRosters used by cases in this file.
  async function restoreKnownRosters(): Promise<{
    // Execute the next setup or assertion step for this scenario.
    beforeD: Array<{ employeeId: string; shiftId: string }>;
    // Execute the next setup or assertion step for this scenario.
    beforeD2: Array<{ employeeId: string; shiftId: string }>;
  // Execute the next setup or assertion step for this scenario.
  }> {
    // Bind expectedD for later setup or assertions in this scope.
    const expectedD = knownRosterD();
    // Bind expectedD2 for later setup or assertions in this scope.
    const expectedD2 = knownRosterD2();
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await upsertShiftRoster({
      // Execute the next setup or assertion step for this scenario.
      hotelDate: world.dayD,
      // Execute the next setup or assertion step for this scenario.
      entries: expectedD,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
    });
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    await upsertShiftRoster({
      // Execute the next setup or assertion step for this scenario.
      hotelDate: world.dayD2,
      // Execute the next setup or assertion step for this scenario.
      entries: expectedD2,
      // Execute the next setup or assertion step for this scenario.
      actorEmployeeId: world.manager.employeeId,
    });
    // beforeD: synchronize actors so the race window is observable.
    const beforeD = await rosterEntriesForDay(prisma, world.dayD);
    // beforeD2: synchronize actors so the race window is observable.
    const beforeD2 = await rosterEntriesForDay(prisma, world.dayD2);
    // Assert collection size matches the expected post-condition.
    assert.ok(beforeD.length > 0, "day D must be non-empty before invalid PUT");
    // Assert collection size matches the expected post-condition.
    assert.ok(beforeD2.length > 0, "day D2 control must be non-empty");
    // Assert we are on the isolated test DB, not a seed/prod database.
    assert.deepEqual(rosterMap(beforeD), rosterMap(expectedD));
    // Assert we are on the isolated test DB, not a seed/prod database.
    assert.deepEqual(rosterMap(beforeD2), rosterMap(expectedD2));
    // Return the arranged value/result to the caller.
    return { beforeD, beforeD2 };
  }

  // Arrange shared preconditions before cases run.
  before(async () => {
    // Assert the observed value matches the intended post-condition.
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    // Seed prerequisite rows so the mutation under test has a realistic baseline.
    world = await createShiftsWorld(prisma);
    // Start or stop the in-process API server for this suite.
    ({ server, api } = await listenApp());
  });

  // Release servers/DB clients so later suites stay isolated.
  after(async () => {
    // Start or stop the in-process API server for this suite.
    await closeServer(server);
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (world) await cleanupShiftsWorld(prisma, world);
    // Disconnect Prisma so the pool does not leak across suites.
    await prisma.$disconnect();
  });

  // Case: successful replace changes only day D.
  it("successful replace changes only day D", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // Await async work before asserting or releasing locks.
    await restoreKnownRosters();
    // beforeD2: synchronize actors so the race window is observable.
    const beforeD2 = await rosterEntriesForDay(prisma, world.dayD2);
    // res: HTTP response captured for status/body checks.
    const res = await putJson(api, mgr.token, "/shifts/roster", {
      // Execute the next setup or assertion step for this scenario.
      hotelDate: world.dayD,
      // Execute the next setup or assertion step for this scenario.
      entries: [
        {
          // Execute the next setup or assertion step for this scenario.
          employeeId: world.employeeA.employeeId,
          // Execute the next setup or assertion step for this scenario.
          shiftId: world.shiftEveningId,
        },
        {
          // Execute the next setup or assertion step for this scenario.
          employeeId: world.employeeC.employeeId,
          // Execute the next setup or assertion step for this scenario.
          shiftId: world.shiftMorningId,
        },
      ],
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // afterD: synchronize actors so the race window is observable.
    const afterD = await rosterEntriesForDay(prisma, world.dayD);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(rosterMap(afterD), {
      // Execute the next setup or assertion step for this scenario.
      [world.employeeA.employeeId]: world.shiftEveningId,
      // Execute the next setup or assertion step for this scenario.
      [world.employeeC.employeeId]: world.shiftMorningId,
    });
    // Assert the observed value matches the intended post-condition.
    assert.ok(!afterD.some((e) => e.employeeId === world.employeeB.employeeId));
    // afterD2: synchronize actors so the race window is observable.
    const afterD2 = await rosterEntriesForDay(prisma, world.dayD2);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(afterD2, beforeD2);
  });

  // Case: empty entries clears only day D.
  it("empty entries clears only day D", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // Await async work before asserting or releasing locks.
    await restoreKnownRosters();
    // beforeD2: synchronize actors so the race window is observable.
    const beforeD2 = await rosterEntriesForDay(prisma, world.dayD2);
    // res: HTTP response captured for status/body checks.
    const res = await putJson(api, mgr.token, "/shifts/roster", {
      // Execute the next setup or assertion step for this scenario.
      hotelDate: world.dayD,
      // Execute the next setup or assertion step for this scenario.
      entries: [],
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 200);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD), []);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD2), beforeD2);
  });

  // Case: duplicate employee → 400; both days unchanged.
  it("duplicate employee → 400; both days unchanged", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // Await async work before asserting or releasing locks.
    const { beforeD, beforeD2 } = await restoreKnownRosters();
    // res: HTTP response captured for status/body checks.
    const res = await putJson(api, mgr.token, "/shifts/roster", {
      // Execute the next setup or assertion step for this scenario.
      hotelDate: world.dayD,
      // Execute the next setup or assertion step for this scenario.
      entries: [
        // Valid row first — must not be written if validation fails.
        {
          // Execute the next setup or assertion step for this scenario.
          employeeId: world.employeeC.employeeId,
          // Execute the next setup or assertion step for this scenario.
          shiftId: world.shiftMorningId,
        },
        {
          // Execute the next setup or assertion step for this scenario.
          employeeId: world.employeeA.employeeId,
          // Execute the next setup or assertion step for this scenario.
          shiftId: world.shiftMorningId,
        },
        {
          // Execute the next setup or assertion step for this scenario.
          employeeId: world.employeeA.employeeId,
          // Execute the next setup or assertion step for this scenario.
          shiftId: world.shiftEveningId,
        },
      ],
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 400);
    // Assert the observed value matches the intended post-condition.
    assert.equal((res.body as { error?: string }).error, "validation");
    // Assert the observed value matches the intended post-condition.
    assert.match(
      // Execute the next setup or assertion step for this scenario.
      String((res.body as { message?: string }).message),
      // Execute the next setup or assertion step for this scenario.
      /Duplicate employeeId/,
    );
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD), beforeD);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD2), beforeD2);
  });

  // Case: missing employee → 400.
  it("missing employee → 400", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // Await async work before asserting or releasing locks.
    const { beforeD, beforeD2 } = await restoreKnownRosters();
    // res: HTTP response captured for status/body checks.
    const res = await putJson(api, mgr.token, "/shifts/roster", {
      // Execute the next setup or assertion step for this scenario.
      hotelDate: world.dayD,
      // Execute the next setup or assertion step for this scenario.
      entries: [
        {
          // Execute the next setup or assertion step for this scenario.
          employeeId: world.employeeA.employeeId,
          // Execute the next setup or assertion step for this scenario.
          shiftId: world.shiftEveningId,
        },
        {
          // Execute the next setup or assertion step for this scenario.
          employeeId: "missing-employee-id",
          // Execute the next setup or assertion step for this scenario.
          shiftId: world.shiftMorningId,
        },
      ],
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 400);
    // Assert the observed value matches the intended post-condition.
    assert.equal((res.body as { error?: string }).error, "validation");
    // Assert the observed value matches the intended post-condition.
    assert.match(
      // Execute the next setup or assertion step for this scenario.
      String((res.body as { message?: string }).message),
      // Execute the next setup or assertion step for this scenario.
      /employees not found/i,
    );
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD), beforeD);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD2), beforeD2);
  });

  // Case: missing shift → 400.
  it("missing shift → 400", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // Await async work before asserting or releasing locks.
    const { beforeD, beforeD2 } = await restoreKnownRosters();
    // res: HTTP response captured for status/body checks.
    const res = await putJson(api, mgr.token, "/shifts/roster", {
      // Execute the next setup or assertion step for this scenario.
      hotelDate: world.dayD,
      // Execute the next setup or assertion step for this scenario.
      entries: [
        {
          // Execute the next setup or assertion step for this scenario.
          employeeId: world.employeeB.employeeId,
          // Execute the next setup or assertion step for this scenario.
          shiftId: world.shiftMorningId,
        },
        {
          // Execute the next setup or assertion step for this scenario.
          employeeId: world.employeeA.employeeId,
          // Execute the next setup or assertion step for this scenario.
          shiftId: "missing-shift-id",
        },
      ],
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 400);
    // Assert the observed value matches the intended post-condition.
    assert.equal((res.body as { error?: string }).error, "validation");
    // Assert the observed value matches the intended post-condition.
    assert.match(
      // Execute the next setup or assertion step for this scenario.
      String((res.body as { message?: string }).message),
      // Execute the next setup or assertion step for this scenario.
      /shifts not found/i,
    );
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD), beforeD);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD2), beforeD2);
  });

  // Case: inactive shift → 400 invalid_state.
  it("inactive shift → 400 invalid_state", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // Await async work before asserting or releasing locks.
    const { beforeD, beforeD2 } = await restoreKnownRosters();
    // res: HTTP response captured for status/body checks.
    const res = await putJson(api, mgr.token, "/shifts/roster", {
      // Execute the next setup or assertion step for this scenario.
      hotelDate: world.dayD,
      // Execute the next setup or assertion step for this scenario.
      entries: [
        {
          // Execute the next setup or assertion step for this scenario.
          employeeId: world.employeeC.employeeId,
          // Execute the next setup or assertion step for this scenario.
          shiftId: world.shiftMorningId,
        },
        {
          // Execute the next setup or assertion step for this scenario.
          employeeId: world.employeeA.employeeId,
          // Execute the next setup or assertion step for this scenario.
          shiftId: world.shiftInactiveId,
        },
      ],
    });
    // Assert HTTP status matches the contract for this path.
    assert.equal(res.status, 400);
    // Assert the observed value matches the intended post-condition.
    assert.equal((res.body as { error?: string }).error, "invalid_state");
    // Assert the observed value matches the intended post-condition.
    assert.match(
      // Execute the next setup or assertion step for this scenario.
      String((res.body as { message?: string }).message),
      // Execute the next setup or assertion step for this scenario.
      /inactive shift/i,
    );
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD), beforeD);
    // Assert the observed value matches the intended post-condition.
    assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD2), beforeD2);
  });

  // Case: mid-TX rollback via BEFORE INSERT trigger.
  it("mid-TX rollback via BEFORE INSERT trigger", async () => {
    // mgr: synchronize actors so the race window is observable.
    const mgr = await loginBearer(api, world.manager.email, world.password);
    // Await async work before asserting or releasing locks.
    const { beforeD, beforeD2 } = await restoreKnownRosters();
    // Bind fn for later setup or assertions in this scope.
    const fn = `roster_fail_${world.stamp.replace(/[^a-zA-Z0-9]/g, "")}`;
    // Bind trg for later setup or assertions in this scope.
    const trg = `trg_${fn}`;

    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'test-forced-roster-insert-failure';
      END;
      $$ LANGUAGE plpgsql;
    `);
    // Await async work before asserting or releasing locks.
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${trg}
      BEFORE INSERT ON "EmployeeShiftRoster"
      FOR EACH ROW
      WHEN (NEW."hotelDate" = DATE '${world.dayD}')
      EXECUTE FUNCTION ${fn}();
    `);

    // Try path where partial failure must not leak suite state.
    try {
      // res: HTTP response captured for status/body checks.
      const res = await putJson(api, mgr.token, "/shifts/roster", {
        // Execute the next setup or assertion step for this scenario.
        hotelDate: world.dayD,
        // Execute the next setup or assertion step for this scenario.
        entries: [
          {
            // Execute the next setup or assertion step for this scenario.
            employeeId: world.employeeB.employeeId,
            // Execute the next setup or assertion step for this scenario.
            shiftId: world.shiftMorningId,
          },
        ],
      });
      // Assert HTTP status matches the contract for this path.
      assert.equal(res.status, 500);
      // Assert the observed value matches the intended post-condition.
      assert.equal((res.body as { error?: string }).error, "internal");
      // Assert the observed value matches the intended post-condition.
      assert.equal(
        // Execute the next setup or assertion step for this scenario.
        (res.body as { message?: string }).message,
        // Execute the next setup or assertion step for this scenario.
        "Internal server error",
      );
      // Assert the observed value matches the intended post-condition.
      assert.ok(
        // Execute the next setup or assertion step for this scenario.
        !JSON.stringify(res.body).includes("test-forced-roster-insert-failure"),
        // Execute the next setup or assertion step for this scenario.
        "HTTP body must not leak trigger message",
      );
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD), beforeD);
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(
        // Await async work before asserting or releasing locks.
        await rosterEntriesForDay(prisma, world.dayD2),
        // Execute the next setup or assertion step for this scenario.
        beforeD2,
      );

      // Separate service-level proof that the trigger fired.
      let serviceErr: unknown;
      // Try path where partial failure must not leak suite state.
      try {
        // Seed prerequisite rows so the mutation under test has a realistic baseline.
        await upsertShiftRoster({
          // Execute the next setup or assertion step for this scenario.
          hotelDate: world.dayD,
          // Execute the next setup or assertion step for this scenario.
          entries: [
            {
              // Execute the next setup or assertion step for this scenario.
              employeeId: world.employeeC.employeeId,
              // Execute the next setup or assertion step for this scenario.
              shiftId: world.shiftEveningId,
            },
          ],
          // Execute the next setup or assertion step for this scenario.
          actorEmployeeId: world.manager.employeeId,
        });
      // Execute the next setup or assertion step for this scenario.
      } catch (err) {
        // Execute the next setup or assertion step for this scenario.
        serviceErr = err;
      }
      // Assert we are on the isolated test DB, not a seed/prod database.
      assert.ok(serviceErr, "expected upsertShiftRoster to throw");
      // Assert the observed value matches the intended post-condition.
      assert.match(
        // Execute the next setup or assertion step for this scenario.
        String(serviceErr),
        // Execute the next setup or assertion step for this scenario.
        /test-forced-roster-insert-failure/,
      );
      // Assert the observed value matches the intended post-condition.
      assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD), beforeD);
    // Execute the next setup or assertion step for this scenario.
    } finally {
      // Await async work before asserting or releasing locks.
      await prisma.$executeRawUnsafe(
        // Execute the next setup or assertion step for this scenario.
        `DROP TRIGGER IF EXISTS ${trg} ON "EmployeeShiftRoster"`,
      );
      // Await async work before asserting or releasing locks.
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
  });
});
