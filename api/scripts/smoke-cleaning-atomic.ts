/**
 * Smoke checks for atomic cleaning transitions (service-layer concurrency).
 * Requires DB + seeded employees. Does not need the HTTP API.
 */
import {
  CleaningStatus,
  PrismaClient,
  SessionStatus,
  TaskStatus,
} from "@prisma/client";
import { randomUUID } from "crypto";
import {
  cancelCleaningSession,
  completeCleaningSession,
  createCleaningTask,
  inspectCleaningTask,
  markRoomDirty,
  startCleaningTask,
} from "../src/services/cleaning";
import { AppError } from "../src/errors";

const prisma = new PrismaClient();

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function errCode(err: unknown): string | null {
  if (err instanceof AppError) return err.code;
  return null;
}

async function ensureAssignedTask(locationId: string, hotelDate: Date) {
  await prisma.cleaningSession.updateMany({
    where: {
      task: { locationId, hotelDate },
      status: SessionStatus.running,
    },
    data: {
      status: SessionStatus.cancelled,
      finishedAt: new Date(),
      notes: "smoke cleanup",
    },
  });
  await prisma.cleaningTask.updateMany({
    where: {
      locationId,
      hotelDate,
      status: {
        in: [
          TaskStatus.assigned,
          TaskStatus.in_progress,
          TaskStatus.awaiting_inspection,
          TaskStatus.rework,
        ],
      },
    },
    data: { status: TaskStatus.cancelled },
  });

  const location = await prisma.location.findUniqueOrThrow({
    where: { id: locationId },
  });

  return prisma.cleaningTask.create({
    data: {
      locationId,
      hotelDate,
      status: TaskStatus.assigned,
      priority: "normal",
      cleaningCycle: location.cleaningCycle,
    },
  });
}

function dayOffset(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

async function main() {
  const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes
    WHERE tablename IN ('CleaningSession', 'CleaningTask')
      AND indexname LIKE '%one_%'
  `;
  console.log(
    "indexes",
    indexes.map((i) => i.indexname).sort(),
  );
  assert(
    indexes.some((i) => i.indexname === "CleaningSession_one_running_per_task"),
    "missing CleaningSession_one_running_per_task",
  );
  assert(
    indexes.some(
      (i) => i.indexname === "CleaningSession_one_running_per_employee",
    ),
    "missing CleaningSession_one_running_per_employee",
  );
  assert(
    indexes.some((i) => i.indexname === "CleaningTask_one_active_per_room_date"),
    "missing CleaningTask_one_active_per_room_date",
  );

  const hk1 = await prisma.user.findUniqueOrThrow({
    where: { email: "housekeeper@meridian.local" },
  });
  const hk2 = await prisma.user.findUniqueOrThrow({
    where: { email: "elena@meridian.local" },
  });
  const owner = await prisma.user.findUniqueOrThrow({
    where: { email: "owner@meridian.local" },
  });
  const supervisor = await prisma.user.findUniqueOrThrow({
    where: { email: "supervisor@meridian.local" },
  });

  await prisma.cleaningSession.updateMany({
    where: {
      employeeId: { in: [hk1.employeeId, hk2.employeeId, owner.employeeId] },
      status: SessionStatus.running,
    },
    data: {
      status: SessionStatus.cancelled,
      finishedAt: new Date(),
      notes: "smoke cleanup employee sessions",
    },
  });

  const room = await prisma.location.findFirst({
    where: { catalogStatus: "active", kind: "room" },
    orderBy: { number: "asc" },
  });
  assert(room, "no active room");

  const hotelDate = new Date();
  hotelDate.setUTCHours(0, 0, 0, 0);

  // --- Concurrent start ---
  const taskRace = await ensureAssignedTask(room.id, hotelDate);
  const settled = await Promise.allSettled([
    startCleaningTask({
      taskId: taskRace.id,
      employeeId: hk1.employeeId,
      commandId: randomUUID(),
      expectedVersion: taskRace.version,
      bypassAssigneeCheck: true,
    }),
    startCleaningTask({
      taskId: taskRace.id,
      employeeId: hk2.employeeId,
      commandId: randomUUID(),
      expectedVersion: taskRace.version,
      bypassAssigneeCheck: true,
    }),
  ]);
  const oks = settled.filter((s) => s.status === "fulfilled");
  const fails = settled.filter((s) => s.status === "rejected");
  console.log(
    "concurrent_start",
    oks.length,
    fails.map((f) =>
      f.status === "rejected" ? errCode(f.reason) ?? String(f.reason) : "",
    ),
  );
  assert(oks.length === 1, `expected 1 successful start, got ${oks.length}`);
  assert(fails.length === 1, `expected 1 failed start, got ${fails.length}`);
  const loserCode =
    fails[0]!.status === "rejected" ? errCode(fails[0].reason) : null;
  assert(
    loserCode === "conflict" || loserCode === "version_conflict",
    `loser should be conflict or version_conflict, got ${loserCode}`,
  );
  const runningCount = await prisma.cleaningSession.count({
    where: { taskId: taskRace.id, status: SessionStatus.running },
  });
  assert(runningCount === 1, `expected 1 running session, got ${runningCount}`);

  // --- Complete vs cancel ---
  await prisma.cleaningSession.updateMany({
    where: {
      employeeId: { in: [hk1.employeeId, owner.employeeId] },
      status: SessionStatus.running,
    },
    data: { status: SessionStatus.cancelled, finishedAt: new Date() },
  });
  const taskB = await ensureAssignedTask(room.id, hotelDate);
  const started = await startCleaningTask({
    taskId: taskB.id,
    employeeId: hk1.employeeId,
    commandId: randomUUID(),
    expectedVersion: taskB.version,
    bypassAssigneeCheck: true,
  });
  const sessionId = started.session.id;
  const taskAfterStart = await prisma.cleaningTask.findUniqueOrThrow({
    where: { id: taskB.id },
  });

  const race2 = await Promise.allSettled([
    completeCleaningSession({
      sessionId,
      employeeId: hk1.employeeId,
      commandId: randomUUID(),
      expectedVersion: taskAfterStart.version,
    }),
    cancelCleaningSession({
      sessionId,
      employeeId: owner.employeeId,
      commandId: randomUUID(),
      expectedVersion: taskAfterStart.version,
      bypassSessionOwnerCheck: true,
    }),
  ]);
  const ok2 = race2.filter((s) => s.status === "fulfilled");
  const fail2 = race2.filter((s) => s.status === "rejected");
  console.log(
    "complete_vs_cancel",
    ok2.length,
    fail2.map((f) =>
      f.status === "rejected" ? errCode(f.reason) ?? String(f.reason) : "",
    ),
  );
  assert(ok2.length === 1 && fail2.length === 1, "expected one winner one loser");
  assert(
    fail2[0]!.status === "rejected" &&
      (errCode(fail2[0].reason) === "invalid_state" ||
        errCode(fail2[0].reason) === "version_conflict"),
    "loser should be invalid_state or version_conflict",
  );
  const sessionFinal = await prisma.cleaningSession.findUniqueOrThrow({
    where: { id: sessionId },
  });
  assert(
    sessionFinal.status === SessionStatus.completed ||
      sessionFinal.status === SessionStatus.cancelled,
    `session terminal status unexpected: ${sessionFinal.status}`,
  );

  // --- Stale version on complete ---
  await prisma.cleaningSession.updateMany({
    where: { employeeId: hk1.employeeId, status: SessionStatus.running },
    data: { status: SessionStatus.cancelled, finishedAt: new Date() },
  });
  const taskC = await ensureAssignedTask(room.id, hotelDate);
  const startedC = await startCleaningTask({
    taskId: taskC.id,
    employeeId: hk1.employeeId,
    commandId: randomUUID(),
    expectedVersion: taskC.version,
    bypassAssigneeCheck: true,
  });
  let staleCode: string | null = null;
  try {
    await completeCleaningSession({
      sessionId: startedC.session.id,
      employeeId: hk1.employeeId,
      commandId: randomUUID(),
      expectedVersion: taskC.version,
    });
  } catch (err) {
    staleCode = errCode(err);
  }
  console.log("stale_version", staleCode);
  assert(staleCode === "version_conflict", "expected version_conflict");

  // --- Idempotent start retry ---
  await prisma.cleaningSession.updateMany({
    where: { employeeId: hk1.employeeId, status: SessionStatus.running },
    data: { status: SessionStatus.cancelled, finishedAt: new Date() },
  });
  const taskD = await ensureAssignedTask(room.id, hotelDate);
  const cmd = randomUUID();
  const first = await startCleaningTask({
    taskId: taskD.id,
    employeeId: hk1.employeeId,
    commandId: cmd,
    expectedVersion: taskD.version,
    bypassAssigneeCheck: true,
  });
  const second = await startCleaningTask({
    taskId: taskD.id,
    employeeId: hk1.employeeId,
    commandId: cmd,
    expectedVersion: taskD.version,
    bypassAssigneeCheck: true,
  });
  console.log("idempotent_start", first.idempotent, second.idempotent);
  assert(first.idempotent === false, "first start should not be idempotent");
  assert(second.idempotent === true, "retry should be idempotent");

  // --- Stale inspection must not override current cleaning cycle ---
  await prisma.cleaningSession.updateMany({
    where: {
      employeeId: { in: [hk1.employeeId, hk2.employeeId] },
      status: SessionStatus.running,
    },
    data: { status: SessionStatus.cancelled, finishedAt: new Date() },
  });
  await prisma.cleaningTask.updateMany({
    where: {
      locationId: room.id,
      status: {
        in: [
          TaskStatus.assigned,
          TaskStatus.in_progress,
          TaskStatus.awaiting_inspection,
          TaskStatus.rework,
        ],
      },
    },
    data: { status: TaskStatus.cancelled },
  });

  const day1 = dayOffset(hotelDate, -1);
  const day2 = hotelDate;

  const day1Task = await createCleaningTask({
    locationId: room.id,
    hotelDate: day1.toISOString().slice(0, 10),
    assignedEmployeeId: hk1.employeeId,
    actorEmployeeId: owner.employeeId,
  });
  const day1Started = await startCleaningTask({
    taskId: day1Task.id,
    employeeId: hk1.employeeId,
    commandId: randomUUID(),
    expectedVersion: day1Task.version,
  });
  const day1Completed = await completeCleaningSession({
    sessionId: day1Started.session.id,
    employeeId: hk1.employeeId,
    commandId: randomUUID(),
    expectedVersion: day1Started.task.version,
  });
  assert(
    day1Completed.task.status === TaskStatus.awaiting_inspection,
    "day1 should await inspection",
  );

  const day2Task = await createCleaningTask({
    locationId: room.id,
    hotelDate: day2.toISOString().slice(0, 10),
    assignedEmployeeId: hk2.employeeId,
    actorEmployeeId: owner.employeeId,
  });
  const day2Started = await startCleaningTask({
    taskId: day2Task.id,
    employeeId: hk2.employeeId,
    commandId: randomUUID(),
    expectedVersion: day2Task.version,
  });
  assert(
    day2Started.task.status === TaskStatus.in_progress,
    "day2 should be in progress",
  );

  const locAfterStart = await prisma.location.findUniqueOrThrow({
    where: { id: room.id },
  });
  assert(
    locAfterStart.cleaningStatus === CleaningStatus.in_progress,
    `expected in_progress before stale approve, got ${locAfterStart.cleaningStatus}`,
  );

  await inspectCleaningTask({
    taskId: day1Task.id,
    inspectorEmployeeId: supervisor.employeeId,
    commandId: randomUUID(),
    result: "approved",
    expectedVersion: day1Completed.task.version,
  });

  const day1After = await prisma.cleaningTask.findUniqueOrThrow({
    where: { id: day1Task.id },
  });
  const locAfterStaleApprove = await prisma.location.findUniqueOrThrow({
    where: { id: room.id },
  });
  console.log(
    "stale_approve",
    day1After.status,
    locAfterStaleApprove.cleaningStatus,
  );
  assert(day1After.status === TaskStatus.completed, "stale approve should complete task");
  assert(
    locAfterStaleApprove.cleaningStatus === CleaningStatus.in_progress,
    `stale approve must not set verified_clean, got ${locAfterStaleApprove.cleaningStatus}`,
  );

  await prisma.cleaningSession.updateMany({
    where: { employeeId: hk1.employeeId, status: SessionStatus.running },
    data: { status: SessionStatus.cancelled, finishedAt: new Date() },
  });
  const day2Completed = await completeCleaningSession({
    sessionId: day2Started.session.id,
    employeeId: hk2.employeeId,
    commandId: randomUUID(),
    expectedVersion: day2Started.task.version,
  });
  await inspectCleaningTask({
    taskId: day2Task.id,
    inspectorEmployeeId: supervisor.employeeId,
    commandId: randomUUID(),
    result: "approved",
    expectedVersion: day2Completed.task.version,
  });
  const locAfterCurrentApprove = await prisma.location.findUniqueOrThrow({
    where: { id: room.id },
  });
  console.log("current_approve", locAfterCurrentApprove.cleaningStatus);
  assert(
    locAfterCurrentApprove.cleaningStatus === CleaningStatus.verified_clean,
    "current cycle approve should set verified_clean",
  );

  // --- markRoomDirty while awaiting_inspection: approve must not restore clean ---
  await prisma.cleaningTask.updateMany({
    where: {
      locationId: room.id,
      status: {
        in: [
          TaskStatus.assigned,
          TaskStatus.in_progress,
          TaskStatus.awaiting_inspection,
          TaskStatus.rework,
        ],
      },
    },
    data: { status: TaskStatus.cancelled },
  });
  const dirtyTask = await createCleaningTask({
    locationId: room.id,
    hotelDate: dayOffset(hotelDate, 1).toISOString().slice(0, 10),
    assignedEmployeeId: hk1.employeeId,
    actorEmployeeId: owner.employeeId,
  });
  const dirtyStarted = await startCleaningTask({
    taskId: dirtyTask.id,
    employeeId: hk1.employeeId,
    commandId: randomUUID(),
    expectedVersion: dirtyTask.version,
  });
  const dirtyCompleted = await completeCleaningSession({
    sessionId: dirtyStarted.session.id,
    employeeId: hk1.employeeId,
    commandId: randomUUID(),
    expectedVersion: dirtyStarted.task.version,
  });
  assert(
    dirtyCompleted.task.status === TaskStatus.awaiting_inspection,
    "expected awaiting_inspection before mark dirty",
  );

  await markRoomDirty(room.id, owner.employeeId);
  const locAfterMarkDirty = await prisma.location.findUniqueOrThrow({
    where: { id: room.id },
  });
  assert(
    locAfterMarkDirty.cleaningStatus === CleaningStatus.dirty,
    "mark dirty should leave room dirty",
  );

  await inspectCleaningTask({
    taskId: dirtyTask.id,
    inspectorEmployeeId: supervisor.employeeId,
    commandId: randomUUID(),
    result: "approved",
    expectedVersion: dirtyCompleted.task.version,
  });
  const locAfterDirtyApprove = await prisma.location.findUniqueOrThrow({
    where: { id: room.id },
  });
  const dirtyTaskAfter = await prisma.cleaningTask.findUniqueOrThrow({
    where: { id: dirtyTask.id },
  });
  console.log(
    "mark_dirty_then_approve",
    dirtyTaskAfter.status,
    locAfterDirtyApprove.cleaningStatus,
  );
  assert(dirtyTaskAfter.status === TaskStatus.completed, "approve should complete task");
  assert(
    locAfterDirtyApprove.cleaningStatus === CleaningStatus.dirty,
    `approve after markDirty must keep dirty, got ${locAfterDirtyApprove.cleaningStatus}`,
  );

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
