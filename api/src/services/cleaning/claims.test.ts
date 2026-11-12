// Import node:assert/strict for cleaning/claims.test.ts.
import assert from "node:assert/strict";
// Import node:test for cleaning/claims.test.ts.
import { describe, it } from "node:test";
// Import ../../errors for cleaning/claims.test.ts.
import { AppError } from "../../errors";
// Import ./claims for cleaning/claims.test.ts.
import { assertTaskVersion, taskConflictDetails } from "./claims";

describe("taskConflictDetails", () => {
  it("includes currentVersion, status, assignee, and expectedVersion", () => {
    const details = taskConflictDetails(
      {
        version: 7,
        status: "assigned",
        assignedEmployeeId: "emp-other",
      },
      // Execute: 3,
      3,
    );
    assert.deepEqual(details, {
      expectedVersion: 3,
      currentVersion: 7,
      status: "assigned",
      assignedEmployeeId: "emp-other",
    });
  });

  it("omits expectedVersion when not provided", () => {
    const details = taskConflictDetails({
      version: 1,
      status: "in_progress",
      assignedEmployeeId: null,
    });
    // Execute: assert.equal(details.currentVersion, 1);
    assert.equal(details.currentVersion, 1);
    // Execute: assert.equal(details.expectedVersion, undefined);
    assert.equal(details.expectedVersion, undefined);
    // Execute: assert.equal(details.assignedEmployeeId, null);
    assert.equal(details.assignedEmployeeId, null);
  });

  it("AppError version_conflict carries details for offline clients", () => {
    const details = taskConflictDetails(
      {
        version: 5,
        status: "assigned",
        assignedEmployeeId: "emp-b",
      },
      // Execute: 4,
      4,
    );
    // Construct err for later use in this flow.
    const err = new AppError(
      // Execute: 409,
      409,
      // Execute: "version_conflict",
      "version_conflict",
      // Execute: "Task was updated by another user",
      "Task was updated by another user",
      details,
    );
    // Execute: assert.equal(err.status, 409);
    assert.equal(err.status, 409);
    // Execute: assert.equal(err.code, "version_conflict");
    assert.equal(err.code, "version_conflict");
    // Execute: assert.deepEqual(err.details, details);
    assert.deepEqual(err.details, details);
  });

  it("AppError assignee_conflict carries details", () => {
    const details = taskConflictDetails(
      {
        version: 2,
        status: "assigned",
        assignedEmployeeId: "emp-b",
      },
      // Execute: 1,
      1,
    );
    // Construct err for later use in this flow.
    const err = new AppError(
      // Execute: 409,
      409,
      // Execute: "assignee_conflict",
      "assignee_conflict",
      // Execute: "Task was reassigned to another employee",
      "Task was reassigned to another employee",
      details,
    );
    // Execute: assert.equal(err.status, 409);
    assert.equal(err.status, 409);
    // Execute: assert.equal(err.code, "assignee_conflict");
    assert.equal(err.code, "assignee_conflict");
    // Execute: assert.equal(
    assert.equal(
      // Execute: (err.details as { currentVersion: number }).currentVersion,
      (err.details as { currentVersion: number }).currentVersion,
      // Execute: 2,
      2,
    );
  });
});

describe("assertTaskVersion", () => {
  const task = {
    version: 4,
    status: "assigned",
    assignedEmployeeId: "emp-a",
  };

  it("allows matching version", () => {
    // Execute: assert.doesNotThrow(() => assertTaskVersion(task, 4));
    assert.doesNotThrow(() => assertTaskVersion(task, 4));
  });

  it("allows missing expected version", () => {
    // Execute: assert.doesNotThrow(() => assertTaskVersion(task));
    assert.doesNotThrow(() => assertTaskVersion(task));
    // Execute: assert.doesNotThrow(() => assertTaskVersion(task, undefined));
    assert.doesNotThrow(() => assertTaskVersion(task, undefined));
  });

  it("rejects stale version with version_conflict details", () => {
    // Isolate fallible work so conflicts can be mapped cleanly.
    try {
      // Execute: assertTaskVersion(task, 2);
      assertTaskVersion(task, 2);
      // Execute: assert.fail("expected version_conflict");
      assert.fail("expected version_conflict");
    } catch (err) {
      // Surface a structured AppError for this failure mode.
      assert.ok(err instanceof AppError);
      // Execute: assert.equal(err.status, 409);
      assert.equal(err.status, 409);
      // Execute: assert.equal(err.code, "version_conflict");
      assert.equal(err.code, "version_conflict");
      // Execute: assert.deepEqual(err.details, taskConflictDetails(task, 2));
      assert.deepEqual(err.details, taskConflictDetails(task, 2));
    }
  });
});
