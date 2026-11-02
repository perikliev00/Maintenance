/**
 * Fixed input→output characterization for assembleCleaningResults
 * (aggregation / sorting / pagination / hour series / acceptance).
 * Complements getCleaningResults.characterization (DB empty) and
 * tests/scenarios/analytics.db.test.ts (joined real rows).
 */
import assert from "node:assert/strict";
import { CleaningServiceType } from "@prisma/client";
import { describe, it } from "node:test";
import {
  assembleCleaningResults,
  type CleaningResultsSessionRow,
  type CleaningResultsTaskRow,
} from "./assembleCleaningResults";

const anomalyThresholdMinutes = 120; // 2× 60m overdue

function emp(id: string, name: string, num: string) {
  return { id, fullName: name, employeeNumber: num };
}

function session(input: {
  employee: ReturnType<typeof emp>;
  startedAt: string;
  finishedAt: string;
  anomalyFlags?: string[];
}): CleaningResultsSessionRow {
  return {
    employee: input.employee,
    startedAt: new Date(input.startedAt),
    finishedAt: new Date(input.finishedAt),
    anomalyFlags: input.anomalyFlags ?? [],
  };
}

function task(input: {
  locationId: string;
  serviceType?: CleaningServiceType;
  dueAt?: string | null;
  completedAt: string;
  assignedEmployee: ReturnType<typeof emp> | null;
  sessions?: CleaningResultsTaskRow["sessions"];
  inspections?: Array<{ id: string }>;
}): CleaningResultsTaskRow {
  return {
    locationId: input.locationId,
    serviceType: input.serviceType ?? CleaningServiceType.departure,
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
    completedAt: new Date(input.completedAt),
    assignedEmployee: input.assignedEmployee,
    sessions: input.sessions ?? [],
    inspections: input.inspections ?? [],
  };
}

describe("assembleCleaningResults characterization", () => {
  it("empty sources → zeroed summary, 24 zero hour buckets, empty page", () => {
    const report = assembleCleaningResults({
      query: {
        from: "1990-01-01",
        to: "1990-01-02",
        page: 1,
        pageSize: 10,
      },
      anomalyThresholdMinutes,
      sessions: [],
      completedTasks: [],
      approvedInspections: 0,
      rejectedInspections: 0,
      approvedRows: [],
      rejectedRows: [],
    });
    assert.deepEqual(report.period, { from: "1990-01-01", to: "1990-01-02" });
    assert.equal(report.summary.completedTasks, 0);
    assert.equal(report.summary.completedSessions, 0);
    assert.equal(report.summary.housekeeperCount, 0);
    assert.equal(report.summary.productivity, null);
    assert.equal(report.summary.onTimePct, null);
    assert.deepEqual(report.summary.byServiceType, []);
    assert.equal(report.series.length, 24);
    assert.ok(report.series.every((s, h) => s.hour === h && s.completedSessions === 0));
    assert.deepEqual(report.rows, []);
    assert.equal(report.total, 0);
  });

  it("skips sessions without finishedAt; UTC hour series uses finishedAt", () => {
    const a = emp("e1", "Ada", "1");
    const report = assembleCleaningResults({
      query: { from: "2000-01-10", to: "2000-01-10", page: 1, pageSize: 10 },
      anomalyThresholdMinutes,
      sessions: [
        {
          employee: a,
          startedAt: new Date("2000-01-10T09:00:00.000Z"),
          finishedAt: null,
          anomalyFlags: [],
        },
        session({
          employee: a,
          startedAt: "2000-01-10T09:00:00.000Z",
          finishedAt: "2000-01-10T10:15:00.000Z",
        }),
        session({
          employee: a,
          startedAt: "2000-01-10T13:00:00.000Z",
          finishedAt: "2000-01-10T13:20:00.000Z",
        }),
      ],
      completedTasks: [],
      approvedInspections: 0,
      rejectedInspections: 0,
      approvedRows: [],
      rejectedRows: [],
    });
    assert.equal(report.summary.completedSessions, 2);
    assert.equal(report.series[10]!.completedSessions, 1);
    assert.equal(report.series[13]!.completedSessions, 1);
    assert.equal(report.summary.housekeeperCount, 1);
  });

  it("anomalous duration / flags exclude session ms from productivity", () => {
    const a = emp("e1", "Ada", "1");
    // 150m > 120m threshold → anomalous even without flags
    const long = session({
      employee: a,
      startedAt: "2000-01-10T08:00:00.000Z",
      finishedAt: "2000-01-10T10:30:00.000Z",
    });
    const flagged = session({
      employee: a,
      startedAt: "2000-01-10T11:00:00.000Z",
      finishedAt: "2000-01-10T11:10:00.000Z",
      anomalyFlags: ["clock_skew"],
    });
    const ok = session({
      employee: a,
      startedAt: "2000-01-10T12:00:00.000Z",
      finishedAt: "2000-01-10T12:30:00.000Z",
    });
    const report = assembleCleaningResults({
      query: { from: "2000-01-10", to: "2000-01-10", page: 1, pageSize: 10 },
      anomalyThresholdMinutes,
      sessions: [long, flagged, ok],
      completedTasks: [
        task({
          locationId: "L1",
          completedAt: "2000-01-10T12:30:00.000Z",
          assignedEmployee: a,
          sessions: [
            {
              startedAt: ok.startedAt,
              finishedAt: ok.finishedAt,
              anomalyFlags: [],
              employeeId: a.id,
            },
          ],
        }),
      ],
      approvedInspections: 0,
      rejectedInspections: 0,
      approvedRows: [],
      rejectedRows: [],
    });
    assert.equal(report.summary.anomalousSessions, 2);
    assert.equal(report.summary.totalExcludedSessionMinutes, 160); // 150+10
    assert.equal(report.summary.totalValidSessionMinutes, 30);
    assert.equal(report.summary.productivity, 2); // 1 task / 0.5h
  });

  it("auto-accepted (no inspection) + approved counts; rejected is rework only", () => {
    const a = emp("e1", "Ada", "1");
    const b = emp("e2", "Bob", "2");
    const auto = task({
      locationId: "L1",
      completedAt: "2000-01-10T10:00:00.000Z",
      assignedEmployee: a,
      inspections: [],
    });
    const approved = task({
      locationId: "L2",
      completedAt: "2000-01-10T11:00:00.000Z",
      assignedEmployee: b,
      inspections: [{ id: "insp1" }],
    });
    const report = assembleCleaningResults({
      query: { from: "2000-01-10", to: "2000-01-10", page: 1, pageSize: 10 },
      anomalyThresholdMinutes,
      sessions: [],
      completedTasks: [auto, approved],
      approvedInspections: 1,
      rejectedInspections: 2,
      approvedRows: [{ task: { assignedEmployeeId: b.id } }],
      rejectedRows: [
        { task: { assignedEmployeeId: b.id } },
        { task: { assignedEmployeeId: null } }, // ignored
      ],
    });
    // acceptedTasks = approvedInspections(1) + autoAccepted(1)
    assert.equal(report.summary.acceptedTasks, 2);
    assert.equal(report.summary.reworkEvents, 2);
    const rowA = report.rows.find((r) => r.employeeId === a.id)!;
    const rowB = report.rows.find((r) => r.employeeId === b.id)!;
    assert.equal(rowA.acceptedTasks, 1); // auto
    assert.equal(rowB.acceptedTasks, 1); // approvedRows
    assert.equal(rowB.reworkEvents, 1);
  });

  it("on-time uses completedAt <= dueAt; unknown dueAt omitted from denominator", () => {
    const a = emp("e1", "Ada", "1");
    const report = assembleCleaningResults({
      query: { from: "2000-01-10", to: "2000-01-10", page: 1, pageSize: 10 },
      anomalyThresholdMinutes,
      sessions: [],
      completedTasks: [
        task({
          locationId: "L1",
          completedAt: "2000-01-10T10:00:00.000Z",
          dueAt: "2000-01-10T10:00:00.000Z",
          assignedEmployee: a,
        }),
        task({
          locationId: "L2",
          completedAt: "2000-01-10T10:00:01.000Z",
          dueAt: "2000-01-10T10:00:00.000Z",
          assignedEmployee: a,
        }),
        task({
          locationId: "L3",
          completedAt: "2000-01-10T10:00:00.000Z",
          dueAt: null,
          assignedEmployee: a,
        }),
      ],
      approvedInspections: 0,
      rejectedInspections: 0,
      approvedRows: [],
      rejectedRows: [],
    });
    assert.equal(report.summary.onTimePct, 50);
    assert.equal(report.rows[0]!.onTimePct, 50);
  });

  it("byServiceType sorts by count desc then key; pagination preserves total order", () => {
    const a = emp("e-a", "Same", "1");
    const b = emp("e-b", "Same", "2");
    const c = emp("e-c", "Same", "3");
    // Equal task counts → tie-break sessions then name/id
    const tasks = [
      task({
        locationId: "L1",
        serviceType: CleaningServiceType.stayover,
        completedAt: "2000-01-10T10:00:00.000Z",
        assignedEmployee: a,
      }),
      task({
        locationId: "L2",
        serviceType: CleaningServiceType.departure,
        completedAt: "2000-01-10T10:00:00.000Z",
        assignedEmployee: b,
      }),
      task({
        locationId: "L3",
        serviceType: CleaningServiceType.departure,
        completedAt: "2000-01-10T10:00:00.000Z",
        assignedEmployee: c,
      }),
    ];
    const sessions = [
      session({
        employee: c,
        startedAt: "2000-01-10T09:00:00.000Z",
        finishedAt: "2000-01-10T09:10:00.000Z",
      }),
      session({
        employee: c,
        startedAt: "2000-01-10T09:20:00.000Z",
        finishedAt: "2000-01-10T09:30:00.000Z",
      }),
    ];
    const full = assembleCleaningResults({
      query: { from: "2000-01-10", to: "2000-01-10", page: 1, pageSize: 100 },
      anomalyThresholdMinutes,
      sessions,
      completedTasks: tasks,
      approvedInspections: 0,
      rejectedInspections: 0,
      approvedRows: [],
      rejectedRows: [],
    });
    assert.deepEqual(full.summary.byServiceType, [
      { key: CleaningServiceType.departure, count: 2 },
      { key: CleaningServiceType.stayover, count: 1 },
    ]);
    // c has more sessions → first; then a/b by employeeId localeCompare
    assert.deepEqual(
      full.rows.map((r) => r.employeeId),
      ["e-c", "e-a", "e-b"],
    );

    const page2 = assembleCleaningResults({
      query: { from: "2000-01-10", to: "2000-01-10", page: 2, pageSize: 1 },
      anomalyThresholdMinutes,
      sessions,
      completedTasks: tasks,
      approvedInspections: 0,
      rejectedInspections: 0,
      approvedRows: [],
      rejectedRows: [],
    });
    assert.equal(page2.total, 3);
    assert.equal(page2.rows.length, 1);
    assert.equal(page2.rows[0]!.employeeId, "e-a");
    // Summary is full-period (not page-scoped)
    assert.equal(page2.summary.completedTasks, 3);
  });

  it("unassigned completed tasks still count in summary rooms/serviceType", () => {
    const report = assembleCleaningResults({
      query: { from: "2000-01-10", to: "2000-01-10", page: 1, pageSize: 10 },
      anomalyThresholdMinutes,
      sessions: [],
      completedTasks: [
        task({
          locationId: "L9",
          completedAt: "2000-01-10T10:00:00.000Z",
          assignedEmployee: null,
          serviceType: CleaningServiceType.departure,
        }),
      ],
      approvedInspections: 0,
      rejectedInspections: 0,
      approvedRows: [],
      rejectedRows: [],
    });
    assert.equal(report.summary.completedTasks, 1);
    assert.equal(report.summary.distinctRooms, 1);
    assert.equal(report.rows.length, 0);
    assert.equal(report.total, 0);
    assert.equal(report.summary.housekeeperCount, 0);
  });
});
