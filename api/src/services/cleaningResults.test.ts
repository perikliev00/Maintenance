import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAnomalousSession,
  sessionDurationBuckets,
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
