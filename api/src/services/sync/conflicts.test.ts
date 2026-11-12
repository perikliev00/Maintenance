// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module ./conflicts for this service.
import { accessLossConflictResult } from "./conflicts";

// Run next step: describe("accessLossConflictResult", () => {
describe("accessLossConflictResult", () => {
  // Run next step: it("returns assignee_conflict with task snapshot details", (…
  it("returns assignee_conflict with task snapshot details", () => {
    // Capture result for use in this scope.
    const result = accessLossConflictResult(
      // Run next step: "cmd-1",
      "cmd-1",
      // Run next step: {
      {
        // Set expectedVersion on the structure being built.
        expectedVersion: 1,
        // Set currentVersion on the structure being built.
        currentVersion: 4,
        // Set status on the structure being built.
        status: "assigned",
        // Set assignedEmployeeId on the structure being built.
        assignedEmployeeId: "emp-other",
      },
      // Run next step: "Outside your permitted data scope",
      "Outside your permitted data scope",
    );
    // Run next step: assert.equal(result.status, "conflict");
    assert.equal(result.status, "conflict");
    // Run next step: assert.equal(result.code, "assignee_conflict");
    assert.equal(result.code, "assignee_conflict");
    // Run next step: assert.equal(result.message, "Task was reassigned to another…
    assert.equal(result.message, "Task was reassigned to another employee");
    // Run next step: assert.deepEqual(result.details, {
    assert.deepEqual(result.details, {
      // Set expectedVersion on the structure being built.
      expectedVersion: 1,
      // Set currentVersion on the structure being built.
      currentVersion: 4,
      // Set status on the structure being built.
      status: "assigned",
      // Set assignedEmployeeId on the structure being built.
      assignedEmployeeId: "emp-other",
    });
  });

  // Run next step: it("returns out_of_scope when entity snapshot is missing", (…
  it("returns out_of_scope when entity snapshot is missing", () => {
    // Capture result for use in this scope.
    const result = accessLossConflictResult(
      // Run next step: "cmd-2",
      "cmd-2",
      // Run next step: undefined,
      undefined,
      // Run next step: "Outside your permitted data scope",
      "Outside your permitted data scope",
    );
    // Run next step: assert.equal(result.status, "conflict");
    assert.equal(result.status, "conflict");
    // Run next step: assert.equal(result.code, "out_of_scope");
    assert.equal(result.code, "out_of_scope");
    // Run next step: assert.equal(result.message, "Outside your permitted data sc…
    assert.equal(result.message, "Outside your permitted data scope");
    // Run next step: assert.equal(result.details, undefined);
    assert.equal(result.details, undefined);
  });
});
