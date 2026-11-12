import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Role } from "@prisma/client";
import { AppError } from "../../errors";
import { assertCanCreateSector } from "./assert";
// Import type(s) DataScope for typing without runtime cost.
import type { DataScope } from "./types";

function allScope(): DataScope {
  return {
    kind: "all",
    employeeId: "emp-mgr",
    role: Role.manager,
    sectorIds: [],
  };
}

function sectorsScope(employeeId = "emp-sup"): DataScope {
  return {
    kind: "sectors",
    employeeId,
    role: Role.supervisor,
    sectorIds: ["sec-a"],
  };
}

function hkScope(): DataScope {
  return {
    kind: "assigned_tasks",
    employeeId: "emp-hk",
    role: Role.housekeeper,
    sectorIds: [],
  };
}

function techScope(): DataScope {
  return {
    kind: "assigned_tickets",
    employeeId: "emp-tech",
    role: Role.technician,
    sectorIds: [],
  };
}

function isForbidden(err: unknown): boolean {
  return (
    err instanceof AppError &&
    err.status === 403 &&
    err.code === "forbidden"
  );
}

describe("assertCanCreateSector", () => {
  it("allows all scope", () => {
    assert.doesNotThrow(() =>
      assertCanCreateSector(allScope(), "emp-other"),
    );
  });

  it("allows supervisor creating sector for themselves", () => {
    assert.doesNotThrow(() =>
      assertCanCreateSector(sectorsScope("emp-sup"), "emp-sup"),
    );
  });

  it("rejects supervisor creating sector for another supervisor", () => {
    assert.throws(
      () => assertCanCreateSector(sectorsScope("emp-sup"), "emp-other"),
      isForbidden,
    );
  });

  it("rejects supervisor creating sector with null primary supervisor", () => {
    assert.throws(
      () => assertCanCreateSector(sectorsScope("emp-sup"), null),
      isForbidden,
    );
  });

  it("rejects housekeeper scope", () => {
    assert.throws(
      () => assertCanCreateSector(hkScope(), "emp-hk"),
      isForbidden,
    );
  });

  it("rejects technician scope", () => {
    assert.throws(
      () => assertCanCreateSector(techScope(), "emp-tech"),
      isForbidden,
    );
  });
});
