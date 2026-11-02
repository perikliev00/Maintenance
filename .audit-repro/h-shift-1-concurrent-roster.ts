/**
 * Isolated audit repro: H-SHIFT-1 — concurrent full roster replaces.
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

async function main() {
  const { assertTestDatabase } = await imp("tests/assertTestDatabase.ts");
  const { upsertShiftRoster, listShiftRoster } = await imp(
    "src/services/shifts.ts",
  );
  const { createShiftsWorld, cleanupShiftsWorld } = await imp(
    "tests/shifts/fixtures.ts",
  );

  const prisma = new PrismaClient();
  await assertTestDatabase(prisma);
  const world = await createShiftsWorld(prisma);
  const hotelDate = "2099-06-15";

  try {
    const setA = [
      { employeeId: world.employeeA.employeeId, shiftId: world.shiftMorningId },
      { employeeId: world.employeeB.employeeId, shiftId: world.shiftMorningId },
    ];
    const setB = [
      { employeeId: world.employeeA.employeeId, shiftId: world.shiftEveningId },
      { employeeId: world.employeeC.employeeId, shiftId: world.shiftEveningId },
    ];

    let hybridCount = 0;
    let aWins = 0;
    let bWins = 0;

    const hotelDateDt = new Date(`${hotelDate}T00:00:00.000Z`);

    for (let i = 0; i < 10; i++) {
      await prisma.employeeShiftRoster.deleteMany({ where: { hotelDate: hotelDateDt } });

      await Promise.all([
        upsertShiftRoster({ hotelDate, entries: setA }),
        upsertShiftRoster({ hotelDate, entries: setB }),
      ]);

      const final = await listShiftRoster(hotelDate);
      const pairs = (
        final.entries as Array<{
          employee: { id: string };
          shift: { id: string };
        }>
      )
        .map((e) => `${e.employee.id}:${e.shift.id}`)
        .sort();
      const aKey = setA
        .map((e) => `${e.employeeId}:${e.shiftId}`)
        .sort()
        .join("|");
      const bKey = setB
        .map((e) => `${e.employeeId}:${e.shiftId}`)
        .sort()
        .join("|");
      const got = pairs.join("|");

      if (got === aKey) aWins++;
      else if (got === bKey) bWins++;
      else {
        hybridCount++;
        console.log("HYBRID", { i, pairs });
      }
    }

    console.log(JSON.stringify({ aWins, bWins, hybridCount }));
    assert.equal(hybridCount, 0, "final roster must equal one complete writer");
    assert.equal(aWins + bWins, 10);
    console.log(
      "H-SHIFT-1 RESULT: NO_CORRUPTION — concurrent replaces serialize to LWW",
    );
  } finally {
    await prisma.employeeShiftRoster.deleteMany({
      where: { hotelDate: new Date(`${hotelDate}T00:00:00.000Z`) },
    });
    await cleanupShiftsWorld(prisma, world);
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
