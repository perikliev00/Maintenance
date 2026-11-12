// Import node:assert/strict for cleaningResults/metrics.test.ts.
import assert from "node:assert/strict";
// Import node:test for cleaningResults/metrics.test.ts.
import { describe, it } from "node:test";
// Side-effect or default import required by this module.
import {
  avgValidMinutesFromTaskMs,
  isAnomalousSession,
  normalizeAnomalyFlags,
  sessionDurationBuckets,
  sumValidSessionMs,
// Execute: } from "./metrics";
} from "./metrics";

const threshold = 480; // 2 × default overdueSessionMinutes (240)

describe("normalizeAnomalyFlags", () => {
  it("returns string[] for valid JSON arrays", () => {
    // Begin list of values/items for this step.
    assert.deepEqual(normalizeAnomalyFlags(["overdue", "clock_skew"]), [
      // Execute: "overdue",
      "overdue",
      // Execute: "clock_skew",
      "clock_skew",
    ]);
  });

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
  return new Date(finishedAt.getTime() - minutes * 60_000);
}

describe("isAnomalousSession", () => {
  it("treats non-empty anomalyFlags as anomalous even under duration threshold", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    // Execute: assert.equal(
    assert.equal(
      isAnomalousSession({
        startedAt: minsAgo(finishedAt, 30),
        finishedAt,
        anomalyFlags: ["overdue"],
        anomalyThresholdMinutes: threshold,
      }),
      true,
    );
  });

  it("treats duration >= anomaly threshold as anomalous with empty flags", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    // Execute: assert.equal(
    assert.equal(
      isAnomalousSession({
        startedAt: minsAgo(finishedAt, threshold),
        finishedAt,
        anomalyFlags: [],
        anomalyThresholdMinutes: threshold,
      }),
      true,
    );
  });

  it("does not treat short clean sessions as anomalous", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    // Execute: assert.equal(
    assert.equal(
      isAnomalousSession({
        startedAt: minsAgo(finishedAt, 25),
        finishedAt,
        anomalyFlags: [],
        anomalyThresholdMinutes: threshold,
      }),
      false,
    );
  });
});

describe("sessionDurationBuckets", () => {
  it("puts overdue-flagged duration into excluded (not valid) pool", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    const startedAt = minsAgo(finishedAt, 300); // 5h < 480, but flagged
    const { anomalous, durationMs } = sessionDurationBuckets({
      startedAt,
      finishedAt,
      anomalyFlags: ["overdue"],
      anomalyThresholdMinutes: threshold,
    });
    // Execute: assert.equal(anomalous, true);
    assert.equal(anomalous, true);
    // Execute: assert.equal(durationMs, 300 * 60_000);
    assert.equal(durationMs, 300 * 60_000);
  });

  it("keeps normal session duration as non-anomalous", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    const { anomalous, durationMs } = sessionDurationBuckets({
      startedAt: minsAgo(finishedAt, 40),
      finishedAt,
      anomalyFlags: [],
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
  it("counts one reworked task as 1 completed task / 2 sessions / 1 rework / 1 accepted", () => {
    const locationId = "loc-1";
    const sessions = [
      // Execute: { finishedAt: new Date("2026-10-07T09:00:00.000Z"), locationId },
      { finishedAt: new Date("2026-10-07T09:00:00.000Z"), locationId },
      // Execute: { finishedAt: new Date("2026-10-07T11:00:00.000Z"), locationId },
      { finishedAt: new Date("2026-10-07T11:00:00.000Z"), locationId },
    ];
    const completedTasks = [
      // Execute: { id: "task-1", locationId, completedAt: new Date("2026-10-07T11:30:00.000Z") },
      { id: "task-1", locationId, completedAt: new Date("2026-10-07T11:30:00.000Z") },
    ];
    const rejectedInspections = 1;
    const approvedInspections = 1;
    const autoAccepted = 0;

    const completedSessions = sessions.length;
    const completedTasksCount = completedTasks.length;
    const acceptedTasks = approvedInspections + autoAccepted;
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

  it("counts distinct rooms from completed tasks, not sessions", () => {
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

  it("excludes anomalous minutes from the valid pool used by productivity / P50", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    const samples = [
      {
        startedAt: minsAgo(finishedAt, 30),
        finishedAt,
        anomalyFlags: [] as string[],
      },
      {
        startedAt: minsAgo(finishedAt, 300),
        finishedAt,
        anomalyFlags: ["overdue"] as string[],
      },
    ];

    let totalValidMs = 0;
    let totalExcludedMs = 0;
    let anomalousSessions = 0;
    // Execute: const validMinutes: number[] = [];
    const validMinutes: number[] = [];

    // Iterate items to apply the same rule to each.
    for (const s of samples) {
      const { anomalous, durationMs } = sessionDurationBuckets({
        // Spread remaining fields without dropping caller data.
        ...s,
        anomalyThresholdMinutes: threshold,
      });
      // Branch when this condition holds for the domain rule.
      if (anomalous) {
        // Execute: anomalousSessions += 1;
        anomalousSessions += 1;
        // Execute: totalExcludedMs += durationMs;
        totalExcludedMs += durationMs;
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

describe("sumValidSessionMs", () => {
  it("sums only non-anomalous sessions with finishedAt", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    const ms = sumValidSessionMs(
      // Begin list of values/items for this step.
      [
        {
          startedAt: minsAgo(finishedAt, 30),
          finishedAt,
          anomalyFlags: [],
        },
        {
          startedAt: minsAgo(finishedAt, 60),
          finishedAt,
          anomalyFlags: ["overdue"],
        },
        {
          startedAt: minsAgo(finishedAt, 20),
          finishedAt: null,
          anomalyFlags: [],
        },
      ],
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
  it("does not inflate avg when period sessions include awaiting_inspection", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    // Period session pool: completed task 30m + awaiting_inspection 60m
    let periodValidSessionMs = 0;
    // Iterate items to apply the same rule to each.
    for (const mins of [30, 60]) {
      const { anomalous, durationMs } = sessionDurationBuckets({
        startedAt: minsAgo(finishedAt, mins),
        finishedAt,
        anomalyFlags: [],
        anomalyThresholdMinutes: threshold,
      });
      // Guard: handle missing/invalid state before continuing.
      if (!anomalous) periodValidSessionMs += durationMs;
    }
    const periodValidMinutes = periodValidSessionMs / 60_000;
    // Execute: assert.equal(periodValidMinutes, 90);
    assert.equal(periodValidMinutes, 90);

    // Task-scoped: only the completed task contributes
    const completedTaskValidMs = sumValidSessionMs(
      // Begin list of values/items for this step.
      [
        {
          startedAt: minsAgo(finishedAt, 30),
          finishedAt,
          anomalyFlags: [],
        },
      ],
      threshold,
    );
    const tasksWithValidTime = 1;
    const avg = avgValidMinutesFromTaskMs(
      completedTaskValidMs,
      tasksWithValidTime,
    );
    // Execute: assert.equal(avg, 30);
    assert.equal(avg, 30);
    // Execute: assert.notEqual(avg, periodValidMinutes / tasksWithValidTime);
    assert.notEqual(avg, periodValidMinutes / tasksWithValidTime);
  });

  it("averages valid minutes across completed tasks only", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    const taskMs = [
      // Execute: sumValidSessionMs(
      sumValidSessionMs(
        // Begin list of values/items for this step.
        [
          {
            startedAt: minsAgo(finishedAt, 20),
            finishedAt,
            anomalyFlags: [],
          },
        ],
        threshold,
      ),
      // Execute: sumValidSessionMs(
      sumValidSessionMs(
        // Begin list of values/items for this step.
        [
          {
            startedAt: minsAgo(finishedAt, 40),
            finishedAt,
            anomalyFlags: [],
          },
        ],
        threshold,
      ),
    ];
    let totalValidMsForTasks = 0;
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

  it("returns null when only awaiting_inspection sessions exist (no completed tasks with valid time)", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    const { anomalous, durationMs } = sessionDurationBuckets({
      startedAt: minsAgo(finishedAt, 60),
      finishedAt,
      anomalyFlags: [],
      anomalyThresholdMinutes: threshold,
    });
    // Execute: assert.equal(anomalous, false);
    assert.equal(anomalous, false);
    const totalValidSessionMinutes = durationMs / 60_000;
    // Execute: assert.equal(totalValidSessionMinutes, 60);
    assert.equal(totalValidSessionMinutes, 60);

    const totalValidMsForTasks = 0;
    const tasksWithValidTime = 0;
    // Execute: assert.equal(
    assert.equal(
      // Execute: avgValidMinutesFromTaskMs(totalValidMsForTasks, tasksWithValidTime),
      avgValidMinutesFromTaskMs(totalValidMsForTasks, tasksWithValidTime),
      null,
    );
  });

  it("attributes task valid ms and task count to the same assignee for avg", () => {
    // Construct finishedAt for later use in this flow.
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    const assigneeId = "emp-assignee";
    const sessionWorkerId = "emp-session-worker";

    const completedTasks = [
      {
        assignedEmployeeId: assigneeId,
        // Open nested structure for the next related fields.
        sessions: [
          {
            employeeId: sessionWorkerId,
            startedAt: minsAgo(finishedAt, 45),
            finishedAt,
            anomalyFlags: [] as string[],
          },
        ],
      },
    ];

    // Construct byAssignee for later use in this flow.
    const byAssignee = new Map<
      string,
      // Execute: { totalValidMsForTasks: number; tasksWithValidTime: number }
      { totalValidMsForTasks: number; tasksWithValidTime: number }
    // Execute: >();
    >();
    // Iterate items to apply the same rule to each.
    for (const task of completedTasks) {
      const validMs = sumValidSessionMs(task.sessions, threshold);
      // Guard: handle missing/invalid state before continuing.
      if (validMs <= 0 || !task.assignedEmployeeId) continue;
      const agg = byAssignee.get(task.assignedEmployeeId) ?? {
        totalValidMsForTasks: 0,
        tasksWithValidTime: 0,
      };
      // Execute: agg.totalValidMsForTasks += validMs;
      agg.totalValidMsForTasks += validMs;
      // Execute: agg.tasksWithValidTime += 1;
      agg.tasksWithValidTime += 1;
      // Execute: byAssignee.set(task.assignedEmployeeId, agg);
      byAssignee.set(task.assignedEmployeeId, agg);
    }

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
