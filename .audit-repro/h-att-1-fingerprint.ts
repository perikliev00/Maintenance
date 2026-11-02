/**
 * Isolated audit repro: H-ATT-1 — conflicting payload on same externalEventId.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(path.join(process.cwd(), "package.json"));
const apiRoot = process.cwd();
const { PrismaClient, AttendanceEventKind } = require("@prisma/client");

function imp(rel: string) {
  return import(pathToFileURL(path.join(apiRoot, rel)).href);
}

async function main() {
  const { assertTestDatabase } = await imp("tests/assertTestDatabase.ts");
  const { ingestEvent } = await imp("src/services/attendance/ingest.ts");
  const { createAttendanceWorld, cleanupAttendanceWorld } = await imp(
    "tests/attendance/fixtures.ts",
  );

  const prisma = new PrismaClient();
  await assertTestDatabase(prisma);
  const world = await createAttendanceWorld(prisma);

  const source = `audit-hatt1-${world.stamp}`;
  const externalEventId = `evt-${Date.now()}`;
  const t0 = new Date().toISOString();

  try {
    const first = await ingestEvent({
      source,
      externalEventId,
      employeeId: world.housekeeper.employeeId,
      kind: AttendanceEventKind.clock_in,
      deviceTime: t0,
    });
    assert.equal(first.created, true);

    const same = await ingestEvent({
      source,
      externalEventId,
      employeeId: world.housekeeper.employeeId,
      kind: AttendanceEventKind.clock_in,
      deviceTime: t0,
    });
    assert.equal(same.created, false);
    assert.equal(same.event.id, first.event.id);
    console.log("NEG_CONTROL_OK identical replay returns same event");

    let conflictingResult: {
      created: boolean;
      event: { employeeId: string; kind: string };
    } | null = null;
    let threw: unknown = null;
    try {
      conflictingResult = await ingestEvent({
        source,
        externalEventId,
        employeeId: world.otherHk.employeeId,
        kind: AttendanceEventKind.clock_out,
        deviceTime: new Date(Date.now() + 60_000).toISOString(),
      });
    } catch (e) {
      threw = e;
    }

    const count = await prisma.attendanceEvent.count({
      where: { source, externalEventId },
    });

    console.log(
      JSON.stringify({
        threw: threw
          ? {
              message: (threw as Error).message,
              code:
                typeof threw === "object" && threw && "code" in threw
                  ? (threw as { code: unknown }).code
                  : undefined,
            }
          : null,
        conflictingResult: conflictingResult
          ? {
              created: conflictingResult.created,
              eventEmployeeId: conflictingResult.event.employeeId,
              eventKind: conflictingResult.event.kind,
              firstEmployeeId: world.housekeeper.employeeId,
            }
          : null,
        rowCount: count,
      }),
    );

    if (threw) {
      console.log("H-ATT-1 RESULT: CONFLICTING_PAYLOAD_REJECTED");
    } else {
      console.log(
        "H-ATT-1 OBSERVED: conflicting payload returns existing event without reject",
      );
      console.log(
        "H-ATT-1 CONTRACT_NOTE: ingest docs only require idempotent return; no fingerprint contract in attendance tests",
      );
    }
  } finally {
    await cleanupAttendanceWorld(prisma, world);
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
