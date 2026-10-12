import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accessLossConflictResult } from "./conflicts";

describe("accessLossConflictResult", () => {
  it("returns assignee_conflict with task snapshot details", () => {
    const result = accessLossConflictResult(
      "cmd-1",
      {
        expectedVersion: 1,
        currentVersion: 4,
        status: "assigned",
        assignedEmployeeId: "emp-other",
      },
      "Outside your permitted data scope",
    );
    assert.equal(result.status, "conflict");
    assert.equal(result.code, "assignee_conflict");
    assert.equal(result.message, "Task was reassigned to another employee");
    assert.deepEqual(result.details, {
      expectedVersion: 1,
      currentVersion: 4,
      status: "assigned",
      assignedEmployeeId: "emp-other",
    });
  });

  it("returns out_of_scope when entity snapshot is missing", () => {
    const result = accessLossConflictResult(
      "cmd-2",
      undefined,
      "Outside your permitted data scope",
    );
    assert.equal(result.status, "conflict");
    assert.equal(result.code, "out_of_scope");
    assert.equal(result.message, "Outside your permitted data scope");
    assert.equal(result.details, undefined);
  });
});
