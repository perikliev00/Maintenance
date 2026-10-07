import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "../errors";
import { taskConflictDetails } from "./cleaning";

describe("taskConflictDetails", () => {
  it("includes currentVersion, status, assignee, and expectedVersion", () => {
    const details = taskConflictDetails(
      {
        version: 7,
        status: "assigned",
        assignedEmployeeId: "emp-other",
      },
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
    assert.equal(details.currentVersion, 1);
    assert.equal(details.expectedVersion, undefined);
    assert.equal(details.assignedEmployeeId, null);
  });

  it("AppError version_conflict carries details for offline clients", () => {
    const details = taskConflictDetails(
      {
        version: 5,
        status: "assigned",
        assignedEmployeeId: "emp-b",
      },
      4,
    );
    const err = new AppError(
      409,
      "version_conflict",
      "Task was updated by another user",
      details,
    );
    assert.equal(err.status, 409);
    assert.equal(err.code, "version_conflict");
    assert.deepEqual(err.details, details);
  });

  it("AppError assignee_conflict carries details", () => {
    const details = taskConflictDetails(
      {
        version: 2,
        status: "assigned",
        assignedEmployeeId: "emp-b",
      },
      1,
    );
    const err = new AppError(
      409,
      "assignee_conflict",
      "Task was reassigned to another employee",
      details,
    );
    assert.equal(err.status, 409);
    assert.equal(err.code, "assignee_conflict");
    assert.equal(
      (err.details as { currentVersion: number }).currentVersion,
      2,
    );
  });
});
