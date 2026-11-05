/**
 * Independent concurrency audit verification (2026-11-05).
 * Exercises RISK-LOCK / RISK-PLAN / RISK-ATTENDANCE against real PostgreSQL
 * production service functions. Do not mock business logic.
 */
import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  AttendanceAdjustmentStatus,
  AttendanceEventKind,
  AttendanceIntervalStatus,
  CleaningStatus,
  DailyPlanCategory,
  Priority,
  PrismaClient,
  Role,
  SessionStatus,
  TaskStatus,
} from "@prisma/client";
import {
  cancelCleaningSession,
  completeCleaningSession,
  createCleaningTask,
  inspectCleaningTask,
  markRoomDirty,
  reassignCleaningTask,
  startCleaningTask,
} from "../../src/services/cleaning";
import { bumpDirtyAndRebindWork } from "../../src/services/cleaning/cycles";
import { createDailyPlanEntry } from "../../src/services/dailyPlan";
import {
  ingestEvent,
  requestAdjustment,
  reviewAdjustment,
} from "../../src/services/attendance";
import { getOperations, updateSetting } from "../../src/services/settings";
import { upsertShiftRoster, listShiftRoster } from "../../src/services/shifts";
import { AppError } from "../../src/errors";
import { prisma as appPrisma } from "../../src/db";
import { assertTestDatabase } from "../assertTestDatabase";
import { orderedDatabaseRace, withDatabaseBarrier } from "../dbBarrier";
import {
  cleanupCleaningWorld,
  createCleaningWorld,
  hotelTodayYmd,
  resetCleaningWork,
  type CleaningWorld,
} from "./fixtures";
import {
  cleanupAttendanceWorld,
  createAttendanceWorld,
  type AttendanceWorld,
} from "../attendance/fixtures";
import {
  cleanupShiftsWorld,
  createShiftsWorld,
  type ShiftsWorld,
} from "../shifts/fixtures";

const prisma = new PrismaClient();

function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

function isPrismaDeadlock(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  if (code === "P2010" || code === "40P01" || code === "P2034") return true;
  const message = String((err as { message?: string }).message ?? err);
  return /deadlock|40P01/i.test(message);
}

function formatReject(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: string }).code;
    return `${err.name}${code ? `/${code}` : ""}: ${err.message}`;
  }
  return String(err);
}

describe("independent concurrency audit 2026-11-05", () => {
  let world: CleaningWorld;
  let attWorld: AttendanceWorld;
  let shiftsWorld: ShiftsWorld;
  let opsBefore: Awaited<ReturnType<typeof getOperations>>;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
    await assertTestDatabase(prisma);
    world = await createCleaningWorld(prisma);
    attWorld = await createAttendanceWorld(prisma);
    shiftsWorld = await createShiftsWorld(prisma);
    opsBefore = await getOperations();
    await updateSetting({
      key: "operations",
      value: { ...opsBefore, hotelTimezone: "UTC" },
      actorEmployeeId: world.owner.employeeId,
      reason: "audit-20261105 tz UTC",
    });
  });

  after(async () => {
    if (opsBefore) {
      await updateSetting({
        key: "operations",
        value: opsBefore,
        actorEmployeeId: world.owner.employeeId,
        reason: "audit-20261105 tz restore",
      });
    }
    if (world) {
      await prisma.dailyPlanEntry.deleteMany({
        where: { locationId: { in: [world.locationAId, world.locationBId] } },
      });
      await cleanupCleaningWorld(prisma, world);
    }
    if (attWorld) await cleanupAttendanceWorld(prisma, attWorld);
    if (shiftsWorld) await cleanupShiftsWorld(prisma, shiftsWorld);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetCleaningWork(prisma, world);
    await prisma.dailyPlanEntry.deleteMany({
      where: { locationId: { in: [world.locationAId, world.locationBId] } },
    });
  });

  // ---------------------------------------------------------------------------
  // RISK-LOCK — markRoomDirty × startCleaningTask
  // ---------------------------------------------------------------------------
  describe("RISK-LOCK dirty vs start", () => {
    async function seedAssignedTask() {
      const today = await hotelTodayYmd();
      const task = await createCleaningTask({
        locationId: world.locationAId,
        hotelDate: today,
        assignedEmployeeId: world.hk1.employeeId,
        actorEmployeeId: world.owner.employeeId,
      });
      return task;
    }

    it("sequential control both orders: dirty then start, and start then dirty", async () => {
      {
        const task = await seedAssignedTask();
        await markRoomDirty(world.locationAId, world.reception.employeeId);
        const started = await startCleaningTask({
          taskId: task.id,
          employeeId: world.hk1.employeeId,
          commandId: randomUUID(),
        });
        assert.equal(started.session.status, SessionStatus.running);
        const loc = await prisma.location.findUniqueOrThrow({
          where: { id: world.locationAId },
        });
        assert.equal(loc.cleaningStatus, CleaningStatus.in_progress);
      }

      await resetCleaningWork(prisma, world);

      {
        const task = await seedAssignedTask();
        const started = await startCleaningTask({
          taskId: task.id,
          employeeId: world.hk1.employeeId,
          commandId: randomUUID(),
        });
        assert.equal(started.session.status, SessionStatus.running);
        await markRoomDirty(world.locationAId, world.reception.employeeId);
        const loc = await prisma.location.findUniqueOrThrow({
          where: { id: world.locationAId },
        });
        assert.equal(loc.cleaningStatus, CleaningStatus.dirty);
        const finalTask = await prisma.cleaningTask.findUniqueOrThrow({
          where: { id: task.id },
        });
        assert.equal(finalTask.status, TaskStatus.in_progress);
        assert.equal(finalTask.cleaningCycle, loc.cleaningCycle);
        const running = await prisma.cleaningSession.count({
          where: { taskId: task.id, status: SessionStatus.running },
        });
        assert.equal(running, 1);
      }
    });

    for (let rep = 1; rep <= 3; rep++) {
      it(`concurrent dirty∥start must not deadlock (rep ${rep})`, async () => {
        const task = await seedAssignedTask();
        const commandId = randomUUID();

        const settled = await withDatabaseBarrier(
          prisma,
          (tx) =>
            tx.$queryRaw`SELECT id FROM "CleaningTask" WHERE id = ${task.id} FOR UPDATE`,
          () =>
            Promise.allSettled([
              markRoomDirty(world.locationAId, world.reception.employeeId),
              startCleaningTask({
                taskId: task.id,
                employeeId: world.hk1.employeeId,
                commandId,
              }),
            ]),
        );

        for (const result of settled) {
          if (result.status === "rejected") {
            assert.equal(
              isPrismaDeadlock(result.reason),
              false,
              `must not deadlock: ${formatReject(result.reason)}`,
            );
          }
        }

        const dirtyResult = settled[0]!;
        const startResult = settled[1]!;

        // Both operations are independently valid; neither may fail with a
        // deadlock. Structured 409 is acceptable only if business rules reject.
        if (dirtyResult.status === "rejected") {
          assert.ok(
            isAppError(dirtyResult.reason),
            `dirty loser must be AppError, got ${formatReject(dirtyResult.reason)}`,
          );
        }
        if (startResult.status === "rejected") {
          assert.ok(
            isAppError(startResult.reason),
            `start loser must be AppError, got ${formatReject(startResult.reason)}`,
          );
          assert.notEqual(
            startResult.reason.status,
            500,
            "start must not fail as 500",
          );
        }

        // At least one must succeed; prefer both when no business conflict.
        const okCount = settled.filter((s) => s.status === "fulfilled").length;
        assert.ok(okCount >= 1, "at least one of dirty/start must commit");

        if (
          dirtyResult.status === "fulfilled" &&
          startResult.status === "fulfilled"
        ) {
          const loc = await prisma.location.findUniqueOrThrow({
            where: { id: world.locationAId },
          });
          const finalTask = await prisma.cleaningTask.findUniqueOrThrow({
            where: { id: task.id },
          });
          const running = await prisma.cleaningSession.findFirst({
            where: { taskId: task.id, status: SessionStatus.running },
          });
          assert.ok(running, "session must remain running after both succeed");
          assert.equal(finalTask.status, TaskStatus.in_progress);
          assert.equal(finalTask.cleaningCycle, loc.cleaningCycle);
          assert.ok(
            loc.cleaningStatus === CleaningStatus.dirty ||
              loc.cleaningStatus === CleaningStatus.in_progress,
            `unexpected cleaningStatus ${loc.cleaningStatus}`,
          );
        }

        // If only start succeeded, room should be in_progress with a session.
        if (
          dirtyResult.status === "rejected" &&
          startResult.status === "fulfilled"
        ) {
          const running = await prisma.cleaningSession.count({
            where: { taskId: task.id, status: SessionStatus.running },
          });
          assert.equal(running, 1);
        }

        // If only dirty succeeded, room is dirty and no running session.
        if (
          dirtyResult.status === "fulfilled" &&
          startResult.status === "rejected"
        ) {
          const loc = await prisma.location.findUniqueOrThrow({
            where: { id: world.locationAId },
          });
          assert.equal(loc.cleaningStatus, CleaningStatus.dirty);
        }
      });
    }
  });

  // ---------------------------------------------------------------------------
  // RISK-PLAN — daily plan vs reassign / priority
  // ---------------------------------------------------------------------------
  describe("RISK-PLAN assignment and priority", () => {
    it("control: reassign then priority plan keeps confirmed assignee A", async () => {
      const today = await hotelTodayYmd();
      const task = await createCleaningTask({
        locationId: world.locationAId,
        hotelDate: today,
        actorEmployeeId: world.owner.employeeId,
      });
      assert.equal(task.assignedEmployeeId, null);

      await reassignCleaningTask({
        taskId: task.id,
        assignedEmployeeId: world.hk1.employeeId,
        reason: "supervisor assigns A",
        actorEmployeeId: world.owner.employeeId,
        actorRole: Role.owner,
        forceDespiteAvailability: true,
      });

      await createDailyPlanEntry({
        hotelDate: today,
        locationId: world.locationAId,
        category: DailyPlanCategory.priority,
        assignedEmployeeId: world.hk2.employeeId,
        createdByEmployeeId: world.reception.employeeId,
      });

      const finalTask = await prisma.cleaningTask.findUniqueOrThrow({
        where: { id: task.id },
      });
      assert.equal(finalTask.assignedEmployeeId, world.hk1.employeeId);
      assert.equal(finalTask.priority, Priority.urgent);
      assert.equal(finalTask.reassignReason, "supervisor assigns A");
    });

    for (let rep = 1; rep <= 2; rep++) {
      it(`ordered race: reassign(A) then plan(B) must not silently overwrite A (rep ${rep})`, async () => {
        const today = await hotelTodayYmd();
        const task = await createCleaningTask({
          locationId: world.locationAId,
          hotelDate: today,
          actorEmployeeId: world.owner.employeeId,
        });
        assert.equal(task.assignedEmployeeId, null);

        // Reassign acquires the task lock first; plan reads "unassigned" then
        // waits on UPDATE. Release order lets reassign commit A before plan write.
        const settled = await orderedDatabaseRace(
          prisma,
          (tx) =>
            tx.$queryRaw`SELECT id FROM "CleaningTask" WHERE id = ${task.id} FOR UPDATE`,
          () =>
            reassignCleaningTask({
              taskId: task.id,
              assignedEmployeeId: world.hk1.employeeId,
              reason: "supervisor assigns A",
              actorEmployeeId: world.owner.employeeId,
              actorRole: Role.owner,
              forceDespiteAvailability: true,
            }),
          () =>
            createDailyPlanEntry({
              hotelDate: today,
              locationId: world.locationAId,
              category: DailyPlanCategory.priority,
              assignedEmployeeId: world.hk2.employeeId,
              createdByEmployeeId: world.reception.employeeId,
            }),
        );

        for (const result of settled) {
          if (result.status === "rejected") {
            assert.equal(
              isPrismaDeadlock(result.reason),
              false,
              `must not deadlock: ${formatReject(result.reason)}`,
            );
          }
        }

        const reassignResult = settled[0]!;
        const planResult = settled[1]!;
        const finalTask = await prisma.cleaningTask.findUniqueOrThrow({
          where: { id: task.id },
        });

        if (
          reassignResult.status === "fulfilled" &&
          planResult.status === "fulfilled"
        ) {
          assert.equal(
            finalTask.assignedEmployeeId,
            world.hk1.employeeId,
            `lost update: plan filled B over confirmed assignee A (got ${finalTask.assignedEmployeeId})`,
          );
          assert.equal(finalTask.priority, Priority.urgent);
          assert.equal(finalTask.reassignReason, "supervisor assigns A");
        } else if (reassignResult.status === "fulfilled") {
          assert.equal(finalTask.assignedEmployeeId, world.hk1.employeeId);
        } else if (planResult.status === "fulfilled") {
          assert.equal(finalTask.assignedEmployeeId, world.hk2.employeeId);
          assert.equal(finalTask.priority, Priority.urgent);
        } else {
          assert.fail("both reassign and plan failed");
        }
      });
    }

    it("control: priority then arrival keeps urgent", async () => {
      const today = await hotelTodayYmd();
      await prisma.location.update({
        where: { id: world.locationAId },
        data: { cleaningStatus: CleaningStatus.dirty },
      });
      const task = await createCleaningTask({
        locationId: world.locationAId,
        hotelDate: today,
        assignedEmployeeId: world.hk1.employeeId,
        actorEmployeeId: world.owner.employeeId,
      });
      assert.equal(task.priority, Priority.normal);

      await createDailyPlanEntry({
        hotelDate: today,
        locationId: world.locationAId,
        category: DailyPlanCategory.priority,
        createdByEmployeeId: world.reception.employeeId,
      });
      await createDailyPlanEntry({
        hotelDate: today,
        locationId: world.locationAId,
        category: DailyPlanCategory.arrival,
        createdByEmployeeId: world.reception.employeeId,
      });

      const finalTask = await prisma.cleaningTask.findUniqueOrThrow({
        where: { id: task.id },
      });
      assert.equal(finalTask.priority, Priority.urgent);
    });

    it("ordered race: priority then arrival must keep urgent (not downgrade to high)", async () => {
      const today = await hotelTodayYmd();
      await prisma.location.update({
        where: { id: world.locationAId },
        data: { cleaningStatus: CleaningStatus.dirty },
      });
      const task = await createCleaningTask({
        locationId: world.locationAId,
        hotelDate: today,
        assignedEmployeeId: world.hk1.employeeId,
        actorEmployeeId: world.owner.employeeId,
      });
      assert.equal(task.priority, Priority.normal);

      // Priority waits on UPDATE first; arrival reads stale "normal" then queues.
      // After release, priority commits urgent; arrival must not write high over it.
      const settled = await orderedDatabaseRace(
        prisma,
        (tx) =>
          tx.$queryRaw`SELECT id FROM "CleaningTask" WHERE id = ${task.id} FOR UPDATE`,
        () =>
          createDailyPlanEntry({
            hotelDate: today,
            locationId: world.locationAId,
            category: DailyPlanCategory.priority,
            createdByEmployeeId: world.reception.employeeId,
          }),
        () =>
          createDailyPlanEntry({
            hotelDate: today,
            locationId: world.locationAId,
            category: DailyPlanCategory.arrival,
            createdByEmployeeId: world.owner.employeeId,
          }),
      );

      for (const result of settled) {
        if (result.status === "rejected") {
          assert.equal(
            isPrismaDeadlock(result.reason),
            false,
            `must not deadlock: ${formatReject(result.reason)}`,
          );
        }
      }

      const ok = settled.filter((s) => s.status === "fulfilled").length;
      assert.ok(ok >= 1, "at least one plan entry must succeed");

      const finalTask = await prisma.cleaningTask.findUniqueOrThrow({
        where: { id: task.id },
      });

      if (ok === 2) {
        assert.equal(
          finalTask.priority,
          Priority.urgent,
          `priority lost-update: expected urgent, got ${finalTask.priority}`,
        );
      } else {
        assert.ok(
          finalTask.priority === Priority.urgent ||
            finalTask.priority === Priority.high,
          `unexpected priority ${finalTask.priority}`,
        );
      }
    });
  });

  // ---------------------------------------------------------------------------
  // RISK-ATTENDANCE — approve × late rebuild
  // ---------------------------------------------------------------------------
  describe("RISK-ATTENDANCE approve vs rebuild", () => {
    async function seedClosedShift(
      employeeId: string,
      tag: string,
      day: string,
    ) {
      const stamp = attWorld.stamp;
      const inRes = await ingestEvent({
        externalEventId: `aud-in-${tag}-${stamp}`,
        source: "audit-20261105",
        employeeId,
        kind: AttendanceEventKind.clock_in,
        deviceTime: `${day}T08:00:00.000Z`,
        receivedAt: `${day}T08:00:05.000Z`,
      });
      const outRes = await ingestEvent({
        externalEventId: `aud-out-${tag}-${stamp}`,
        source: "audit-20261105",
        employeeId,
        kind: AttendanceEventKind.clock_out,
        deviceTime: `${day}T16:00:00.000Z`,
        receivedAt: `${day}T16:00:05.000Z`,
      });
      assert.ok(inRes.created && outRes.created);
      const interval = await prisma.attendanceInterval.findFirstOrThrow({
        where: {
          employeeId,
          startEventId: inRes.event.id,
          status: AttendanceIntervalStatus.closed,
        },
      });
      assert.equal(interval.workedMinutes, 480);
      return { interval, stamp, day };
    }

    it("control: approve then late punch keeps 450 worked minutes", async () => {
      const emp = attWorld.technician.employeeId;
      const { interval, stamp, day } = await seedClosedShift(
        emp,
        "ctrl",
        "2026-04-10",
      );
      const adj = await requestAdjustment({
        intervalId: interval.id,
        requestedById: emp,
        actorRole: Role.technician,
        reason: "add break",
        proposedBreakMinutes: 30,
      });
      await reviewAdjustment({
        adjustmentId: adj.id,
        reviewedById: attWorld.manager.employeeId,
        decision: "approved",
      });

      await ingestEvent({
        externalEventId: `aud-late-be-${stamp}`,
        source: "audit-20261105",
        employeeId: emp,
        kind: AttendanceEventKind.break_end,
        deviceTime: `${day}T12:30:00.000Z`,
        receivedAt: `${day}T13:10:00.000Z`,
      });

      const after = await prisma.attendanceInterval.findUniqueOrThrow({
        where: { id: interval.id },
      });
      assert.equal(after.status, AttendanceIntervalStatus.adjusted);
      assert.equal(after.workedMinutes, 450);
      assert.equal(after.breakMinutes, 30);

      const adjAfter = await prisma.attendanceAdjustment.findUniqueOrThrow({
        where: { id: adj.id },
      });
      assert.equal(adjAfter.status, AttendanceAdjustmentStatus.approved);
    });

    for (let rep = 1; rep <= 2; rep++) {
      it(`ordered race: approve then late punch must preserve 450 minutes (rep ${rep})`, async () => {
        const emp =
          rep === 1
            ? attWorld.housekeeper.employeeId
            : attWorld.otherHk.employeeId;
        const actorRole = Role.housekeeper;
        const day = rep === 1 ? "2026-04-11" : "2026-04-12";
        const { interval, stamp } = await seedClosedShift(emp, `race${rep}`, day);
        const adj = await requestAdjustment({
          intervalId: interval.id,
          requestedById: emp,
          actorRole,
          reason: "add break concurrent",
          proposedBreakMinutes: 30,
        });

        // Hold the interval row so rebuild's deleteMany waits after snapshotting
        // the pre-approve non-adjusted id, while approve updates the same row.
        const settled = await orderedDatabaseRace(
          prisma,
          (tx) =>
            tx.$queryRaw`SELECT id FROM "AttendanceInterval" WHERE id = ${interval.id} FOR UPDATE`,
          () =>
            reviewAdjustment({
              adjustmentId: adj.id,
              reviewedById: attWorld.manager.employeeId,
              decision: "approved",
            }),
          () =>
            ingestEvent({
              externalEventId: `aud-race-be-${rep}-${stamp}`,
              source: "audit-20261105",
              employeeId: emp,
              kind: AttendanceEventKind.break_end,
              deviceTime: `${day}T12:30:00.000Z`,
              receivedAt: `${day}T13:10:00.000Z`,
            }),
        );

        for (const result of settled) {
          if (result.status === "rejected") {
            assert.equal(
              isPrismaDeadlock(result.reason),
              false,
              `must not deadlock: ${formatReject(result.reason)}`,
            );
          }
        }

        const reviewResult = settled[0]!;
        const ingestResult = settled[1]!;

        const intervals = await prisma.attendanceInterval.findMany({
          where: { employeeId: emp, hotelDate: interval.hotelDate },
          orderBy: { startedAt: "asc" },
        });
        const adjustments = await prisma.attendanceAdjustment.findMany({
          where: {
            OR: [
              { id: adj.id },
              { interval: { employeeId: emp, hotelDate: interval.hotelDate } },
            ],
          },
        });
        const audits = await prisma.auditEvent.findMany({
          where: {
            entityType: "attendance_adjustment",
            entityId: adj.id,
          },
          orderBy: { occurredAt: "asc" },
        });

        if (reviewResult.status === "fulfilled") {
          const approvedAdj = adjustments.find((a) => a.id === adj.id);
          assert.ok(
            approvedAdj,
            `approved adjustment row missing; adjustments=${JSON.stringify(
              adjustments.map((a) => ({ id: a.id, status: a.status })),
            )} intervals=${JSON.stringify(
              intervals.map((i) => ({
                id: i.id,
                status: i.status,
                worked: i.workedMinutes,
              })),
            )}`,
          );
          assert.equal(
            approvedAdj.status,
            AttendanceAdjustmentStatus.approved,
            "approved adjustment must remain approved",
          );
          const frozen = intervals.find(
            (iv) => iv.status === AttendanceIntervalStatus.adjusted,
          );
          assert.ok(frozen, "adjusted interval must survive rebuild");
          assert.equal(frozen.workedMinutes, 450);
          assert.equal(frozen.breakMinutes, 30);
          assert.ok(
            audits.some((a) => a.action === "adjustment.review"),
            "approval audit must remain",
          );
        } else {
          assert.ok(
            isAppError(reviewResult.reason),
            `review loser must be AppError, got ${formatReject(reviewResult.reason)}`,
          );
          assert.ok(
            reviewResult.reason.status === 404 ||
              reviewResult.reason.status === 409,
            `unexpected review failure ${formatReject(reviewResult.reason)}`,
          );
        }

        if (
          reviewResult.status === "fulfilled" &&
          ingestResult.status === "fulfilled"
        ) {
          const frozen = intervals.find(
            (iv) => iv.status === AttendanceIntervalStatus.adjusted,
          );
          assert.ok(
            frozen && frozen.workedMinutes === 450,
            `lost approved correction: intervals=${JSON.stringify(
              intervals.map((i) => ({
                id: i.id,
                status: i.status,
                worked: i.workedMinutes,
                brk: i.breakMinutes,
              })),
            )} adjustments=${JSON.stringify(
              adjustments.map((a) => ({ id: a.id, status: a.status })),
            )}`,
          );
        }
      });
    }

    it("ordered race: ingest-first then approve settles without silent data loss", async () => {
      const emp = attWorld.otherHk.employeeId;
      const { interval, stamp, day } = await seedClosedShift(
        emp,
        "ord",
        "2026-04-13",
      );
      const adj = await requestAdjustment({
        intervalId: interval.id,
        requestedById: emp,
        actorRole: Role.housekeeper,
        reason: "ordered race break",
        proposedBreakMinutes: 30,
      });

      const settled = await orderedDatabaseRace(
        prisma,
        (tx) =>
          tx.$queryRaw`SELECT id FROM "AttendanceAdjustment" WHERE id = ${adj.id} FOR UPDATE`,
        () =>
          ingestEvent({
            externalEventId: `aud-ord-be-${stamp}`,
            source: "audit-20261105",
            employeeId: emp,
            kind: AttendanceEventKind.break_end,
            deviceTime: `${day}T12:30:00.000Z`,
            receivedAt: `${day}T13:10:00.000Z`,
          }),
        () =>
          reviewAdjustment({
            adjustmentId: adj.id,
            reviewedById: attWorld.manager.employeeId,
            decision: "approved",
          }),
      );

      for (const result of settled) {
        if (result.status === "rejected") {
          assert.equal(isPrismaDeadlock(result.reason), false);
        }
      }

      const intervals = await prisma.attendanceInterval.findMany({
        where: { employeeId: emp, hotelDate: interval.hotelDate },
      });
      const adjustments = await prisma.attendanceAdjustment.findMany({
        where: {
          OR: [
            { id: adj.id },
            { interval: { employeeId: emp, hotelDate: interval.hotelDate } },
          ],
        },
      });

      const approved = adjustments.find(
        (a) => a.status === AttendanceAdjustmentStatus.approved,
      );
      if (approved) {
        const frozen = intervals.find(
          (iv) => iv.status === AttendanceIntervalStatus.adjusted,
        );
        assert.ok(frozen);
        assert.equal(frozen!.workedMinutes, 450);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Additional existing-style guarantees
  // ---------------------------------------------------------------------------
  describe("additional concurrency guarantees", () => {
    it("identical concurrent starts → one running session", async () => {
      const today = await hotelTodayYmd();
      const task = await createCleaningTask({
        locationId: world.locationAId,
        hotelDate: today,
        assignedEmployeeId: world.hk1.employeeId,
        actorEmployeeId: world.owner.employeeId,
      });
      const commandId = randomUUID();
      const settled = await withDatabaseBarrier(
        prisma,
        (tx) =>
          tx.$queryRaw`SELECT id FROM "CleaningTask" WHERE id = ${task.id} FOR UPDATE`,
        () =>
          Promise.allSettled([
            startCleaningTask({
              taskId: task.id,
              employeeId: world.hk1.employeeId,
              commandId,
            }),
            startCleaningTask({
              taskId: task.id,
              employeeId: world.hk1.employeeId,
              commandId,
            }),
          ]),
      );
      const ok = settled.filter((s) => s.status === "fulfilled");
      assert.equal(ok.length, 2);
      const running = await prisma.cleaningSession.count({
        where: { taskId: task.id, status: SessionStatus.running },
      });
      assert.equal(running, 1);
    });

    it("complete∥cancel → one coherent terminal outcome", async () => {
      const today = await hotelTodayYmd();
      const task = await createCleaningTask({
        locationId: world.locationAId,
        hotelDate: today,
        assignedEmployeeId: world.hk1.employeeId,
        actorEmployeeId: world.owner.employeeId,
      });
      const started = await startCleaningTask({
        taskId: task.id,
        employeeId: world.hk1.employeeId,
        commandId: randomUUID(),
      });

      const settled = await withDatabaseBarrier(
        prisma,
        (tx) =>
          tx.$queryRaw`SELECT id FROM "CleaningSession" WHERE id = ${started.session.id} FOR UPDATE`,
        () =>
          Promise.allSettled([
            completeCleaningSession({
              sessionId: started.session.id,
              employeeId: world.hk1.employeeId,
              notes: "done",
              commandId: randomUUID(),
              expectedVersion: started.task.version,
            }),
            cancelCleaningSession({
              sessionId: started.session.id,
              employeeId: world.hk1.employeeId,
              notes: "abort",
              commandId: randomUUID(),
              expectedVersion: started.task.version,
            }),
          ]),
      );

      const ok = settled.filter((s) => s.status === "fulfilled");
      const fail = settled.filter((s) => s.status === "rejected");
      assert.equal(ok.length, 1);
      assert.equal(fail.length, 1);
      assert.ok(isAppError((fail[0] as PromiseRejectedResult).reason));

      const session = await prisma.cleaningSession.findUniqueOrThrow({
        where: { id: started.session.id },
      });
      assert.ok(
        session.status === SessionStatus.completed ||
          session.status === SessionStatus.cancelled,
      );
      const finalTask = await prisma.cleaningTask.findUniqueOrThrow({
        where: { id: task.id },
      });
      if (session.status === SessionStatus.completed) {
        assert.equal(finalTask.status, TaskStatus.awaiting_inspection);
      } else {
        assert.ok(
          finalTask.status === TaskStatus.assigned ||
            finalTask.status === TaskStatus.rework,
        );
      }
    });

    it("stale approve after dirty bump does not re-verify clean", async () => {
      const today = await hotelTodayYmd();
      const task = await createCleaningTask({
        locationId: world.locationAId,
        hotelDate: today,
        assignedEmployeeId: world.hk1.employeeId,
        actorEmployeeId: world.owner.employeeId,
      });
      const started = await startCleaningTask({
        taskId: task.id,
        employeeId: world.hk1.employeeId,
        commandId: randomUUID(),
      });
      const completed = await completeCleaningSession({
        sessionId: started.session.id,
        employeeId: world.hk1.employeeId,
        notes: "done",
        commandId: randomUUID(),
        expectedVersion: started.task.version,
      });
      assert.equal(completed.task.status, TaskStatus.awaiting_inspection);

      await appPrisma.$transaction(async (tx) => {
        await bumpDirtyAndRebindWork(tx, world.locationAId);
      });
      const locAfterBump = await prisma.location.findUniqueOrThrow({
        where: { id: world.locationAId },
      });
      assert.equal(locAfterBump.cleaningStatus, CleaningStatus.dirty);

      // Approve on a superseded cycle is soft-guarded: task may complete, but
      // location must stay dirty (not verified_clean).
      await inspectCleaningTask({
        taskId: task.id,
        inspectorEmployeeId: world.manager.employeeId,
        result: "approved",
        commandId: randomUUID(),
      });

      const loc = await prisma.location.findUniqueOrThrow({
        where: { id: world.locationAId },
      });
      assert.equal(loc.cleaningStatus, CleaningStatus.dirty);
      assert.equal(loc.cleaningCycle, locAfterBump.cleaningCycle);
    });

    it("concurrent roster replaces do not mix employees across winning sets", async () => {
      const hotelDate = "2099-07-20";
      const hotelDateDt = new Date(`${hotelDate}T00:00:00.000Z`);
      const setA = [
        {
          employeeId: shiftsWorld.employeeA.employeeId,
          shiftId: shiftsWorld.shiftMorningId,
        },
        {
          employeeId: shiftsWorld.employeeB.employeeId,
          shiftId: shiftsWorld.shiftMorningId,
        },
      ];
      const setB = [
        {
          employeeId: shiftsWorld.employeeA.employeeId,
          shiftId: shiftsWorld.shiftEveningId,
        },
        {
          employeeId: shiftsWorld.employeeC.employeeId,
          shiftId: shiftsWorld.shiftEveningId,
        },
      ];

      await prisma.employeeShiftRoster.deleteMany({
        where: { hotelDate: hotelDateDt },
      });

      const settled = await withDatabaseBarrier(
        prisma,
        (tx) => tx.$executeRaw`LOCK TABLE "EmployeeShiftRoster" IN SHARE ROW EXCLUSIVE MODE`,
        () =>
          Promise.allSettled([
            upsertShiftRoster({ hotelDate, entries: setA }),
            upsertShiftRoster({ hotelDate, entries: setB }),
          ]),
        2,
      );

      for (const result of settled) {
        if (result.status === "rejected") {
          assert.equal(isPrismaDeadlock(result.reason), false);
        }
      }

      const final = await listShiftRoster(hotelDate);
      const pairs = (
        final.entries as Array<{
          employee: { id: string };
          shift: { id: string };
        }>
      )
        .map((e) => `${e.employee.id}:${e.shift.id}`)
        .sort()
        .join("|");
      const aKey = setA
        .map((e) => `${e.employeeId}:${e.shiftId}`)
        .sort()
        .join("|");
      const bKey = setB
        .map((e) => `${e.employeeId}:${e.shiftId}`)
        .sort()
        .join("|");
      assert.ok(
        pairs === aKey || pairs === bKey,
        `hybrid roster mix detected: ${pairs}`,
      );
    });
  });
});
