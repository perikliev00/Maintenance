// Import node:assert/strict for cleaningResults/metrics.test.ts.
import assert from "node:assert/strict";
// Import node:test for cleaningResults/metrics.test.ts.
import { describe, it } from "node:test";
// Side-effect or default import required by this module.
import {
  // Carry this field through the payload or query.
  avgValidMinutesFromTaskMs,
  // Carry this field through the payload or query.
  isAnomalousSession,
  // Carry this field through the payload or query.
  normalizeAnomalyFlags,
  // Carry this field through the payload or query.
  sessionDurationBuckets,
  // Carry this field through the payload or query.
  sumValidSessionMs,
// Execute: } from "./metrics";
} from "./metrics";

// Capture threshold for subsequent checks or writes.
const threshold = 480; // 2 × default overdueSessionMinutes (240)

// Begin block/object for the following statements.
describe("normalizeAnomalyFlags", () => {
  // Begin block/object for the following statements.
  it("returns string[] for valid JSON arrays", () => {
    // Begin list of values/items for this step.
    assert.deepEqual(normalizeAnomalyFlags(["overdue", "clock_skew"]), [
      // Execute: "overdue",
      "overdue",
      // Execute: "clock_skew",
      "clock_skew",
    ]);
  });

  // Begin block/object for the following statements.
  it("returns [] for null, objects, scalars, and non-string entries", () => {
    // Execute: assert.deepEqual(normalizeAnomalyFlags(null), []);
    assert.deepEqual(normalizeAnomalyFlags(null), []);
    // Execute: assert.deepEqual(normalizeAnomalyFlags({ a: 1 }), []);
    assert.deepEqual(normalizeAnomalyFlags({ a: 1 }), []);
    // Execute: assert.deepEqual(normalizeAnomalyFlags("overdue"), []);
    assert.deepEqual(normalizeAnomalyFlags("overdue"), []);
    // Execute: assert.deepEqual(normalizeAnomalyFlags([1, "ok", null, true]), ["ok"]);
    assert.deepEqual(normalizeAnomalyFlags([1, "ok", null, true]), ["ok"]);
  });
});

// Local helper minsAgo keeps the main flow readable.
function minsAgo(finishedAt: Date, minutes: number): Date {
  // Return the computed result to the caller.
  return new Date(finishedAt.getTime() - minutes * 60_000);
}

// Begin block/object for the following statements.
describe("isAnomalousSession", () => {
  // Begin block/object for the following statements.
  it("treats non-empty anomalyFlags as anomalous even under duration threshold", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    // Execute: assert.equal(
    assert.equal(
      // Begin block/object for the following statements.
      isAnomalousSession({
        // Field value required by this payload or query.
        startedAt: minsAgo(finishedAt, 30),
        // Carry this field through the payload or query.
        finishedAt,
        // Field value required by this payload or query.
        anomalyFlags: ["overdue"],
        // Carry this field through the payload or query.
        anomalyThresholdMinutes: threshold,
      }),
      // Field value required by this payload or query.
      true,
    );
  });

  // Begin block/object for the following statements.
  it("treats duration >= anomaly threshold as anomalous with empty flags", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    // Execute: assert.equal(
    assert.equal(
      // Begin block/object for the following statements.
      isAnomalousSession({
        // Carry this field through the payload or query.
        startedAt: minsAgo(finishedAt, threshold),
        // Carry this field through the payload or query.
        finishedAt,
        // Carry this field through the payload or query.
        anomalyFlags: [],
        // Carry this field through the payload or query.
        anomalyThresholdMinutes: threshold,
      }),
      // Field value required by this payload or query.
      true,
    );
  });

  // Begin block/object for the following statements.
  it("does not treat short clean sessions as anomalous", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    // Execute: assert.equal(
    assert.equal(
      // Begin block/object for the following statements.
      isAnomalousSession({
        // Field value required by this payload or query.
        startedAt: minsAgo(finishedAt, 25),
        // Carry this field through the payload or query.
        finishedAt,
        // Carry this field through the payload or query.
        anomalyFlags: [],
        // Carry this field through the payload or query.
        anomalyThresholdMinutes: threshold,
      }),
      // Field value required by this payload or query.
      false,
    );
  });
});

// Begin block/object for the following statements.
describe("sessionDurationBuckets", () => {
  // Begin block/object for the following statements.
  it("puts overdue-flagged duration into excluded (not valid) pool", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    // Capture startedAt for subsequent checks or writes.
    const startedAt = minsAgo(finishedAt, 300); // 5h < 480, but flagged
    // Begin block/object for the following statements.
    const { anomalous, durationMs } = sessionDurationBuckets({
      // Carry this field through the payload or query.
      startedAt,
      // Carry this field through the payload or query.
      finishedAt,
      // Field value required by this payload or query.
      anomalyFlags: ["overdue"],
      // Carry this field through the payload or query.
      anomalyThresholdMinutes: threshold,
    });
    // Execute: assert.equal(anomalous, true);
    assert.equal(anomalous, true);
    // Execute: assert.equal(durationMs, 300 * 60_000);
    assert.equal(durationMs, 300 * 60_000);
  });

  // Begin block/object for the following statements.
  it("keeps normal session duration as non-anomalous", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    // Begin block/object for the following statements.
    const { anomalous, durationMs } = sessionDurationBuckets({
      // Field value required by this payload or query.
      startedAt: minsAgo(finishedAt, 40),
      // Carry this field through the payload or query.
      finishedAt,
      // Carry this field through the payload or query.
      anomalyFlags: [],
      // Carry this field through the payload or query.
      anomalyThresholdMinutes: threshold,
    });
    // Execute: assert.equal(anomalous, false);
    assert.equal(anomalous, false);
    // Execute: assert.equal(durationMs, 40 * 60_000);
    assert.equal(durationMs, 40 * 60_000);
  });
});

/**
 * Mirrors counter rules in getCleaningResults / getHousekeepingSummary:
 * sessions ≠ tasks; rework = rejected inspections; rooms from completed tasks.
 */
describe("cleaning metric counter semantics (rework + rooms)", () => {
  // Begin block/object for the following statements.
  it("counts one reworked task as 1 completed task / 2 sessions / 1 rework / 1 accepted", () => {
    // Capture locationId for subsequent checks or writes.
    const locationId = "loc-1";
    // Capture sessions for subsequent checks or writes.
    const sessions = [
      // Execute: { finishedAt: new Date("2026-10-07T09:00:00.000Z"), locationId },
      { finishedAt: new Date("2026-10-07T09:00:00.000Z"), locationId },
      // Execute: { finishedAt: new Date("2026-10-07T11:00:00.000Z"), locationId },
      { finishedAt: new Date("2026-10-07T11:00:00.000Z"), locationId },
    ];
    // Capture completedTasks for subsequent checks or writes.
    const completedTasks = [
      // Execute: { id: "task-1", locationId, completedAt: new Date("2026-10-07T11:30:00.000Z") },
      { id: "task-1", locationId, completedAt: new Date("2026-10-07T11:30:00.000Z") },
    ];
    // Capture rejectedInspections for subsequent checks or writes.
    const rejectedInspections = 1;
    // Capture approvedInspections for subsequent checks or writes.
    const approvedInspections = 1;
    // Capture autoAccepted for subsequent checks or writes.
    const autoAccepted = 0;

    // Capture completedSessions for subsequent checks or writes.
    const completedSessions = sessions.length;
    // Capture completedTasksCount for subsequent checks or writes.
    const completedTasksCount = completedTasks.length;
    // Capture acceptedTasks for subsequent checks or writes.
    const acceptedTasks = approvedInspections + autoAccepted;
    // Capture reworkEvents for subsequent checks or writes.
    const reworkEvents = rejectedInspections;
    // Construct distinctRooms for later use in this flow.
    const distinctRooms = new Set(completedTasks.map((t) => t.locationId)).size;

    // Execute: assert.equal(completedTasksCount, 1);
    assert.equal(completedTasksCount, 1);
    // Execute: assert.equal(completedSessions, 2);
    assert.equal(completedSessions, 2);
    // Execute: assert.equal(reworkEvents, 1);
    assert.equal(reworkEvents, 1);
    // Execute: assert.equal(acceptedTasks, 1);
    assert.equal(acceptedTasks, 1);
    // Execute: assert.equal(distinctRooms, 1);
    assert.equal(distinctRooms, 1);
    // Execute: assert.notEqual(completedSessions, completedTasksCount);
    assert.notEqual(completedSessions, completedTasksCount);
  });

  // Begin block/object for the following statements.
  it("counts distinct rooms from completed tasks, not sessions", () => {
    // Capture completedTasks for subsequent checks or writes.
    const completedTasks = [
      // Execute: { locationId: "loc-a" },
      { locationId: "loc-a" },
      // Execute: { locationId: "loc-b" },
      { locationId: "loc-b" },
      // Execute: { locationId: "loc-a" },
      { locationId: "loc-a" },
    ];
    // Construct distinctRooms for later use in this flow.
    const distinctRooms = new Set(completedTasks.map((t) => t.locationId)).size;
    // Execute: assert.equal(distinctRooms, 2);
    assert.equal(distinctRooms, 2);
  });

  // Begin block/object for the following statements.
  it("excludes anomalous minutes from the valid pool used by productivity / P50", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    // Capture samples for subsequent checks or writes.
    const samples = [
      // Begin block/object for the following statements.
      {
        // Field value required by this payload or query.
        startedAt: minsAgo(finishedAt, 30),
        // Carry this field through the payload or query.
        finishedAt,
        // Carry this field through the payload or query.
        anomalyFlags: [] as string[],
      },
      // Begin block/object for the following statements.
      {
        // Field value required by this payload or query.
        startedAt: minsAgo(finishedAt, 300),
        // Carry this field through the payload or query.
        finishedAt,
        // Field value required by this payload or query.
        anomalyFlags: ["overdue"] as string[],
      },
    ];

    // Capture totalValidMs for subsequent checks or writes.
    let totalValidMs = 0;
    // Capture totalExcludedMs for subsequent checks or writes.
    let totalExcludedMs = 0;
    // Capture anomalousSessions for subsequent checks or writes.
    let anomalousSessions = 0;
    // Execute: const validMinutes: number[] = [];
    const validMinutes: number[] = [];

    // Iterate items to apply the same rule to each.
    for (const s of samples) {
      // Begin block/object for the following statements.
      const { anomalous, durationMs } = sessionDurationBuckets({
        // Spread remaining fields without dropping caller data.
        ...s,
        // Carry this field through the payload or query.
        anomalyThresholdMinutes: threshold,
      });
      // Branch when this condition holds for the domain rule.
      if (anomalous) {
        // Execute: anomalousSessions += 1;
        anomalousSessions += 1;
        // Execute: totalExcludedMs += durationMs;
        totalExcludedMs += durationMs;
      // Begin block/object for the following statements.
      } else {
        // Execute: totalValidMs += durationMs;
        totalValidMs += durationMs;
        // Execute: validMinutes.push(durationMs / 60_000);
        validMinutes.push(durationMs / 60_000);
      }
    }

    // Execute: assert.equal(anomalousSessions, 1);
    assert.equal(anomalousSessions, 1);
    // Execute: assert.equal(totalValidMs, 30 * 60_000);
    assert.equal(totalValidMs, 30 * 60_000);
    // Execute: assert.equal(totalExcludedMs, 300 * 60_000);
    assert.equal(totalExcludedMs, 300 * 60_000);
    // Execute: assert.deepEqual(validMinutes, [30]);
    assert.deepEqual(validMinutes, [30]);
  });
});

// Begin block/object for the following statements.
describe("sumValidSessionMs", () => {
  // Begin block/object for the following statements.
  it("sums only non-anomalous sessions with finishedAt", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    // Capture ms for subsequent checks or writes.
    const ms = sumValidSessionMs(
      // Begin list of values/items for this step.
      [
        // Begin block/object for the following statements.
        {
          // Field value required by this payload or query.
          startedAt: minsAgo(finishedAt, 30),
          // Carry this field through the payload or query.
          finishedAt,
          // Carry this field through the payload or query.
          anomalyFlags: [],
        },
        // Begin block/object for the following statements.
        {
          // Field value required by this payload or query.
          startedAt: minsAgo(finishedAt, 60),
          // Carry this field through the payload or query.
          finishedAt,
          // Field value required by this payload or query.
          anomalyFlags: ["overdue"],
        },
        // Begin block/object for the following statements.
        {
          // Field value required by this payload or query.
          startedAt: minsAgo(finishedAt, 20),
          // Field value required by this payload or query.
          finishedAt: null,
          // Carry this field through the payload or query.
          anomalyFlags: [],
        },
      ],
      // Carry this field through the payload or query.
      threshold,
    );
    // Execute: assert.equal(ms, 30 * 60_000);
    assert.equal(ms, 30 * 60_000);
  });
});

/**
 * avgValidMinutes must use the same completed-task set for numerator and
 * denominator (Analytics parity). Period session totals may still include
 * awaiting_inspection sessions; those must not inflate the average.
 */
describe("avgValidMinutes task-scoped formula (F07)", () => {
  // Begin block/object for the following statements.
  it("does not inflate avg when period sessions include awaiting_inspection", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    // Period session pool: completed task 30m + awaiting_inspection 60m
    let periodValidSessionMs = 0;
    // Iterate items to apply the same rule to each.
    for (const mins of [30, 60]) {
      // Begin block/object for the following statements.
      const { anomalous, durationMs } = sessionDurationBuckets({
        // Carry this field through the payload or query.
        startedAt: minsAgo(finishedAt, mins),
        // Carry this field through the payload or query.
        finishedAt,
        // Carry this field through the payload or query.
        anomalyFlags: [],
        // Carry this field through the payload or query.
        anomalyThresholdMinutes: threshold,
      });
      // Guard: handle missing/invalid state before continuing.
      if (!anomalous) periodValidSessionMs += durationMs;
    }
    // Capture periodValidMinutes for subsequent checks or writes.
    const periodValidMinutes = periodValidSessionMs / 60_000;
    // Execute: assert.equal(periodValidMinutes, 90);
    assert.equal(periodValidMinutes, 90);

    // Task-scoped: only the completed task contributes
    const completedTaskValidMs = sumValidSessionMs(
      // Begin list of values/items for this step.
      [
        // Begin block/object for the following statements.
        {
          // Field value required by this payload or query.
          startedAt: minsAgo(finishedAt, 30),
          // Carry this field through the payload or query.
          finishedAt,
          // Carry this field through the payload or query.
          anomalyFlags: [],
        },
      ],
      // Carry this field through the payload or query.
      threshold,
    );
    // Capture tasksWithValidTime for subsequent checks or writes.
    const tasksWithValidTime = 1;
    // Capture avg for subsequent checks or writes.
    const avg = avgValidMinutesFromTaskMs(
      // Carry this field through the payload or query.
      completedTaskValidMs,
      // Carry this field through the payload or query.
      tasksWithValidTime,
    );
    // Execute: assert.equal(avg, 30);
    assert.equal(avg, 30);
    // Execute: assert.notEqual(avg, periodValidMinutes / tasksWithValidTime);
    assert.notEqual(avg, periodValidMinutes / tasksWithValidTime);
  });

  // Begin block/object for the following statements.
  it("averages valid minutes across completed tasks only", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    // Capture taskMs for subsequent checks or writes.
    const taskMs = [
      // Execute: sumValidSessionMs(
      sumValidSessionMs(
        // Begin list of values/items for this step.
        [
          // Begin block/object for the following statements.
          {
            // Field value required by this payload or query.
            startedAt: minsAgo(finishedAt, 20),
            // Carry this field through the payload or query.
            finishedAt,
            // Carry this field through the payload or query.
            anomalyFlags: [],
          },
        ],
        // Carry this field through the payload or query.
        threshold,
      ),
      // Execute: sumValidSessionMs(
      sumValidSessionMs(
        // Begin list of values/items for this step.
        [
          // Begin block/object for the following statements.
          {
            // Field value required by this payload or query.
            startedAt: minsAgo(finishedAt, 40),
            // Carry this field through the payload or query.
            finishedAt,
            // Carry this field through the payload or query.
            anomalyFlags: [],
          },
        ],
        // Carry this field through the payload or query.
        threshold,
      ),
    ];
    // Capture totalValidMsForTasks for subsequent checks or writes.
    let totalValidMsForTasks = 0;
    // Capture tasksWithValidTime for subsequent checks or writes.
    let tasksWithValidTime = 0;
    // Iterate items to apply the same rule to each.
    for (const ms of taskMs) {
      // Branch when this condition holds for the domain rule.
      if (ms > 0) {
        // Execute: totalValidMsForTasks += ms;
        totalValidMsForTasks += ms;
        // Execute: tasksWithValidTime += 1;
        tasksWithValidTime += 1;
      }
    }
    // Execute: assert.equal(
    assert.equal(
      // Execute: avgValidMinutesFromTaskMs(totalValidMsForTasks, tasksWithValidTime),
      avgValidMinutesFromTaskMs(totalValidMsForTasks, tasksWithValidTime),
      // Execute: 30,
      30,
    );
  });

  // Begin block/object for the following statements.
  it("returns null when only awaiting_inspection sessions exist (no completed tasks with valid time)", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    // Begin block/object for the following statements.
    const { anomalous, durationMs } = sessionDurationBuckets({
      // Field value required by this payload or query.
      startedAt: minsAgo(finishedAt, 60),
      // Carry this field through the payload or query.
      finishedAt,
      // Carry this field through the payload or query.
      anomalyFlags: [],
      // Carry this field through the payload or query.
      anomalyThresholdMinutes: threshold,
    });
    // Execute: assert.equal(anomalous, false);
    assert.equal(anomalous, false);
    // Capture totalValidSessionMinutes for subsequent checks or writes.
    const totalValidSessionMinutes = durationMs / 60_000;
    // Execute: assert.equal(totalValidSessionMinutes, 60);
    assert.equal(totalValidSessionMinutes, 60);

    // Capture totalValidMsForTasks for subsequent checks or writes.
    const totalValidMsForTasks = 0;
    // Capture tasksWithValidTime for subsequent checks or writes.
    const tasksWithValidTime = 0;
    // Execute: assert.equal(
    assert.equal(
      // Execute: avgValidMinutesFromTaskMs(totalValidMsForTasks, tasksWithValidTime),
      avgValidMinutesFromTaskMs(totalValidMsForTasks, tasksWithValidTime),
      // Field value required by this payload or query.
      null,
    );
  });

  // Begin block/object for the following statements.
  it("attributes task valid ms and task count to the same assignee for avg", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    // Capture assigneeId for subsequent checks or writes.
    const assigneeId = "emp-assignee";
    // Capture sessionWorkerId for subsequent checks or writes.
    const sessionWorkerId = "emp-session-worker";

    // Capture completedTasks for subsequent checks or writes.
    const completedTasks = [
      // Begin block/object for the following statements.
      {
        // Carry this field through the payload or query.
        assignedEmployeeId: assigneeId,
        // Open nested structure for the next related fields.
        sessions: [
          // Begin block/object for the following statements.
          {
            // Carry this field through the payload or query.
            employeeId: sessionWorkerId,
            // Field value required by this payload or query.
            startedAt: minsAgo(finishedAt, 45),
            // Carry this field through the payload or query.
            finishedAt,
            // Carry this field through the payload or query.
            anomalyFlags: [] as string[],
          },
        ],
      },
    ];

    // Construct byAssignee for later use in this flow.
    const byAssignee = new Map<
      // Carry this field through the payload or query.
      string,
      // Execute: { totalValidMsForTasks: number; tasksWithValidTime: number }
      { totalValidMsForTasks: number; tasksWithValidTime: number }
    // Execute: >();
    >();
    // Iterate items to apply the same rule to each.
    for (const task of completedTasks) {
      // Capture validMs for subsequent checks or writes.
      const validMs = sumValidSessionMs(task.sessions, threshold);
      // Guard: handle missing/invalid state before continuing.
      if (validMs <= 0 || !task.assignedEmployeeId) continue;
      // Capture agg for subsequent checks or writes.
      const agg = byAssignee.get(task.assignedEmployeeId) ?? {
        // Field value required by this payload or query.
        totalValidMsForTasks: 0,
        // Field value required by this payload or query.
        tasksWithValidTime: 0,
      };
      // Execute: agg.totalValidMsForTasks += validMs;
      agg.totalValidMsForTasks += validMs;
      // Execute: agg.tasksWithValidTime += 1;
      agg.tasksWithValidTime += 1;
      // Execute: byAssignee.set(task.assignedEmployeeId, agg);
      byAssignee.set(task.assignedEmployeeId, agg);
    }

    // Capture assignee for subsequent checks or writes.
    const assignee = byAssignee.get(assigneeId)!;
    // Execute: assert.equal(assignee.tasksWithValidTime, 1);
    assert.equal(assignee.tasksWithValidTime, 1);
    // Execute: assert.equal(
    assert.equal(
      // Execute: avgValidMinutesFromTaskMs(
      avgValidMinutesFromTaskMs(
        // Execute: assignee.totalValidMsForTasks,
        assignee.totalValidMsForTasks,
        // Execute: assignee.tasksWithValidTime,
        assignee.tasksWithValidTime,
      ),
      // Execute: 45,
      45,
    );
    // Execute: assert.equal(byAssignee.has(sessionWorkerId), false);
    assert.equal(byAssignee.has(sessionWorkerId), false);
  });
});
