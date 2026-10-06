/**
 * Smoke checks for atomic cleaning transitions (service-layer concurrency).
 * Requires DB + seeded employees. Does not need the HTTP API.
 */
import {
  PrismaClient,
  SessionStatus,
  TaskStatus,
} from "@prisma/client";
import { randomUUID } from "crypto";
import {
  cancelCleaningSession,
  completeCleaningSession,
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

  return prisma.cleaningTask.create({
    data: {
      locationId,
      hotelDate,
      status: TaskStatus.assigned,
      priority: "normal",
    },
  });
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
