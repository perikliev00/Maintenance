import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Prisma } from "@prisma/client";
import { connectAssigneeAndShift } from "./tasks";

describe("connectAssigneeAndShift", () => {
  it("connects assignee and shift when task has neither", () => {
    const data: Prisma.CleaningTaskUpdateInput = {};
    connectAssigneeAndShift(
      data,
      { assignedEmployeeId: null, shiftId: null },
      "emp-1",
      "shift-1",
    );
    assert.deepEqual(data, {
      assignedEmployee: { connect: { id: "emp-1" } },
      shift: { connect: { id: "shift-1" } },
    });
  });

  it("preserves existing assignee and shift", () => {
    const data: Prisma.CleaningTaskUpdateInput = {};
    connectAssigneeAndShift(
      data,
      { assignedEmployeeId: "emp-old", shiftId: "shift-old" },
      "emp-new",
      "shift-new",
    );
    assert.deepEqual(data, {});
  });

  it("skips falsy new values", () => {
    const data: Prisma.CleaningTaskUpdateInput = {};
    connectAssigneeAndShift(
      data,
      { assignedEmployeeId: null, shiftId: null },
      undefined,
      null,
    );
    assert.deepEqual(data, {});
  });

  it("connects assignee only when shift already set", () => {
    const data: Prisma.CleaningTaskUpdateInput = {};
    connectAssigneeAndShift(
      data,
      { assignedEmployeeId: null, shiftId: "shift-old" },
      "emp-1",
      "shift-new",
    );
    assert.deepEqual(data, {
      assignedEmployee: { connect: { id: "emp-1" } },
    });
  });

  it("connects shift only when assignee already set", () => {
    const data: Prisma.CleaningTaskUpdateInput = {};
    connectAssigneeAndShift(
      data,
      { assignedEmployeeId: "emp-old", shiftId: null },
      "emp-new",
      "shift-1",
    );
    assert.deepEqual(data, {
      shift: { connect: { id: "shift-1" } },
    });
  });
});
