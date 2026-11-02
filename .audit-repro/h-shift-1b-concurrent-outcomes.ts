/**
 * H-SHIFT-1b: Classify concurrent upsertShiftRoster outcomes (success vs P2002 vs hybrid).
 * 10 coordinated dual-writes. Also probes HTTP if possible later.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(path.join(process.cwd(), "package.json"));
const apiRoot = process.cwd();
const { PrismaClient, Prisma } = require("@prisma/client");

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
  const hotelDate = "2099-06-16";
  const hotelDateDt = new Date(`${hotelDate}T00:00:00.000Z`);

  const setA = [
    { employeeId: world.employeeA.employeeId, shiftId: world.shiftMorningId },
    { employeeId: world.employeeB.employeeId, shiftId: world.shiftMorningId },
  ];
  const setB = [
    { employeeId: world.employeeA.employeeId, shiftId: world.shiftEveningId },
    { employeeId: world.employeeC.employeeId, shiftId: world.shiftEveningId },
  ];
  const aKey = setA
    .map((e) => `${e.employeeId}:${e.shiftId}`)
    .sort()
    .join("|");
  const bKey = setB
    .map((e) => `${e.employeeId}:${e.shiftId}`)
    .sort()
    .join("|");

  let bothOk = 0;
  let oneOkOneFail = 0;
  let bothFail = 0;
  let hybrid = 0;
  let p2002Count = 0;
  const samples: unknown[] = [];

  try {
    for (let i = 0; i < 10; i++) {
      await prisma.employeeShiftRoster.deleteMany({
        where: { hotelDate: hotelDateDt },
      });

      const settled = await Promise.allSettled([
        upsertShiftRoster({ hotelDate, entries: setA }),
        upsertShiftRoster({ hotelDate, entries: setB }),
      ]);

      const oks = settled.filter((s) => s.status === "fulfilled").length;
      const fails = settled.filter((s) => s.status === "rejected");
      for (const f of fails) {
        const err = f.reason;
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          p2002Count++;
        }
      }
      if (oks === 2) bothOk++;
      else if (oks === 1) oneOkOneFail++;
      else bothFail++;

      const final = await listShiftRoster(hotelDate);
      const got = (
        final.entries as Array<{
          employee: { id: string };
          shift: { id: string };
        }>
      )
        .map((e) => `${e.employee.id}:${e.shift.id}`)
        .sort()
        .join("|");
      const isA = got === aKey;
      const isB = got === bKey;
      if (!isA && !isB && got.length > 0) hybrid++;
      // empty after bothFail is also noteworthy
      samples.push({
        i,
        oks,
        failCodes: fails.map((f) =>
          f.reason instanceof Prisma.PrismaClientKnownRequestError
            ? f.reason.code
            : String(f.reason),
        ),
        got,
        isA,
        isB,
      });
    }

    console.log(
      JSON.stringify(
        { bothOk, oneOkOneFail, bothFail, hybrid, p2002Count, samples },
        null,
        2,
      ),
    );

    // Data integrity: never a hybrid merge of A and B.
    assert.equal(hybrid, 0, "no hybrid roster");

    if (p2002Count > 0) {
      console.log(
        "H-SHIFT-1b OBSERVED: concurrent upserts can surface P2002 unique on (employeeId,hotelDate)",
      );
      console.log(
        "Investigate whether HTTP maps this to 500 vs conflict; DB remains one writer or empty if both fail",
      );
    } else {
      console.log("H-SHIFT-1b: no P2002 in 10 runs (timing-dependent)");
    }
  } finally {
    await prisma.employeeShiftRoster.deleteMany({
      where: { hotelDate: hotelDateDt },
    });
    await cleanupShiftsWorld(prisma, world);
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
