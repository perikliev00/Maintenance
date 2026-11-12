// Import node:assert/strict for cleaning/claims.test.ts.
import assert from "node:assert/strict";
// Import node:test for cleaning/claims.test.ts.
import { describe, it } from "node:test";
// Import ../../errors for cleaning/claims.test.ts.
import { AppError } from "../../errors";
// Import ./claims for cleaning/claims.test.ts.
import { assertTaskVersion, taskConflictDetails } from "./claims";

// Begin block/object for the following statements.
describe("taskConflictDetails", () => {
  // Begin block/object for the following statements.
  it("includes currentVersion, status, assignee, and expectedVersion", () => {
    // Capture details for subsequent checks or writes.
    const details = taskConflictDetails(
      // Begin block/object for the following statements.
      {
        // Field value required by this payload or query.
        version: 7,
        // Field value required by this payload or query.
        status: "assigned",
        // Field value required by this payload or query.
        assignedEmployeeId: "emp-other",
      },
      // Execute: 3,
      3,
    );
    // Begin block/object for the following statements.
    assert.deepEqual(details, {
      // Field value required by this payload or query.
      expectedVersion: 3,
      // Field value required by this payload or query.
      currentVersion: 7,
      // Field value required by this payload or query.
      status: "assigned",
      // Field value required by this payload or query.
      assignedEmployeeId: "emp-other",
    });
  });

  // Begin block/object for the following statements.
  it("omits expectedVersion when not provided", () => {
    // Capture details for subsequent checks or writes.
    const details = taskConflictDetails({
      // Field value required by this payload or query.
      version: 1,
      // Field value required by this payload or query.
      status: "in_progress",
      // Field value required by this payload or query.
      assignedEmployeeId: null,
    });
    // Execute: assert.equal(details.currentVersion, 1);
    assert.equal(details.currentVersion, 1);
    // Execute: assert.equal(details.expectedVersion, undefined);
    assert.equal(details.expectedVersion, undefined);
    // Execute: assert.equal(details.assignedEmployeeId, null);
    assert.equal(details.assignedEmployeeId, null);
  });

  // Begin block/object for the following statements.
  it("AppError version_conflict carries details for offline clients", () => {
    // Capture details for subsequent checks or writes.
    const details = taskConflictDetails(
      // Begin block/object for the following statements.
      {
        // Field value required by this payload or query.
        version: 5,
        // Field value required by this payload or query.
        status: "assigned",
        // Field value required by this payload or query.
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
      // Carry this field through the payload or query.
      details,
    );
    // Execute: assert.equal(err.status, 409);
    assert.equal(err.status, 409);
    // Execute: assert.equal(err.code, "version_conflict");
    assert.equal(err.code, "version_conflict");
    // Execute: assert.deepEqual(err.details, details);
    assert.deepEqual(err.details, details);
  });

  // Begin block/object for the following statements.
  it("AppError assignee_conflict carries details", () => {
    // Capture details for subsequent checks or writes.
    const details = taskConflictDetails(
      // Begin block/object for the following statements.
      {
        // Field value required by this payload or query.
        version: 2,
        // Field value required by this payload or query.
        status: "assigned",
        // Field value required by this payload or query.
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
      // Carry this field through the payload or query.
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

// Begin block/object for the following statements.
describe("assertTaskVersion", () => {
  // Capture task for subsequent checks or writes.
  const task = {
    // Field value required by this payload or query.
    version: 4,
    // Field value required by this payload or query.
    status: "assigned",
    // Field value required by this payload or query.
    assignedEmployeeId: "emp-a",
  };

  // Begin block/object for the following statements.
  it("allows matching version", () => {
    // Execute: assert.doesNotThrow(() => assertTaskVersion(task, 4));
    assert.doesNotThrow(() => assertTaskVersion(task, 4));
  });

  // Begin block/object for the following statements.
  it("allows missing expected version", () => {
    // Execute: assert.doesNotThrow(() => assertTaskVersion(task));
    assert.doesNotThrow(() => assertTaskVersion(task));
    // Execute: assert.doesNotThrow(() => assertTaskVersion(task, undefined));
    assert.doesNotThrow(() => assertTaskVersion(task, undefined));
  });

  // Begin block/object for the following statements.
  it("rejects stale version with version_conflict details", () => {
    // Isolate fallible work so conflicts can be mapped cleanly.
    try {
      // Execute: assertTaskVersion(task, 2);
      assertTaskVersion(task, 2);
      // Execute: assert.fail("expected version_conflict");
      assert.fail("expected version_conflict");
    // Begin block/object for the following statements.
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
