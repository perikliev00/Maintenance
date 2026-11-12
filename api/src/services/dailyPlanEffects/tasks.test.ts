// Import node:assert/strict for dailyPlanEffects/tasks.test.ts.
import assert from "node:assert/strict";
// Import node:test for dailyPlanEffects/tasks.test.ts.
import { describe, it } from "node:test";
import type { Prisma } from "@prisma/client";
// Import ./tasks for dailyPlanEffects/tasks.test.ts.
import { connectAssigneeAndShift } from "./tasks";

describe("connectAssigneeAndShift", () => {
  it("connects assignee and shift when task has neither", () => {
    // Execute: const data: Prisma.CleaningTaskUpdateInput = {};
    const data: Prisma.CleaningTaskUpdateInput = {};
    // Execute: connectAssigneeAndShift(
    connectAssigneeAndShift(
      data,
      // Execute: { assignedEmployeeId: null, shiftId: null },
      { assignedEmployeeId: null, shiftId: null },
      // Execute: "emp-1",
      "emp-1",
      // Execute: "shift-1",
      "shift-1",
    );
    assert.deepEqual(data, {
      assignedEmployee: { connect: { id: "emp-1" } },
      shift: { connect: { id: "shift-1" } },
    });
  });

  it("preserves existing assignee and shift", () => {
    // Execute: const data: Prisma.CleaningTaskUpdateInput = {};
    const data: Prisma.CleaningTaskUpdateInput = {};
    // Execute: connectAssigneeAndShift(
    connectAssigneeAndShift(
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

  it("skips falsy new values", () => {
    // Execute: const data: Prisma.CleaningTaskUpdateInput = {};
    const data: Prisma.CleaningTaskUpdateInput = {};
    // Execute: connectAssigneeAndShift(
    connectAssigneeAndShift(
      data,
      // Execute: { assignedEmployeeId: null, shiftId: null },
      { assignedEmployeeId: null, shiftId: null },
      undefined,
      null,
    );
    // Execute: assert.deepEqual(data, {});
    assert.deepEqual(data, {});
  });

  it("connects assignee only when shift already set", () => {
    // Execute: const data: Prisma.CleaningTaskUpdateInput = {};
    const data: Prisma.CleaningTaskUpdateInput = {};
    // Execute: connectAssigneeAndShift(
    connectAssigneeAndShift(
      data,
      // Execute: { assignedEmployeeId: null, shiftId: "shift-old" },
      { assignedEmployeeId: null, shiftId: "shift-old" },
      // Execute: "emp-1",
      "emp-1",
      // Execute: "shift-new",
      "shift-new",
    );
    assert.deepEqual(data, {
      assignedEmployee: { connect: { id: "emp-1" } },
    });
  });

  it("connects shift only when assignee already set", () => {
    // Execute: const data: Prisma.CleaningTaskUpdateInput = {};
    const data: Prisma.CleaningTaskUpdateInput = {};
    // Execute: connectAssigneeAndShift(
    connectAssigneeAndShift(
      data,
      // Execute: { assignedEmployeeId: "emp-old", shiftId: null },
      { assignedEmployeeId: "emp-old", shiftId: null },
      // Execute: "emp-new",
      "emp-new",
      // Execute: "shift-1",
      "shift-1",
    );
    assert.deepEqual(data, {
      shift: { connect: { id: "shift-1" } },
    });
  });
});
