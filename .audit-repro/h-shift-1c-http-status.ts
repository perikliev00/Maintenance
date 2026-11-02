/**
 * H-SHIFT-1c: Concurrent PUT /shifts/roster via HTTP — observe status codes.
 */
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
  const { createShiftsWorld, cleanupShiftsWorld } = await imp(
    "tests/shifts/fixtures.ts",
  );
  const { listenApp, closeServer, loginBearer, putJson } = await imp(
    "tests/httpHarness.ts",
  );

  const prisma = new PrismaClient();
  await assertTestDatabase(prisma);
  const world = await createShiftsWorld(prisma);
  const hotelDate = "2099-06-17";
  const hotelDateDt = new Date(`${hotelDate}T00:00:00.000Z`);

  const { server, api } = await listenApp();
  const { token } = await loginBearer(api, world.manager.email, world.password);

  const setA = {
    hotelDate,
    entries: [
      { employeeId: world.employeeA.employeeId, shiftId: world.shiftMorningId },
      { employeeId: world.employeeB.employeeId, shiftId: world.shiftMorningId },
    ],
  };
  const setB = {
    hotelDate,
    entries: [
      { employeeId: world.employeeA.employeeId, shiftId: world.shiftEveningId },
      { employeeId: world.employeeC.employeeId, shiftId: world.shiftEveningId },
    ],
  };

  const statuses: number[] = [];
  try {
    for (let i = 0; i < 5; i++) {
      await prisma.employeeShiftRoster.deleteMany({
        where: { hotelDate: hotelDateDt },
      });
      const [r1, r2] = await Promise.all([
        putJson(api, token, "/shifts/roster", setA),
        putJson(api, token, "/shifts/roster", setB),
      ]);
      statuses.push(r1.status, r2.status);
      console.log(
        JSON.stringify({
          i,
          s1: r1.status,
          s2: r2.status,
          e1: (r1.body as { error?: string })?.error,
          e2: (r2.body as { error?: string })?.error,
        }),
      );
    }
    const fiveHundreds = statuses.filter((s) => s >= 500).length;
    const conflicts = statuses.filter((s) => s === 409).length;
    const oks = statuses.filter((s) => s === 200).length;
    console.log(JSON.stringify({ statuses, oks, conflicts, fiveHundreds }));
    if (fiveHundreds > 0) {
      console.log(
        "H-SHIFT-1c OBSERVED: concurrent roster PUT can return HTTP 5xx",
      );
    } else if (conflicts > 0) {
      console.log("H-SHIFT-1c: loser mapped to 409 conflict");
    } else {
      console.log("H-SHIFT-1c: both succeeded (serialized cleanly)");
    }
  } finally {
    await prisma.employeeShiftRoster.deleteMany({
      where: { hotelDate: hotelDateDt },
    });
    await closeServer(server);
    await cleanupShiftsWorld(prisma, world);
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
