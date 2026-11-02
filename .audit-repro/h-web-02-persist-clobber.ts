/**
 * H-WEB-02 persistence evidence: client sends hotelDate=B with day-A roster entries
 * (state after stale GET A overwrites rosterDraft while rosterDate=B).
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(path.join(process.cwd(), "package.json"));
const apiRoot = process.cwd();
const { PrismaClient } = require("@prisma/client");

function imp(rel: string) {
  return import(pathToFileURL(path.join(apiRoot, rel)).href);
}

function rosterMap(
  rows: Array<{ employeeId: string; shiftId: string }>,
): Record<string, string> {
  return Object.fromEntries(rows.map((r) => [r.employeeId, r.shiftId]));
}

async function main() {
  const { assertTestDatabase } = await imp("tests/assertTestDatabase.ts");
  const { upsertShiftRoster, listShiftRoster } = await imp(
    "src/services/shifts.ts",
  );
  const {
    createShiftsWorld,
    cleanupShiftsWorld,
    rosterEntriesForDay,
  } = await imp("tests/shifts/fixtures.ts");

  const prisma = new PrismaClient();
  await assertTestDatabase(prisma);
  const world = await createShiftsWorld(prisma);
  const dayA = "2099-11-10";
  const dayB = "2099-11-11";

  try {
    await prisma.employeeShiftRoster.deleteMany({
      where: { hotelDate: { in: [new Date(`${dayA}T00:00:00.000Z`), new Date(`${dayB}T00:00:00.000Z`)] } },
    });
    await prisma.employeeShiftRoster.createMany({
      data: [
        {
          employeeId: world.employeeA.employeeId,
          hotelDate: new Date(`${dayA}T00:00:00.000Z`),
          shiftId: world.shiftMorningId,
        },
        {
          employeeId: world.employeeB.employeeId,
          hotelDate: new Date(`${dayA}T00:00:00.000Z`),
          shiftId: world.shiftEveningId,
        },
        {
          employeeId: world.employeeA.employeeId,
          hotelDate: new Date(`${dayB}T00:00:00.000Z`),
          shiftId: world.shiftEveningId,
        },
        {
          employeeId: world.employeeC.employeeId,
          hotelDate: new Date(`${dayB}T00:00:00.000Z`),
          shiftId: world.shiftMorningId,
        },
      ],
    });

    const beforeA = await rosterEntriesForDay(prisma, dayA);
    const beforeB = await rosterEntriesForDay(prisma, dayB);
    const dayARoster = await listShiftRoster(dayA);
    const staleDraftEntries = dayARoster.entries.map((e) => ({
      employeeId: e.employee.id,
      shiftId: e.shift.id,
    }));

    assert.deepEqual(rosterMap(staleDraftEntries), rosterMap(beforeA));
    assert.notDeepEqual(rosterMap(beforeA), rosterMap(beforeB));

    await upsertShiftRoster({
      hotelDate: dayB,
      entries: staleDraftEntries,
      actorEmployeeId: world.manager.employeeId,
    });

    const afterB = await rosterEntriesForDay(prisma, dayB);
    const afterA = await rosterEntriesForDay(prisma, dayA);

    console.log(
      JSON.stringify({
        dayB_before: rosterMap(beforeB),
        staleDraftFromDayA: rosterMap(staleDraftEntries),
        dayB_after: rosterMap(afterB),
        dayA_unchanged: rosterMap(afterA),
      }),
    );

    assert.deepEqual(afterA, beforeA);
    assert.deepEqual(rosterMap(afterB), rosterMap(staleDraftEntries));
    assert.notDeepEqual(rosterMap(afterB), rosterMap(beforeB));
    console.log(
      "H-WEB-02 PERSIST: day B replaced with day-A draft (full-day upsert)",
    );
  } finally {
    await prisma.employeeShiftRoster.deleteMany({
      where: { hotelDate: { in: [new Date(`${dayA}T00:00:00.000Z`), new Date(`${dayB}T00:00:00.000Z`)] } },
    });
    await cleanupShiftsWorld(prisma, world);
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
