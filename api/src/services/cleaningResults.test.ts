import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  avgValidMinutesFromTaskMs,
  isAnomalousSession,
  sessionDurationBuckets,
  sumValidSessionMs,
} from "./cleaningResults";

const threshold = 480; // 2 × default overdueSessionMinutes (240)

function minsAgo(finishedAt: Date, minutes: number): Date {
  return new Date(finishedAt.getTime() - minutes * 60_000);
}

describe("isAnomalousSession", () => {
  it("treats non-empty anomalyFlags as anomalous even under duration threshold", () => {
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
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
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
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
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
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
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    const startedAt = minsAgo(finishedAt, 300); // 5h < 480, but flagged
    const { anomalous, durationMs } = sessionDurationBuckets({
      startedAt,
      finishedAt,
      anomalyFlags: ["overdue"],
      anomalyThresholdMinutes: threshold,
    });
    assert.equal(anomalous, true);
    assert.equal(durationMs, 300 * 60_000);
  });

  it("keeps normal session duration as non-anomalous", () => {
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    const { anomalous, durationMs } = sessionDurationBuckets({
      startedAt: minsAgo(finishedAt, 40),
      finishedAt,
      anomalyFlags: [],
      anomalyThresholdMinutes: threshold,
    });
    assert.equal(anomalous, false);
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
      { finishedAt: new Date("2026-10-07T09:00:00.000Z"), locationId },
      { finishedAt: new Date("2026-10-07T11:00:00.000Z"), locationId },
    ];
    const completedTasks = [
      { id: "task-1", locationId, completedAt: new Date("2026-10-07T11:30:00.000Z") },
    ];
    const rejectedInspections = 1;
    const approvedInspections = 1;
    const autoAccepted = 0;

    const completedSessions = sessions.length;
    const completedTasksCount = completedTasks.length;
    const acceptedTasks = approvedInspections + autoAccepted;
    const reworkEvents = rejectedInspections;
    const distinctRooms = new Set(completedTasks.map((t) => t.locationId)).size;

    assert.equal(completedTasksCount, 1);
    assert.equal(completedSessions, 2);
    assert.equal(reworkEvents, 1);
    assert.equal(acceptedTasks, 1);
    assert.equal(distinctRooms, 1);
    assert.notEqual(completedSessions, completedTasksCount);
  });

  it("counts distinct rooms from completed tasks, not sessions", () => {
    const completedTasks = [
      { locationId: "loc-a" },
      { locationId: "loc-b" },
      { locationId: "loc-a" },
    ];
    const distinctRooms = new Set(completedTasks.map((t) => t.locationId)).size;
    assert.equal(distinctRooms, 2);
  });

  it("excludes anomalous minutes from the valid pool used by productivity / P50", () => {
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
    const validMinutes: number[] = [];

    for (const s of samples) {
      const { anomalous, durationMs } = sessionDurationBuckets({
        ...s,
        anomalyThresholdMinutes: threshold,
      });
      if (anomalous) {
        anomalousSessions += 1;
        totalExcludedMs += durationMs;
      } else {
        totalValidMs += durationMs;
        validMinutes.push(durationMs / 60_000);
      }
    }

    assert.equal(anomalousSessions, 1);
    assert.equal(totalValidMs, 30 * 60_000);
    assert.equal(totalExcludedMs, 300 * 60_000);
    assert.deepEqual(validMinutes, [30]);
  });
});

describe("sumValidSessionMs", () => {
  it("sums only non-anomalous sessions with finishedAt", () => {
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    const ms = sumValidSessionMs(
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
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    // Period session pool: completed task 30m + awaiting_inspection 60m
    let periodValidSessionMs = 0;
    for (const mins of [30, 60]) {
      const { anomalous, durationMs } = sessionDurationBuckets({
        startedAt: minsAgo(finishedAt, mins),
        finishedAt,
        anomalyFlags: [],
        anomalyThresholdMinutes: threshold,
      });
      if (!anomalous) periodValidSessionMs += durationMs;
    }
    const periodValidMinutes = periodValidSessionMs / 60_000;
    assert.equal(periodValidMinutes, 90);

    // Task-scoped: only the completed task contributes
    const completedTaskValidMs = sumValidSessionMs(
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
    assert.equal(avg, 30);
    assert.notEqual(avg, periodValidMinutes / tasksWithValidTime);
  });

  it("averages valid minutes across completed tasks only", () => {
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    const taskMs = [
      sumValidSessionMs(
        [
          {
            startedAt: minsAgo(finishedAt, 20),
            finishedAt,
            anomalyFlags: [],
          },
        ],
        threshold,
      ),
      sumValidSessionMs(
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
    for (const ms of taskMs) {
      if (ms > 0) {
        totalValidMsForTasks += ms;
        tasksWithValidTime += 1;
      }
    }
    assert.equal(
      avgValidMinutesFromTaskMs(totalValidMsForTasks, tasksWithValidTime),
      30,
    );
  });

  it("returns null when only awaiting_inspection sessions exist (no completed tasks with valid time)", () => {
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    const { anomalous, durationMs } = sessionDurationBuckets({
      startedAt: minsAgo(finishedAt, 60),
      finishedAt,
      anomalyFlags: [],
      anomalyThresholdMinutes: threshold,
    });
    assert.equal(anomalous, false);
    const totalValidSessionMinutes = durationMs / 60_000;
    assert.equal(totalValidSessionMinutes, 60);

    const totalValidMsForTasks = 0;
    const tasksWithValidTime = 0;
    assert.equal(
      avgValidMinutesFromTaskMs(totalValidMsForTasks, tasksWithValidTime),
      null,
    );
  });

  it("attributes task valid ms and task count to the same assignee for avg", () => {
    const finishedAt = new Date("2026-10-07T12:00:00.000Z");
    const assigneeId = "emp-assignee";
    const sessionWorkerId = "emp-session-worker";

    const completedTasks = [
      {
        assignedEmployeeId: assigneeId,
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

    const byAssignee = new Map<
      string,
      { totalValidMsForTasks: number; tasksWithValidTime: number }
    >();
    for (const task of completedTasks) {
      const validMs = sumValidSessionMs(task.sessions, threshold);
      if (validMs <= 0 || !task.assignedEmployeeId) continue;
      const agg = byAssignee.get(task.assignedEmployeeId) ?? {
        totalValidMsForTasks: 0,
        tasksWithValidTime: 0,
      };
      agg.totalValidMsForTasks += validMs;
      agg.tasksWithValidTime += 1;
      byAssignee.set(task.assignedEmployeeId, agg);
    }

    const assignee = byAssignee.get(assigneeId)!;
    assert.equal(assignee.tasksWithValidTime, 1);
    assert.equal(
      avgValidMinutesFromTaskMs(
        assignee.totalValidMsForTasks,
        assignee.tasksWithValidTime,
      ),
      45,
    );
    assert.equal(byAssignee.has(sessionWorkerId), false);
  });
});
