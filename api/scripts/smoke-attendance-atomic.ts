/**
 * Smoke checks for atomic attendance ingest + adjustment review (service-layer).
 * Requires DB + seeded employees. Does not need the HTTP API.
 */
import {
  AttendanceAdjustmentStatus,
  AttendanceEventKind,
  AttendanceIntervalStatus,
  PrismaClient,
  Role,
} from "@prisma/client";
import { randomUUID } from "crypto";
import { AppError } from "../src/errors";
import {
  hotelDateString,
  ingestEvent,
  markStaleOpenIntervals,
  OPEN_MISSING_END_HOURS,
  requestAdjustment,
  reviewAdjustment,
} from "../src/services/attendance";
import { getOperations } from "../src/services/settings";

const prisma = new PrismaClient();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function errCode(err: unknown): string | null {
  if (err instanceof AppError) return err.code;
  return null;
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

  // --- Concurrent approve/reject of the same adjustment ---
  await wipeEmployeeDay();

  const owner = await prisma.user.findUniqueOrThrow({
    where: { email: "owner@meridian.local" },
  });
  const supervisor = await prisma.user.findUniqueOrThrow({
    where: { email: "supervisor@meridian.local" },
  });
  assert(owner.employeeId, "owner has no employeeId");
  assert(supervisor.employeeId, "supervisor has no employeeId");

  const adjInId = `smoke-adj-in-${randomUUID()}`;
  const adjOutId = `smoke-adj-out-${randomUUID()}`;
  const clockInAt = `${ymd}T08:00:00.000Z`;
  const clockOutAt = `${ymd}T16:00:00.000Z`;
  const proposedStart = `${ymd}T08:30:00.000Z`;
  const proposedEnd = `${ymd}T16:30:00.000Z`;

  await ingestEvent({
    externalEventId: adjInId,
    source,
    employeeId,
    kind: AttendanceEventKind.clock_in,
    deviceTime: clockInAt,
    receivedAt: clockInAt,
    clockSkewSeconds: 0,
  });
  const closedIngest = await ingestEvent({
    externalEventId: adjOutId,
    source,
    employeeId,
    kind: AttendanceEventKind.clock_out,
    deviceTime: clockOutAt,
    receivedAt: clockOutAt,
    clockSkewSeconds: 0,
  });
  assert(closedIngest.intervalId, "clock_out should link an interval");

  const closedInterval = await prisma.attendanceInterval.findUniqueOrThrow({
    where: { id: closedIngest.intervalId },
  });
  assert(
    closedInterval.status === AttendanceIntervalStatus.closed ||
      closedInterval.status === AttendanceIntervalStatus.needs_review,
    `expected closed interval before adjustment, got ${closedInterval.status}`,
  );
  const originalStartedAt = closedInterval.startedAt.toISOString();
  const originalEndedAt = closedInterval.endedAt?.toISOString() ?? null;

  const adj = await requestAdjustment({
    intervalId: closedInterval.id,
    requestedById: employeeId,
    actorRole: Role.housekeeper,
    reason: "smoke concurrent review",
    proposedStartedAt: proposedStart,
    proposedEndedAt: proposedEnd,
  });

  const reviewSettled = await Promise.allSettled([
    reviewAdjustment({
      adjustmentId: adj.id,
      reviewedById: owner.employeeId,
      decision: "approved",
    }),
    reviewAdjustment({
      adjustmentId: adj.id,
      reviewedById: supervisor.employeeId,
      decision: "rejected",
      reason: "smoke concurrent reject",
    }),
  ]);

  const approveResult = reviewSettled[0]!;
  const rejectResult = reviewSettled[1]!;
  const approveWon = approveResult.status === "fulfilled";
  const rejectWon = rejectResult.status === "fulfilled";
  console.log("concurrent_review", {
    approve: approveResult.status,
    approveCode:
      approveResult.status === "rejected"
        ? errCode(approveResult.reason)
        : "ok",
    reject: rejectResult.status,
    rejectCode:
      rejectResult.status === "rejected"
        ? errCode(rejectResult.reason)
        : "ok",
  });

  assert(
    approveWon !== rejectWon,
    "exactly one of approve/reject must succeed",
  );

  const loser = approveWon ? rejectResult : approveResult;
  assert(loser.status === "rejected", "loser must reject");
  assert(
    errCode(loser.reason) === "conflict",
    `loser should be conflict, got ${errCode(loser.reason)}`,
  );

  const finalAdj = await prisma.attendanceAdjustment.findUniqueOrThrow({
    where: { id: adj.id },
  });
  const finalInterval = await prisma.attendanceInterval.findUniqueOrThrow({
    where: { id: closedInterval.id },
  });

  if (approveWon) {
    assert(
      finalAdj.status === AttendanceAdjustmentStatus.approved,
      `approve win must leave approved, got ${finalAdj.status}`,
    );
    assert(
      finalInterval.status === AttendanceIntervalStatus.adjusted,
      `approve win must adjust interval, got ${finalInterval.status}`,
    );
    assert(
      finalInterval.startedAt.toISOString() ===
        new Date(proposedStart).toISOString(),
      "approve win must apply proposed start",
    );
    assert(
      finalInterval.endedAt?.toISOString() ===
        new Date(proposedEnd).toISOString(),
      "approve win must apply proposed end",
    );
  } else {
    assert(
      finalAdj.status === AttendanceAdjustmentStatus.rejected,
      `reject win must leave rejected, got ${finalAdj.status}`,
    );
    assert(
      finalInterval.status !== AttendanceIntervalStatus.adjusted,
      "reject win must not leave interval adjusted from proposal",
    );
    assert(
      finalInterval.startedAt.toISOString() === originalStartedAt,
      "reject win must keep original start",
    );
    assert(
      (finalInterval.endedAt?.toISOString() ?? null) === originalEndedAt,
      "reject win must keep original end",
    );
  }

  // --- Stale open missing_end job: happy path, re-run, concurrent, vs adjust ---
  await wipeEmployeeDay();

  const staleStartedAt = new Date(
    Date.now() - (OPEN_MISSING_END_HOURS + 2) * 3600_000,
  );
  const staleOpen = await prisma.attendanceInterval.create({
    data: {
      employeeId,
      hotelDate,
      startedAt: staleStartedAt,
      endedAt: null,
      breakMinutes: 0,
      workedMinutes: null,
      status: AttendanceIntervalStatus.open,
      anomalyFlags: ["large_clock_skew"],
    },
  });

  const firstFlag = await markStaleOpenIntervals();
  assert(firstFlag.flagged >= 1, "stale open should be flagged at least once");
  const afterFlag = await prisma.attendanceInterval.findUniqueOrThrow({
    where: { id: staleOpen.id },
  });
  assert(
    afterFlag.status === AttendanceIntervalStatus.needs_review,
    `stale open should become needs_review, got ${afterFlag.status}`,
  );
  const afterFlags = Array.isArray(afterFlag.anomalyFlags)
    ? (afterFlag.anomalyFlags as string[])
    : [];
  assert(afterFlags.includes("missing_end"), "should have missing_end");
  assert(
    afterFlags.includes("large_clock_skew"),
    "should preserve prior anomaly flags",
  );

  const secondFlag = await markStaleOpenIntervals();
  assert(
    secondFlag.flagged === 0,
    `re-run must not re-flag, got flagged=${secondFlag.flagged}`,
  );
  const afterRerun = await prisma.attendanceInterval.findUniqueOrThrow({
    where: { id: staleOpen.id },
  });
  assert(
    afterRerun.status === AttendanceIntervalStatus.needs_review,
    "re-run must keep needs_review",
  );

  await wipeEmployeeDay();
  const concurrentOpen = await prisma.attendanceInterval.create({
    data: {
      employeeId,
      hotelDate,
      startedAt: staleStartedAt,
      endedAt: null,
      breakMinutes: 0,
      workedMinutes: null,
      status: AttendanceIntervalStatus.open,
      anomalyFlags: ["overlap"],
    },
  });

  const concurrentFlagSettled = await Promise.all([
    markStaleOpenIntervals(),
    markStaleOpenIntervals(),
  ]);
  const totalFlagged =
    concurrentFlagSettled[0]!.flagged + concurrentFlagSettled[1]!.flagged;
  const maxScanned = Math.max(
    concurrentFlagSettled[0]!.scanned,
    concurrentFlagSettled[1]!.scanned,
  );
  assert(
    totalFlagged === maxScanned,
    `concurrent markStale claims each candidate once (flagged sum=${totalFlagged}, scanned=${maxScanned})`,
  );
  const afterConcurrent = await prisma.attendanceInterval.findUniqueOrThrow({
    where: { id: concurrentOpen.id },
  });
  assert(
    afterConcurrent.status === AttendanceIntervalStatus.needs_review,
    "concurrent markStale must leave needs_review",
  );
  const concurrentFlags = Array.isArray(afterConcurrent.anomalyFlags)
    ? (afterConcurrent.anomalyFlags as string[])
    : [];
  assert(
    concurrentFlags.includes("missing_end") &&
      concurrentFlags.includes("overlap"),
    `concurrent markStale must keep overlap+missing_end, got ${concurrentFlags.join(",")}`,
  );

  await wipeEmployeeDay();
  const raceOpen = await prisma.attendanceInterval.create({
    data: {
      employeeId,
      hotelDate,
      startedAt: staleStartedAt,
      endedAt: null,
      breakMinutes: 0,
      workedMinutes: null,
      status: AttendanceIntervalStatus.open,
      anomalyFlags: ["large_clock_skew"],
    },
  });
  const raceProposedEnd = new Date(staleStartedAt.getTime() + 8 * 3600_000);
  const raceAdj = await requestAdjustment({
    intervalId: raceOpen.id,
    requestedById: employeeId,
    actorRole: Role.housekeeper,
    reason: "smoke stale vs approve",
    proposedStartedAt: staleStartedAt.toISOString(),
    proposedEndedAt: raceProposedEnd.toISOString(),
    proposedBreakMinutes: 30,
  });

  const raceSettled = await Promise.allSettled([
    markStaleOpenIntervals(),
    reviewAdjustment({
      adjustmentId: raceAdj.id,
      reviewedById: owner.employeeId!,
      decision: "approved",
    }),
  ]);
  console.log("stale_vs_approve", {
    markStale: raceSettled[0]!.status,
    approve: raceSettled[1]!.status,
    approveCode:
      raceSettled[1]!.status === "rejected"
        ? errCode(raceSettled[1]!.reason)
        : "ok",
  });
  assert(
    raceSettled[1]!.status === "fulfilled",
    "approve must succeed in stale-vs-approve race",
  );

  const raceFinal = await prisma.attendanceInterval.findUniqueOrThrow({
    where: { id: raceOpen.id },
  });
  assert(
    raceFinal.status === AttendanceIntervalStatus.adjusted,
    `approve win must leave adjusted (not overwritten by job), got ${raceFinal.status}`,
  );
  assert(raceFinal.endedAt != null, "approve win must set endedAt");
  const raceFinalFlags = Array.isArray(raceFinal.anomalyFlags)
    ? (raceFinal.anomalyFlags as string[])
    : [];
  assert(
    !raceFinalFlags.includes("missing_end"),
    "approve win must not keep missing_end from stale job",
  );

  // Meanwhile-closed: closed interval must not be flagged
  await wipeEmployeeDay();
  const closedStale = await prisma.attendanceInterval.create({
    data: {
      employeeId,
      hotelDate,
      startedAt: staleStartedAt,
      endedAt: raceProposedEnd,
      breakMinutes: 0,
      workedMinutes: 480,
      status: AttendanceIntervalStatus.closed,
      anomalyFlags: ["large_clock_skew"],
    },
  });
  const closedFlag = await markStaleOpenIntervals();
  const closedAfter = await prisma.attendanceInterval.findUniqueOrThrow({
    where: { id: closedStale.id },
  });
  assert(
    closedAfter.status === AttendanceIntervalStatus.closed,
    "closed interval must stay closed",
  );
  assert(
    JSON.stringify(closedAfter.anomalyFlags) ===
      JSON.stringify(["large_clock_skew"]),
    "closed interval flags must be unchanged",
  );
  void closedFlag;

  console.log("smoke-attendance-atomic: ok");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
