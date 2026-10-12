import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { AppError } from "../../errors";
import { mapStartUniqueConflict } from "./prismaConflicts";

function p2002(target: string | string[]) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target },
  });
}

describe("mapStartUniqueConflict", () => {
  it("maps task running-session unique by index name", () => {
    assert.throws(
      () => mapStartUniqueConflict(p2002("CleaningSession_one_running_per_task")),
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 409 &&
        err.code === "conflict" &&
        err.message === "Task already has a running session",
    );
  });

  it("maps task running-session unique by column name", () => {
    assert.throws(
      () => mapStartUniqueConflict(p2002(["taskId"])),
      (err: unknown) =>
        err instanceof AppError &&
        err.message === "Task already has a running session",
    );
  });

  it("maps employee running-session unique by index name", () => {
    assert.throws(
      () =>
        mapStartUniqueConflict(
          p2002("CleaningSession_one_running_per_employee"),
        ),
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 409 &&
        err.message === "Employee already has a running session",
    );
  });

  it("maps employee running-session unique by column name", () => {
    assert.throws(
      () => mapStartUniqueConflict(p2002(["employeeId"])),
      (err: unknown) =>
        err instanceof AppError &&
        err.message === "Employee already has a running session",
    );
  });

  it("rethrows unmapped unique conflicts", () => {
    const err = p2002(["someOtherUnique"]);
    assert.throws(
      () => mapStartUniqueConflict(err),
      (thrown: unknown) => thrown === err,
    );
  });
});
