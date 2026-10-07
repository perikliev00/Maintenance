/**
 * Smoke checks for atomic attendance ingest (service-layer).
 * Requires DB + seeded employees. Does not need the HTTP API.
 */
import {
  AttendanceEventKind,
  AttendanceIntervalStatus,
  PrismaClient,
} from "@prisma/client";
import { randomUUID } from "crypto";
import {
  hotelDateString,
  ingestEvent,
} from "../src/services/attendance";
import { getOperations } from "../src/services/settings";

const prisma = new PrismaClient();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  const hk = await prisma.user.findUniqueOrThrow({
    where: { email: "housekeeper@meridian.local" },
  });
  const employeeId = hk.employeeId;
  assert(employeeId, "housekeeper has no employeeId");

  const ops = await getOperations();
  const source = "smoke_attendance";
  const now = new Date();
  const ymd = hotelDateString(now, ops.hotelTimezone);
  const hotelDate = new Date(`${ymd}T00:00:00.000Z`);
  const windowEnd = new Date(hotelDate.getTime() + 48 * 3600_000);
  const deviceTime = `${ymd}T08:15:00.000Z`;

  async function wipeEmployeeDay() {
    // Isolate from demo seed: rebuild pairs the full hotel-day event stream.
    await prisma.attendanceAdjustment.deleteMany({
      where: {
        interval: { employeeId, hotelDate },
      },
    });
    await prisma.attendanceInterval.deleteMany({
      where: { employeeId, hotelDate },
    });
    await prisma.attendanceEvent.deleteMany({
      where: {
        employeeId,
        normalizedTime: { gte: hotelDate, lt: windowEnd },
      },
    });
  }

  await wipeEmployeeDay();

  // --- Orphan event + retry heal ---
  const orphanExternalId = `smoke-orphan-in-${randomUUID()}`;
  const created = await ingestEvent({
    externalEventId: orphanExternalId,
    source,
    employeeId,
    kind: AttendanceEventKind.clock_in,
    deviceTime,
    receivedAt: deviceTime,
    clockSkewSeconds: 0,
  });
  assert(created.created === true, "first ingest should create");
  assert(created.intervalId, "first ingest should link an interval");

  const beforeDelete = await prisma.attendanceInterval.count({
    where: {
      employeeId,
      hotelDate,
      status: { not: AttendanceIntervalStatus.adjusted },
    },
  });
  assert(beforeDelete >= 1, "expected at least one interval before orphan sim");

  await prisma.attendanceInterval.deleteMany({
    where: {
      employeeId,
      hotelDate,
      status: { not: AttendanceIntervalStatus.adjusted },
    },
  });

  const orphaned = await prisma.attendanceEvent.findUniqueOrThrow({
    where: {
      source_externalEventId: {
        source,
        externalEventId: orphanExternalId,
      },
    },
  });
  const linkedAfterDelete = await prisma.attendanceInterval.findFirst({
    where: {
      OR: [
        { startEventId: orphaned.id },
        { endEventId: orphaned.id },
      ],
    },
  });
  assert(!linkedAfterDelete, "interval should be gone after orphan sim");

  const healed = await ingestEvent({
    externalEventId: orphanExternalId,
    source,
    employeeId,
    kind: AttendanceEventKind.clock_in,
    deviceTime,
    receivedAt: deviceTime,
    clockSkewSeconds: 0,
  });
  assert(healed.created === false, "retry should be idempotent");
  assert(healed.intervalId, "retry should restore intervalId");
  const restored = await prisma.attendanceInterval.findUnique({
    where: { id: healed.intervalId },
  });
  assert(restored, "restored interval row missing");
  assert(
    restored.startEventId === orphaned.id,
    "restored interval should link startEventId",
  );
  console.log("orphan_retry_heal", healed.intervalId);

  // --- Break orphan heal (no covering interval) ---
  const breakExternalId = `smoke-orphan-bs-${randomUUID()}`;
  // Ensure a clock_in exists so break can attach after rebuild.
  const breakClockInId = `smoke-break-in-${randomUUID()}`;
  await ingestEvent({
    externalEventId: breakClockInId,
    source,
    employeeId,
    kind: AttendanceEventKind.clock_in,
    deviceTime: `${ymd}T09:00:00.000Z`,
    receivedAt: `${ymd}T09:00:00.000Z`,
    clockSkewSeconds: 0,
  });
  const breakCreated = await ingestEvent({
    externalEventId: breakExternalId,
    source,
    employeeId,
    kind: AttendanceEventKind.break_start,
    deviceTime: `${ymd}T10:00:00.000Z`,
    receivedAt: `${ymd}T10:00:00.000Z`,
    clockSkewSeconds: 0,
  });
  assert(breakCreated.created === true, "break ingest should create");

  await prisma.attendanceInterval.deleteMany({
    where: {
      employeeId,
      hotelDate,
      status: { not: AttendanceIntervalStatus.adjusted },
    },
  });

  const breakHealed = await ingestEvent({
    externalEventId: breakExternalId,
    source,
    employeeId,
    kind: AttendanceEventKind.break_start,
    deviceTime: `${ymd}T10:00:00.000Z`,
    receivedAt: `${ymd}T10:00:00.000Z`,
    clockSkewSeconds: 0,
  });
  assert(breakHealed.created === false, "break retry should be idempotent");
  assert(breakHealed.intervalId, "break retry should restore covering interval");
  console.log("break_orphan_heal", breakHealed.intervalId);

  // --- Concurrent duplicate ingest (P2002 race → idempotent) ---
  await wipeEmployeeDay();

  const raceExternalId = `smoke-race-in-${randomUUID()}`;
  const racePayload = {
    externalEventId: raceExternalId,
    source,
    employeeId,
    kind: AttendanceEventKind.clock_in,
    deviceTime: `${ymd}T11:00:00.000Z`,
    receivedAt: `${ymd}T11:00:00.000Z`,
    clockSkewSeconds: 0,
  };
  const settled = await Promise.allSettled([
    ingestEvent(racePayload),
    ingestEvent(racePayload),
  ]);
  const oks = settled.filter((s) => s.status === "fulfilled");
  const fails = settled.filter((s) => s.status === "rejected");
  console.log(
    "concurrent_ingest",
    oks.length,
    fails.map((f) =>
      f.status === "rejected" ? String(f.reason) : "",
    ),
  );
  assert(oks.length === 2, `expected both concurrent ingests to resolve, got ${oks.length}`);
  assert(fails.length === 0, "concurrent duplicate must not throw");

  const fulfilled = oks.map(
    (s) => (s as PromiseFulfilledResult<Awaited<ReturnType<typeof ingestEvent>>>).value,
  );
  const createdCount = fulfilled.filter((r) => r.created).length;
  const idempotentCount = fulfilled.filter((r) => !r.created).length;
  assert(
    createdCount === 1 && idempotentCount === 1,
    `expected 1 create + 1 idempotent, got created=${createdCount} idempotent=${idempotentCount}`,
  );
  assert(
    fulfilled.every((r) => r.intervalId),
    "both concurrent results should have intervalId",
  );

  const eventCount = await prisma.attendanceEvent.count({
    where: { source, externalEventId: raceExternalId },
  });
  assert(eventCount === 1, `expected 1 event row, got ${eventCount}`);
  const intervalCount = await prisma.attendanceInterval.count({
    where: {
      employeeId,
      hotelDate,
      status: { not: AttendanceIntervalStatus.adjusted },
    },
  });
  assert(intervalCount >= 1, `expected interval after race, got ${intervalCount}`);

  console.log("ok");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
