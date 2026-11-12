/**
 * daily roster replace + validation + mid-TX rollback.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { upsertShiftRoster } from "../../src/services/shifts";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
import {
  closeServer,
  listenApp,
  loginBearer,
  putJson,
} from "../httpHarness";
import {
  cleanupShiftsWorld,
  createShiftsWorld,
  rosterEntriesForDay,
  // Shape ShiftsWorld documents the fixture/response fields this suite touches.
  type ShiftsWorld,
} from "./fixtures";

// Shared Prisma client bound to the isolated test database.
const prisma = new PrismaClient();

// Local helper rosterMap used by cases in this file.
function rosterMap(
  entries: Array<{ employeeId: string; shiftId: string }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of [...entries].sort((a, b) =>
    a.employeeId.localeCompare(b.employeeId),
  )) {
    out[e.employeeId] = e.shiftId;
  }
  return out;
}

// Suite: shift roster HTTP.
describe("shift roster HTTP", () => {
  let world: ShiftsWorld;
  let api: string;
  let server: import("node:http").Server;

  /** Known non-empty baseline for D (fixture seed shape). Independent of /64b order. */
  function knownRosterD(): Array<{ employeeId: string; shiftId: string }> {
    return [
      {
        employeeId: world.employeeA.employeeId,
        shiftId: world.shiftMorningId,
      },
      {
        employeeId: world.employeeB.employeeId,
        shiftId: world.shiftEveningId,
      },
    ];
  }

  /** Control day D2 — never mutated by D-only PUT tests. */
  function knownRosterD2(): Array<{ employeeId: string; shiftId: string }> {
    return [
      {
        employeeId: world.employeeA.employeeId,
        shiftId: world.shiftEveningId,
      },
      {
        employeeId: world.employeeC.employeeId,
        shiftId: world.shiftMorningId,
      },
    ];
  }

  // Local helper restoreKnownRosters used by cases in this file.
  async function restoreKnownRosters(): Promise<{
    beforeD: Array<{ employeeId: string; shiftId: string }>;
    beforeD2: Array<{ employeeId: string; shiftId: string }>;
  }> {
    const expectedD = knownRosterD();
    const expectedD2 = knownRosterD2();
    await upsertShiftRoster({
      hotelDate: world.dayD,
      entries: expectedD,
      actorEmployeeId: world.manager.employeeId,
    });
    await upsertShiftRoster({
      hotelDate: world.dayD2,
      entries: expectedD2,
      actorEmployeeId: world.manager.employeeId,
    });
    const beforeD = await rosterEntriesForDay(prisma, world.dayD);
    const beforeD2 = await rosterEntriesForDay(prisma, world.dayD2);
    assert.ok(beforeD.length > 0, "day D must be non-empty before invalid PUT");
    assert.ok(beforeD2.length > 0, "day D2 control must be non-empty");
    assert.deepEqual(rosterMap(beforeD), rosterMap(expectedD));
    assert.deepEqual(rosterMap(beforeD2), rosterMap(expectedD2));
    return { beforeD, beforeD2 };
  }

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    // Refuse to mutate unless connected to the isolated test database.
    await assertTestDatabase(prisma);
    world = await createShiftsWorld(prisma);
    ({ server, api } = await listenApp());
  });

  after(async () => {
    await closeServer(server);
    if (world) await cleanupShiftsWorld(prisma, world);
    await prisma.$disconnect();
  });

  // Case: successful replace changes only day D.
  it("successful replace changes only day D", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    await restoreKnownRosters();
    const beforeD2 = await rosterEntriesForDay(prisma, world.dayD2);
    const res = await putJson(api, mgr.token, "/shifts/roster", {
      hotelDate: world.dayD,
      entries: [
        {
          employeeId: world.employeeA.employeeId,
          shiftId: world.shiftEveningId,
        },
        {
          employeeId: world.employeeC.employeeId,
          shiftId: world.shiftMorningId,
        },
      ],
    });
    assert.equal(res.status, 200);
    const afterD = await rosterEntriesForDay(prisma, world.dayD);
    assert.deepEqual(rosterMap(afterD), {
      [world.employeeA.employeeId]: world.shiftEveningId,
      [world.employeeC.employeeId]: world.shiftMorningId,
    });
    assert.ok(!afterD.some((e) => e.employeeId === world.employeeB.employeeId));
    const afterD2 = await rosterEntriesForDay(prisma, world.dayD2);
    assert.deepEqual(afterD2, beforeD2);
  });

  // Case: empty entries clears only day D.
  it("empty entries clears only day D", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    await restoreKnownRosters();
    const beforeD2 = await rosterEntriesForDay(prisma, world.dayD2);
    const res = await putJson(api, mgr.token, "/shifts/roster", {
      hotelDate: world.dayD,
      entries: [],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD), []);
    assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD2), beforeD2);
  });

  // Case: duplicate employee → 400; both days unchanged.
  it("duplicate employee → 400; both days unchanged", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    const { beforeD, beforeD2 } = await restoreKnownRosters();
    const res = await putJson(api, mgr.token, "/shifts/roster", {
      hotelDate: world.dayD,
      entries: [
        // Valid row first — must not be written if validation fails.
        {
          employeeId: world.employeeC.employeeId,
          shiftId: world.shiftMorningId,
        },
        {
          employeeId: world.employeeA.employeeId,
          shiftId: world.shiftMorningId,
        },
        {
          employeeId: world.employeeA.employeeId,
          shiftId: world.shiftEveningId,
        },
      ],
    });
    assert.equal(res.status, 400);
    assert.equal((res.body as { error?: string }).error, "validation");
    assert.match(
      String((res.body as { message?: string }).message),
      /Duplicate employeeId/,
    );
    assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD), beforeD);
    assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD2), beforeD2);
  });

  // Case: missing employee → 400.
  it("missing employee → 400", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    const { beforeD, beforeD2 } = await restoreKnownRosters();
    const res = await putJson(api, mgr.token, "/shifts/roster", {
      hotelDate: world.dayD,
      entries: [
        {
          employeeId: world.employeeA.employeeId,
          shiftId: world.shiftEveningId,
        },
        {
          employeeId: "missing-employee-id",
          shiftId: world.shiftMorningId,
        },
      ],
    });
    assert.equal(res.status, 400);
    assert.equal((res.body as { error?: string }).error, "validation");
    assert.match(
      String((res.body as { message?: string }).message),
      /employees not found/i,
    );
    assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD), beforeD);
    assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD2), beforeD2);
  });

  // Case: missing shift → 400.
  it("missing shift → 400", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    const { beforeD, beforeD2 } = await restoreKnownRosters();
    const res = await putJson(api, mgr.token, "/shifts/roster", {
      hotelDate: world.dayD,
      entries: [
        {
          employeeId: world.employeeB.employeeId,
          shiftId: world.shiftMorningId,
        },
        {
          employeeId: world.employeeA.employeeId,
          shiftId: "missing-shift-id",
        },
      ],
    });
    assert.equal(res.status, 400);
    assert.equal((res.body as { error?: string }).error, "validation");
    assert.match(
      String((res.body as { message?: string }).message),
      /shifts not found/i,
    );
    assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD), beforeD);
    assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD2), beforeD2);
  });

  // Case: inactive shift → 400 invalid_state.
  it("inactive shift → 400 invalid_state", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    const { beforeD, beforeD2 } = await restoreKnownRosters();
    const res = await putJson(api, mgr.token, "/shifts/roster", {
      hotelDate: world.dayD,
      entries: [
        {
          employeeId: world.employeeC.employeeId,
          shiftId: world.shiftMorningId,
        },
        {
          employeeId: world.employeeA.employeeId,
          shiftId: world.shiftInactiveId,
        },
      ],
    });
    assert.equal(res.status, 400);
    assert.equal((res.body as { error?: string }).error, "invalid_state");
    assert.match(
      String((res.body as { message?: string }).message),
      /inactive shift/i,
    );
    assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD), beforeD);
    assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD2), beforeD2);
  });

  // Case: mid-TX rollback via BEFORE INSERT trigger.
  it("mid-TX rollback via BEFORE INSERT trigger", async () => {
    const mgr = await loginBearer(api, world.manager.email, world.password);
    const { beforeD, beforeD2 } = await restoreKnownRosters();
    const fn = `roster_fail_${world.stamp.replace(/[^a-zA-Z0-9]/g, "")}`;
    const trg = `trg_${fn}`;

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'test-forced-roster-insert-failure';
      END;
      $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER ${trg}
      BEFORE INSERT ON "EmployeeShiftRoster"
      FOR EACH ROW
      WHEN (NEW."hotelDate" = DATE '${world.dayD}')
      EXECUTE FUNCTION ${fn}();
    `);

    try {
      const res = await putJson(api, mgr.token, "/shifts/roster", {
        hotelDate: world.dayD,
        entries: [
          {
            employeeId: world.employeeB.employeeId,
            shiftId: world.shiftMorningId,
          },
        ],
      });
      assert.equal(res.status, 500);
      assert.equal((res.body as { error?: string }).error, "internal");
      assert.equal(
        (res.body as { message?: string }).message,
        "Internal server error",
      );
      assert.ok(
        !JSON.stringify(res.body).includes("test-forced-roster-insert-failure"),
        "HTTP body must not leak trigger message",
      );
      assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD), beforeD);
      assert.deepEqual(
        await rosterEntriesForDay(prisma, world.dayD2),
        beforeD2,
      );

      // Separate service-level proof that the trigger fired.
      let serviceErr: unknown;
      try {
        await upsertShiftRoster({
          hotelDate: world.dayD,
          entries: [
            {
              employeeId: world.employeeC.employeeId,
              shiftId: world.shiftEveningId,
            },
          ],
          actorEmployeeId: world.manager.employeeId,
        });
      } catch (err) {
        serviceErr = err;
      }
      assert.ok(serviceErr, "expected upsertShiftRoster to throw");
      assert.match(
        String(serviceErr),
        /test-forced-roster-insert-failure/,
      );
      assert.deepEqual(await rosterEntriesForDay(prisma, world.dayD), beforeD);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS ${trg} ON "EmployeeShiftRoster"`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
  });
});
