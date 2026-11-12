// Import node:assert/strict for cleaning/prismaConflicts.test.ts.
import assert from "node:assert/strict";
// Import node:test for cleaning/prismaConflicts.test.ts.
import { describe, it } from "node:test";
// Import @prisma/client for cleaning/prismaConflicts.test.ts.
import { Prisma } from "@prisma/client";
// Import ../../errors for cleaning/prismaConflicts.test.ts.
import { AppError } from "../../errors";
// Import ./prismaConflicts for cleaning/prismaConflicts.test.ts.
import { mapStartUniqueConflict } from "./prismaConflicts";

// Local helper p2002 keeps the main flow readable.
function p2002(target: string | string[]) {
  // Fail fast with a structured error for the client.
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    // Field value required by this payload or query.
    code: "P2002",
    // Field value required by this payload or query.
    clientVersion: "test",
    // Carry this field through the payload or query.
    meta: { target },
  });
}

// Begin block/object for the following statements.
describe("mapStartUniqueConflict", () => {
  // Begin block/object for the following statements.
  it("maps task running-session unique by index name", () => {
    // Execute: assert.throws(
    assert.throws(
      // Execute: () => mapStartUniqueConflict(p2002("CleaningSession_one_running_per_task")),
      () => mapStartUniqueConflict(p2002("CleaningSession_one_running_per_task")),
      // Execute: (err: unknown) =>
      (err: unknown) =>
        // Surface a structured AppError for this failure mode.
        err instanceof AppError &&
        // Execute: err.status === 409 &&
        err.status === 409 &&
        // Execute: err.code === "conflict" &&
        err.code === "conflict" &&
        // Execute: err.message === "Task already has a running session",
        err.message === "Task already has a running session",
    );
  });

  // Begin block/object for the following statements.
  it("maps task running-session unique by column name", () => {
    // Execute: assert.throws(
    assert.throws(
      // Execute: () => mapStartUniqueConflict(p2002(["taskId"])),
      () => mapStartUniqueConflict(p2002(["taskId"])),
      // Execute: (err: unknown) =>
      (err: unknown) =>
        // Surface a structured AppError for this failure mode.
        err instanceof AppError &&
        // Execute: err.message === "Task already has a running session",
        err.message === "Task already has a running session",
    );
  });

  // Begin block/object for the following statements.
  it("maps employee running-session unique by index name", () => {
    // Execute: assert.throws(
    assert.throws(
      // Execute: () =>
      () =>
        // Execute: mapStartUniqueConflict(
        mapStartUniqueConflict(
          // Execute: p2002("CleaningSession_one_running_per_employee"),
          p2002("CleaningSession_one_running_per_employee"),
        ),
      // Execute: (err: unknown) =>
      (err: unknown) =>
        // Surface a structured AppError for this failure mode.
        err instanceof AppError &&
        // Execute: err.status === 409 &&
        err.status === 409 &&
        // Execute: err.message === "Employee already has a running session",
        err.message === "Employee already has a running session",
    );
  });

  // Begin block/object for the following statements.
  it("maps employee running-session unique by column name", () => {
    // Execute: assert.throws(
    assert.throws(
      // Execute: () => mapStartUniqueConflict(p2002(["employeeId"])),
      () => mapStartUniqueConflict(p2002(["employeeId"])),
      // Execute: (err: unknown) =>
      (err: unknown) =>
        // Surface a structured AppError for this failure mode.
        err instanceof AppError &&
        // Execute: err.message === "Employee already has a running session",
        err.message === "Employee already has a running session",
    );
  });

  // Begin block/object for the following statements.
  it("rethrows unmapped unique conflicts", () => {
    // Capture err for subsequent checks or writes.
    const err = p2002(["someOtherUnique"]);
    // Execute: assert.throws(
    assert.throws(
      // Execute: () => mapStartUniqueConflict(err),
      () => mapStartUniqueConflict(err),
      // Execute: (thrown: unknown) => thrown === err,
      (thrown: unknown) => thrown === err,
    );
  });
});
