// Import node:assert/strict for dailyPlanEffects/tasks.test.ts.
import assert from "node:assert/strict";
// Import node:test for dailyPlanEffects/tasks.test.ts.
import { describe, it } from "node:test";
// Type-only import from @prisma/client used by dailyPlanEffects/tasks.test.ts.
import type { Prisma } from "@prisma/client";
// Import ./tasks for dailyPlanEffects/tasks.test.ts.
import { connectAssigneeAndShift } from "./tasks";

// Begin block/object for the following statements.
describe("connectAssigneeAndShift", () => {
  // Begin block/object for the following statements.
  it("connects assignee and shift when task has neither", () => {
    // Execute: const data: Prisma.CleaningTaskUpdateInput = {};
    const data: Prisma.CleaningTaskUpdateInput = {};
    // Execute: connectAssigneeAndShift(
    connectAssigneeAndShift(
      // Carry this field through the payload or query.
      data,
      // Execute: { assignedEmployeeId: null, shiftId: null },
      { assignedEmployeeId: null, shiftId: null },
      // Execute: "emp-1",
      "emp-1",
      // Execute: "shift-1",
      "shift-1",
    );
    // Begin block/object for the following statements.
    assert.deepEqual(data, {
      // Field value required by this payload or query.
      assignedEmployee: { connect: { id: "emp-1" } },
      // Field value required by this payload or query.
      shift: { connect: { id: "shift-1" } },
    });
  });

  // Begin block/object for the following statements.
  it("preserves existing assignee and shift", () => {
    // Execute: const data: Prisma.CleaningTaskUpdateInput = {};
    const data: Prisma.CleaningTaskUpdateInput = {};
    // Execute: connectAssigneeAndShift(
    connectAssigneeAndShift(
      // Carry this field through the payload or query.
      data,
      // Execute: { assignedEmployeeId: "emp-old", shiftId: "shift-old" },
      { assignedEmployeeId: "emp-old", shiftId: "shift-old" },
      // Execute: "emp-new",
      "emp-new",
      // Execute: "shift-new",
      "shift-new",
    );
    // Execute: assert.deepEqual(data, {});
    assert.deepEqual(data, {});
  });

  // Begin block/object for the following statements.
  it("skips falsy new values", () => {
    // Execute: const data: Prisma.CleaningTaskUpdateInput = {};
    const data: Prisma.CleaningTaskUpdateInput = {};
    // Execute: connectAssigneeAndShift(
    connectAssigneeAndShift(
      // Carry this field through the payload or query.
      data,
      // Execute: { assignedEmployeeId: null, shiftId: null },
      { assignedEmployeeId: null, shiftId: null },
      // Carry this field through the payload or query.
      undefined,
      // Field value required by this payload or query.
      null,
    );
    // Execute: assert.deepEqual(data, {});
    assert.deepEqual(data, {});
  });

  // Begin block/object for the following statements.
  it("connects assignee only when shift already set", () => {
    // Execute: const data: Prisma.CleaningTaskUpdateInput = {};
    const data: Prisma.CleaningTaskUpdateInput = {};
    // Execute: connectAssigneeAndShift(
    connectAssigneeAndShift(
      // Carry this field through the payload or query.
      data,
      // Execute: { assignedEmployeeId: null, shiftId: "shift-old" },
      { assignedEmployeeId: null, shiftId: "shift-old" },
      // Execute: "emp-1",
      "emp-1",
      // Execute: "shift-new",
      "shift-new",
    );
    // Begin block/object for the following statements.
    assert.deepEqual(data, {
      // Field value required by this payload or query.
      assignedEmployee: { connect: { id: "emp-1" } },
    });
  });

  // Begin block/object for the following statements.
  it("connects shift only when assignee already set", () => {
    // Execute: const data: Prisma.CleaningTaskUpdateInput = {};
    const data: Prisma.CleaningTaskUpdateInput = {};
    // Execute: connectAssigneeAndShift(
    connectAssigneeAndShift(
      // Carry this field through the payload or query.
      data,
      // Execute: { assignedEmployeeId: "emp-old", shiftId: null },
      { assignedEmployeeId: "emp-old", shiftId: null },
      // Execute: "emp-new",
      "emp-new",
      // Execute: "shift-1",
      "shift-1",
    );
    // Begin block/object for the following statements.
    assert.deepEqual(data, {
      // Field value required by this payload or query.
      shift: { connect: { id: "shift-1" } },
    });
  });
});
