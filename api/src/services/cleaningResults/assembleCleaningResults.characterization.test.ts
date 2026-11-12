/**
 * Fixed input→output characterization for assembleCleaningResults
 * (aggregation / sorting / pagination / hour series / acceptance).
 * Complements getCleaningResults.characterization (DB empty) and
 * tests/scenarios/analytics.db.test.ts (joined real rows).
 */
import assert from "node:assert/strict";
// Import @prisma/client for cleaningResults/assembleCleaningResults.characterization.test.ts.
import { CleaningServiceType } from "@prisma/client";
// Import node:test for cleaningResults/assembleCleaningResults.characterization.test.ts.
import { describe, it } from "node:test";
// Side-effect or default import required by this module.
import {
  // Carry this field through the payload or query.
  assembleCleaningResults,
  // Local structural type for this module's contracts.
  type CleaningResultsSessionRow,
  // Local structural type for this module's contracts.
  type CleaningResultsTaskRow,
// Execute: } from "./assembleCleaningResults";
} from "./assembleCleaningResults";

// Capture anomalyThresholdMinutes for subsequent checks or writes.
const anomalyThresholdMinutes = 120; // 2× 60m overdue

// Local helper emp keeps the main flow readable.
function emp(id: string, name: string, num: string) {
  // Return the computed result to the caller.
  return { id, fullName: name, employeeNumber: num };
}

// Local helper session keeps the main flow readable.
function session(input: {
  // Carry this field through the payload or query.
  employee: ReturnType<typeof emp>;
  // Carry this field through the payload or query.
  startedAt: string;
  // Carry this field through the payload or query.
  finishedAt: string;
  // Parameter/field in the surrounding signature or type.
  anomalyFlags?: string[];
// Begin block/object for the following statements.
}): CleaningResultsSessionRow {
  // Return the computed result to the caller.
  return {
    // Carry this field through the payload or query.
    employee: input.employee,
    // Carry this field through the payload or query.
    startedAt: new Date(input.startedAt),
    // Carry this field through the payload or query.
    finishedAt: new Date(input.finishedAt),
    // Carry this field through the payload or query.
    anomalyFlags: input.anomalyFlags ?? [],
  };
}

// Local helper task keeps the main flow readable.
function task(input: {
  // Carry this field through the payload or query.
  locationId: string;
  // Parameter/field in the surrounding signature or type.
  serviceType?: CleaningServiceType;
  // Parameter/field in the surrounding signature or type.
  dueAt?: string | null;
  // Carry this field through the payload or query.
  completedAt: string;
  // Field value required by this payload or query.
  assignedEmployee: ReturnType<typeof emp> | null;
  // Parameter/field in the surrounding signature or type.
  sessions?: CleaningResultsTaskRow["sessions"];
  // Parameter/field in the surrounding signature or type.
  inspections?: Array<{ id: string }>;
// Begin block/object for the following statements.
}): CleaningResultsTaskRow {
  // Return the computed result to the caller.
  return {
    // Carry this field through the payload or query.
    locationId: input.locationId,
    // Carry this field through the payload or query.
    serviceType: input.serviceType ?? CleaningServiceType.departure,
    // Field value required by this payload or query.
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
    // Carry this field through the payload or query.
    completedAt: new Date(input.completedAt),
    // Carry this field through the payload or query.
    assignedEmployee: input.assignedEmployee,
    // Carry this field through the payload or query.
    sessions: input.sessions ?? [],
    // Carry this field through the payload or query.
    inspections: input.inspections ?? [],
  };
}

// Begin block/object for the following statements.
describe("assembleCleaningResults characterization", () => {
  // Begin block/object for the following statements.
  it("empty sources → zeroed summary, 24 zero hour buckets, empty page", () => {
    // Capture report for subsequent checks or writes.
    const report = assembleCleaningResults({
      // Open nested structure for the next related fields.
      query: {
        // Field value required by this payload or query.
        from: "1990-01-01",
        // Field value required by this payload or query.
        to: "1990-01-02",
        // Field value required by this payload or query.
        page: 1,
        // Field value required by this payload or query.
        pageSize: 10,
      },
      // Carry this field through the payload or query.
      anomalyThresholdMinutes,
      // Carry this field through the payload or query.
      sessions: [],
      // Carry this field through the payload or query.
      completedTasks: [],
      // Field value required by this payload or query.
      approvedInspections: 0,
      // Field value required by this payload or query.
      rejectedInspections: 0,
      // Carry this field through the payload or query.
      approvedRows: [],
      // Carry this field through the payload or query.
      rejectedRows: [],
    });
    // Execute: assert.deepEqual(report.period, { from: "1990-01-01", to: "1990-01-02" });
    assert.deepEqual(report.period, { from: "1990-01-01", to: "1990-01-02" });
    // Execute: assert.equal(report.summary.completedTasks, 0);
    assert.equal(report.summary.completedTasks, 0);
    // Execute: assert.equal(report.summary.completedSessions, 0);
    assert.equal(report.summary.completedSessions, 0);
    // Execute: assert.equal(report.summary.housekeeperCount, 0);
    assert.equal(report.summary.housekeeperCount, 0);
    // Execute: assert.equal(report.summary.productivity, null);
    assert.equal(report.summary.productivity, null);
    // Execute: assert.equal(report.summary.onTimePct, null);
    assert.equal(report.summary.onTimePct, null);
    // Execute: assert.deepEqual(report.summary.byServiceType, []);
    assert.deepEqual(report.summary.byServiceType, []);
    // Execute: assert.equal(report.series.length, 24);
    assert.equal(report.series.length, 24);
    // Execute: assert.ok(report.series.every((s, h) => s.hour === h && s.completedSessions =...
    assert.ok(report.series.every((s, h) => s.hour === h && s.completedSessions === 0));
    // Execute: assert.deepEqual(report.rows, []);
    assert.deepEqual(report.rows, []);
    // Execute: assert.equal(report.total, 0);
    assert.equal(report.total, 0);
  });

  // Begin block/object for the following statements.
  it("skips sessions without finishedAt; UTC hour series uses finishedAt", () => {
    // Capture a for subsequent checks or writes.
    const a = emp("e1", "Ada", "1");
    // Capture report for subsequent checks or writes.
    const report = assembleCleaningResults({
      // Field value required by this payload or query.
      query: { from: "2000-01-10", to: "2000-01-10", page: 1, pageSize: 10 },
      // Carry this field through the payload or query.
      anomalyThresholdMinutes,
      // Open nested structure for the next related fields.
      sessions: [
        // Begin block/object for the following statements.
        {
          // Carry this field through the payload or query.
          employee: a,
          // Field value required by this payload or query.
          startedAt: new Date("2000-01-10T09:00:00.000Z"),
          // Field value required by this payload or query.
          finishedAt: null,
          // Carry this field through the payload or query.
          anomalyFlags: [],
        },
        // Begin block/object for the following statements.
        session({
          // Carry this field through the payload or query.
          employee: a,
          // Field value required by this payload or query.
          startedAt: "2000-01-10T09:00:00.000Z",
          // Field value required by this payload or query.
          finishedAt: "2000-01-10T10:15:00.000Z",
        }),
        // Begin block/object for the following statements.
        session({
          // Carry this field through the payload or query.
          employee: a,
          // Field value required by this payload or query.
          startedAt: "2000-01-10T13:00:00.000Z",
          // Field value required by this payload or query.
          finishedAt: "2000-01-10T13:20:00.000Z",
        }),
      ],
      // Carry this field through the payload or query.
      completedTasks: [],
      // Field value required by this payload or query.
      approvedInspections: 0,
      // Field value required by this payload or query.
      rejectedInspections: 0,
      // Carry this field through the payload or query.
      approvedRows: [],
      // Carry this field through the payload or query.
      rejectedRows: [],
    });
    // Execute: assert.equal(report.summary.completedSessions, 2);
    assert.equal(report.summary.completedSessions, 2);
    // Execute: assert.equal(report.series[10]!.completedSessions, 1);
    assert.equal(report.series[10]!.completedSessions, 1);
    // Execute: assert.equal(report.series[13]!.completedSessions, 1);
    assert.equal(report.series[13]!.completedSessions, 1);
    // Execute: assert.equal(report.summary.housekeeperCount, 1);
    assert.equal(report.summary.housekeeperCount, 1);
  });

  // Begin block/object for the following statements.
  it("anomalous duration / flags exclude session ms from productivity", () => {
    // Capture a for subsequent checks or writes.
    const a = emp("e1", "Ada", "1");
    // 150m > 120m threshold → anomalous even without flags
    const long = session({
      // Carry this field through the payload or query.
      employee: a,
      // Field value required by this payload or query.
      startedAt: "2000-01-10T08:00:00.000Z",
      // Field value required by this payload or query.
      finishedAt: "2000-01-10T10:30:00.000Z",
    });
    // Capture flagged for subsequent checks or writes.
    const flagged = session({
      // Carry this field through the payload or query.
      employee: a,
      // Field value required by this payload or query.
      startedAt: "2000-01-10T11:00:00.000Z",
      // Field value required by this payload or query.
      finishedAt: "2000-01-10T11:10:00.000Z",
      // Field value required by this payload or query.
      anomalyFlags: ["clock_skew"],
    });
    // Capture ok for subsequent checks or writes.
    const ok = session({
      // Carry this field through the payload or query.
      employee: a,
      // Field value required by this payload or query.
      startedAt: "2000-01-10T12:00:00.000Z",
      // Field value required by this payload or query.
      finishedAt: "2000-01-10T12:30:00.000Z",
    });
    // Capture report for subsequent checks or writes.
    const report = assembleCleaningResults({
      // Field value required by this payload or query.
      query: { from: "2000-01-10", to: "2000-01-10", page: 1, pageSize: 10 },
      // Carry this field through the payload or query.
      anomalyThresholdMinutes,
      // Carry this field through the payload or query.
      sessions: [long, flagged, ok],
      // Open nested structure for the next related fields.
      completedTasks: [
        // Begin block/object for the following statements.
        task({
          // Field value required by this payload or query.
          locationId: "L1",
          // Field value required by this payload or query.
          completedAt: "2000-01-10T12:30:00.000Z",
          // Carry this field through the payload or query.
          assignedEmployee: a,
          // Open nested structure for the next related fields.
          sessions: [
            // Begin block/object for the following statements.
            {
              // Carry this field through the payload or query.
              startedAt: ok.startedAt,
              // Carry this field through the payload or query.
              finishedAt: ok.finishedAt,
              // Carry this field through the payload or query.
              anomalyFlags: [],
              // Carry this field through the payload or query.
              employeeId: a.id,
            },
          ],
        }),
      ],
      // Field value required by this payload or query.
      approvedInspections: 0,
      // Field value required by this payload or query.
      rejectedInspections: 0,
      // Carry this field through the payload or query.
      approvedRows: [],
      // Carry this field through the payload or query.
      rejectedRows: [],
    });
    // Execute: assert.equal(report.summary.anomalousSessions, 2);
    assert.equal(report.summary.anomalousSessions, 2);
    // Execute: assert.equal(report.summary.totalExcludedSessionMinutes, 160); // 150+10
    assert.equal(report.summary.totalExcludedSessionMinutes, 160); // 150+10
    // Execute: assert.equal(report.summary.totalValidSessionMinutes, 30);
    assert.equal(report.summary.totalValidSessionMinutes, 30);
    // Execute: assert.equal(report.summary.productivity, 2); // 1 task / 0.5h
    assert.equal(report.summary.productivity, 2); // 1 task / 0.5h
  });

  // Begin block/object for the following statements.
  it("auto-accepted (no inspection) + approved counts; rejected is rework only", () => {
    // Capture a for subsequent checks or writes.
    const a = emp("e1", "Ada", "1");
    // Capture b for subsequent checks or writes.
    const b = emp("e2", "Bob", "2");
    // Capture auto for subsequent checks or writes.
    const auto = task({
      // Field value required by this payload or query.
      locationId: "L1",
      // Field value required by this payload or query.
      completedAt: "2000-01-10T10:00:00.000Z",
      // Carry this field through the payload or query.
      assignedEmployee: a,
      // Carry this field through the payload or query.
      inspections: [],
    });
    // Capture approved for subsequent checks or writes.
    const approved = task({
      // Field value required by this payload or query.
      locationId: "L2",
      // Field value required by this payload or query.
      completedAt: "2000-01-10T11:00:00.000Z",
      // Carry this field through the payload or query.
      assignedEmployee: b,
      // Field value required by this payload or query.
      inspections: [{ id: "insp1" }],
    });
    // Capture report for subsequent checks or writes.
    const report = assembleCleaningResults({
      // Field value required by this payload or query.
      query: { from: "2000-01-10", to: "2000-01-10", page: 1, pageSize: 10 },
      // Carry this field through the payload or query.
      anomalyThresholdMinutes,
      // Carry this field through the payload or query.
      sessions: [],
      // Carry this field through the payload or query.
      completedTasks: [auto, approved],
      // Field value required by this payload or query.
      approvedInspections: 1,
      // Field value required by this payload or query.
      rejectedInspections: 2,
      // Carry this field through the payload or query.
      approvedRows: [{ task: { assignedEmployeeId: b.id } }],
      // Open nested structure for the next related fields.
      rejectedRows: [
        // Execute: { task: { assignedEmployeeId: b.id } },
        { task: { assignedEmployeeId: b.id } },
        // Execute: { task: { assignedEmployeeId: null } }, // ignored
        { task: { assignedEmployeeId: null } }, // ignored
      ],
    });
    // acceptedTasks = approvedInspections(1) + autoAccepted(1)
    assert.equal(report.summary.acceptedTasks, 2);
    // Execute: assert.equal(report.summary.reworkEvents, 2);
    assert.equal(report.summary.reworkEvents, 2);
    // Persist or query via Prisma into rowA.
    const rowA = report.rows.find((r) => r.employeeId === a.id)!;
    // Persist or query via Prisma into rowB.
    const rowB = report.rows.find((r) => r.employeeId === b.id)!;
    // Execute: assert.equal(rowA.acceptedTasks, 1); // auto
    assert.equal(rowA.acceptedTasks, 1); // auto
    // Execute: assert.equal(rowB.acceptedTasks, 1); // approvedRows
    assert.equal(rowB.acceptedTasks, 1); // approvedRows
    // Execute: assert.equal(rowB.reworkEvents, 1);
    assert.equal(rowB.reworkEvents, 1);
  });

  // Begin block/object for the following statements.
  it("on-time uses completedAt <= dueAt; unknown dueAt omitted from denominator", () => {
    // Capture a for subsequent checks or writes.
    const a = emp("e1", "Ada", "1");
    // Capture report for subsequent checks or writes.
    const report = assembleCleaningResults({
      // Field value required by this payload or query.
      query: { from: "2000-01-10", to: "2000-01-10", page: 1, pageSize: 10 },
      // Carry this field through the payload or query.
      anomalyThresholdMinutes,
      // Carry this field through the payload or query.
      sessions: [],
      // Open nested structure for the next related fields.
      completedTasks: [
        // Begin block/object for the following statements.
        task({
          // Field value required by this payload or query.
          locationId: "L1",
          // Field value required by this payload or query.
          completedAt: "2000-01-10T10:00:00.000Z",
          // Field value required by this payload or query.
          dueAt: "2000-01-10T10:00:00.000Z",
          // Carry this field through the payload or query.
          assignedEmployee: a,
        }),
        // Begin block/object for the following statements.
        task({
          // Field value required by this payload or query.
          locationId: "L2",
          // Field value required by this payload or query.
          completedAt: "2000-01-10T10:00:01.000Z",
          // Field value required by this payload or query.
          dueAt: "2000-01-10T10:00:00.000Z",
          // Carry this field through the payload or query.
          assignedEmployee: a,
        }),
        // Begin block/object for the following statements.
        task({
          // Field value required by this payload or query.
          locationId: "L3",
          // Field value required by this payload or query.
          completedAt: "2000-01-10T10:00:00.000Z",
          // Field value required by this payload or query.
          dueAt: null,
          // Carry this field through the payload or query.
          assignedEmployee: a,
        }),
      ],
      // Field value required by this payload or query.
      approvedInspections: 0,
      // Field value required by this payload or query.
      rejectedInspections: 0,
      // Carry this field through the payload or query.
      approvedRows: [],
      // Carry this field through the payload or query.
      rejectedRows: [],
    });
    // Execute: assert.equal(report.summary.onTimePct, 50);
    assert.equal(report.summary.onTimePct, 50);
    // Execute: assert.equal(report.rows[0]!.onTimePct, 50);
    assert.equal(report.rows[0]!.onTimePct, 50);
  });

  // Begin block/object for the following statements.
  it("byServiceType sorts by count desc then key; pagination preserves total order", () => {
    // Capture a for subsequent checks or writes.
    const a = emp("e-a", "Same", "1");
    // Capture b for subsequent checks or writes.
    const b = emp("e-b", "Same", "2");
    // Capture c for subsequent checks or writes.
    const c = emp("e-c", "Same", "3");
    // Equal task counts → tie-break sessions then name/id
    const tasks = [
      // Begin block/object for the following statements.
      task({
        // Field value required by this payload or query.
        locationId: "L1",
        // Carry this field through the payload or query.
        serviceType: CleaningServiceType.stayover,
        // Field value required by this payload or query.
        completedAt: "2000-01-10T10:00:00.000Z",
        // Carry this field through the payload or query.
        assignedEmployee: a,
      }),
      // Begin block/object for the following statements.
      task({
        // Field value required by this payload or query.
        locationId: "L2",
        // Carry this field through the payload or query.
        serviceType: CleaningServiceType.departure,
        // Field value required by this payload or query.
        completedAt: "2000-01-10T10:00:00.000Z",
        // Carry this field through the payload or query.
        assignedEmployee: b,
      }),
      // Begin block/object for the following statements.
      task({
        // Field value required by this payload or query.
        locationId: "L3",
        // Carry this field through the payload or query.
        serviceType: CleaningServiceType.departure,
        // Field value required by this payload or query.
        completedAt: "2000-01-10T10:00:00.000Z",
        // Carry this field through the payload or query.
        assignedEmployee: c,
      }),
    ];
    // Capture sessions for subsequent checks or writes.
    const sessions = [
      // Begin block/object for the following statements.
      session({
        // Carry this field through the payload or query.
        employee: c,
        // Field value required by this payload or query.
        startedAt: "2000-01-10T09:00:00.000Z",
        // Field value required by this payload or query.
        finishedAt: "2000-01-10T09:10:00.000Z",
      }),
      // Begin block/object for the following statements.
      session({
        // Carry this field through the payload or query.
        employee: c,
        // Field value required by this payload or query.
        startedAt: "2000-01-10T09:20:00.000Z",
        // Field value required by this payload or query.
        finishedAt: "2000-01-10T09:30:00.000Z",
      }),
    ];
    // Capture full for subsequent checks or writes.
    const full = assembleCleaningResults({
      // Field value required by this payload or query.
      query: { from: "2000-01-10", to: "2000-01-10", page: 1, pageSize: 100 },
      // Carry this field through the payload or query.
      anomalyThresholdMinutes,
      // Carry this field through the payload or query.
      sessions,
      // Carry this field through the payload or query.
      completedTasks: tasks,
      // Field value required by this payload or query.
      approvedInspections: 0,
      // Field value required by this payload or query.
      rejectedInspections: 0,
      // Carry this field through the payload or query.
      approvedRows: [],
      // Carry this field through the payload or query.
      rejectedRows: [],
    });
    // Begin list of values/items for this step.
    assert.deepEqual(full.summary.byServiceType, [
      // Execute: { key: CleaningServiceType.departure, count: 2 },
      { key: CleaningServiceType.departure, count: 2 },
      // Execute: { key: CleaningServiceType.stayover, count: 1 },
      { key: CleaningServiceType.stayover, count: 1 },
    ]);
    // c has more sessions → first; then a/b by employeeId localeCompare
    assert.deepEqual(
      // Execute: full.rows.map((r) => r.employeeId),
      full.rows.map((r) => r.employeeId),
      // Execute: ["e-c", "e-a", "e-b"],
      ["e-c", "e-a", "e-b"],
    );

    // Capture page2 for subsequent checks or writes.
    const page2 = assembleCleaningResults({
      // Field value required by this payload or query.
      query: { from: "2000-01-10", to: "2000-01-10", page: 2, pageSize: 1 },
      // Carry this field through the payload or query.
      anomalyThresholdMinutes,
      // Carry this field through the payload or query.
      sessions,
      // Carry this field through the payload or query.
      completedTasks: tasks,
      // Field value required by this payload or query.
      approvedInspections: 0,
      // Field value required by this payload or query.
      rejectedInspections: 0,
      // Carry this field through the payload or query.
      approvedRows: [],
      // Carry this field through the payload or query.
      rejectedRows: [],
    });
    // Execute: assert.equal(page2.total, 3);
    assert.equal(page2.total, 3);
    // Execute: assert.equal(page2.rows.length, 1);
    assert.equal(page2.rows.length, 1);
    // Execute: assert.equal(page2.rows[0]!.employeeId, "e-a");
    assert.equal(page2.rows[0]!.employeeId, "e-a");
    // Summary is full-period (not page-scoped)
    assert.equal(page2.summary.completedTasks, 3);
  });

  // Begin block/object for the following statements.
  it("unassigned completed tasks still count in summary rooms/serviceType", () => {
    // Capture report for subsequent checks or writes.
    const report = assembleCleaningResults({
      // Field value required by this payload or query.
      query: { from: "2000-01-10", to: "2000-01-10", page: 1, pageSize: 10 },
      // Carry this field through the payload or query.
      anomalyThresholdMinutes,
      // Carry this field through the payload or query.
      sessions: [],
      // Open nested structure for the next related fields.
      completedTasks: [
        // Begin block/object for the following statements.
        task({
          // Field value required by this payload or query.
          locationId: "L9",
          // Field value required by this payload or query.
          completedAt: "2000-01-10T10:00:00.000Z",
          // Field value required by this payload or query.
          assignedEmployee: null,
          // Carry this field through the payload or query.
          serviceType: CleaningServiceType.departure,
        }),
      ],
      // Field value required by this payload or query.
      approvedInspections: 0,
      // Field value required by this payload or query.
      rejectedInspections: 0,
      // Carry this field through the payload or query.
      approvedRows: [],
      // Carry this field through the payload or query.
      rejectedRows: [],
    });
    // Execute: assert.equal(report.summary.completedTasks, 1);
    assert.equal(report.summary.completedTasks, 1);
    // Execute: assert.equal(report.summary.distinctRooms, 1);
    assert.equal(report.summary.distinctRooms, 1);
    // Execute: assert.equal(report.rows.length, 0);
    assert.equal(report.rows.length, 0);
    // Execute: assert.equal(report.total, 0);
    assert.equal(report.total, 0);
    // Execute: assert.equal(report.summary.housekeeperCount, 0);
    assert.equal(report.summary.housekeeperCount, 0);
  });
});
