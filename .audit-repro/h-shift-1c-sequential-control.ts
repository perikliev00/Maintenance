/** Negative control: sequential PUT /shifts/roster both succeed (200). */
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
  const hotelDate = "2099-06-18";
  const { server, api } = await listenApp();
  const { token } = await loginBearer(api, world.manager.email, world.password);
  try {
    const r1 = await putJson(api, token, "/shifts/roster", {
      hotelDate,
      entries: [
        {
          employeeId: world.employeeA.employeeId,
          shiftId: world.shiftMorningId,
        },
      ],
    });
    const r2 = await putJson(api, token, "/shifts/roster", {
      hotelDate,
      entries: [
        {
          employeeId: world.employeeB.employeeId,
          shiftId: world.shiftEveningId,
        },
      ],
    });
    console.log(JSON.stringify({ sequential: [r1.status, r2.status] }));
    if (r1.status !== 200 || r2.status !== 200) process.exitCode = 1;
    else console.log("NEG_CONTROL_OK sequential both 200");
  } finally {
    await prisma.employeeShiftRoster.deleteMany({
      where: { hotelDate: new Date(`${hotelDate}T00:00:00.000Z`) },
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
