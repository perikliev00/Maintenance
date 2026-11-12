// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module @prisma/client for this service.
import { Role } from "@prisma/client";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module ./assert for this service.
import { assertCanCreateSector } from "./assert";
// Import type(s) DataScope for typing without runtime cost.
import type { DataScope } from "./types";

// Define allScope — core behavior for this module.
function allScope(): DataScope {
  // Return the computed result to the caller.
  return {
    // Set kind on the structure being built.
    kind: "all",
    // Set employeeId on the structure being built.
    employeeId: "emp-mgr",
    // Set role on the structure being built.
    role: Role.manager,
    // Set sectorIds on the structure being built.
    sectorIds: [],
  };
}

// Define sectorsScope — core behavior for this module.
function sectorsScope(employeeId = "emp-sup"): DataScope {
  // Return the computed result to the caller.
  return {
    // Set kind on the structure being built.
    kind: "sectors",
    // Run next step: employeeId,
    employeeId,
    // Set role on the structure being built.
    role: Role.supervisor,
    // Set sectorIds on the structure being built.
    sectorIds: ["sec-a"],
  };
}

// Define hkScope — core behavior for this module.
function hkScope(): DataScope {
  // Return the computed result to the caller.
  return {
    // Set kind on the structure being built.
    kind: "assigned_tasks",
    // Set employeeId on the structure being built.
    employeeId: "emp-hk",
    // Set role on the structure being built.
    role: Role.housekeeper,
    // Set sectorIds on the structure being built.
    sectorIds: [],
  };
}

// Define techScope — core behavior for this module.
function techScope(): DataScope {
  // Return the computed result to the caller.
  return {
    // Set kind on the structure being built.
    kind: "assigned_tickets",
    // Set employeeId on the structure being built.
    employeeId: "emp-tech",
    // Set role on the structure being built.
    role: Role.technician,
    // Set sectorIds on the structure being built.
    sectorIds: [],
  };
}

// Define isForbidden — core behavior for this module.
function isForbidden(err: unknown): boolean {
  // Return the computed result to the caller.
  return (
    // Run next step: err instanceof AppError &&
    err instanceof AppError &&
    // Run next step: err.status === 403 &&
    err.status === 403 &&
    // Run next step: err.code === "forbidden"
    err.code === "forbidden"
  );
}

// Run next step: describe("assertCanCreateSector", () => {
describe("assertCanCreateSector", () => {
  // Run next step: it("allows all scope", () => {
  it("allows all scope", () => {
    // Run next step: assert.doesNotThrow(() =>
    assert.doesNotThrow(() =>
      // Run next step: assertCanCreateSector(allScope(), "emp-other"),
      assertCanCreateSector(allScope(), "emp-other"),
    );
  });

  // Run next step: it("allows supervisor creating sector for themselves", () =>…
  it("allows supervisor creating sector for themselves", () => {
    // Run next step: assert.doesNotThrow(() =>
    assert.doesNotThrow(() =>
      // Run next step: assertCanCreateSector(sectorsScope("emp-sup"), "emp-sup"),
      assertCanCreateSector(sectorsScope("emp-sup"), "emp-sup"),
    );
  });

  // Run next step: it("rejects supervisor creating sector for another superviso…
  it("rejects supervisor creating sector for another supervisor", () => {
    // Run next step: assert.throws(
    assert.throws(
      // Run next step: () => assertCanCreateSector(sectorsScope("emp-sup"), "emp-ot…
      () => assertCanCreateSector(sectorsScope("emp-sup"), "emp-other"),
      // Run next step: isForbidden,
      isForbidden,
    );
  });

  // Run next step: it("rejects supervisor creating sector with null primary sup…
  it("rejects supervisor creating sector with null primary supervisor", () => {
    // Run next step: assert.throws(
    assert.throws(
      // Run next step: () => assertCanCreateSector(sectorsScope("emp-sup"), null),
      () => assertCanCreateSector(sectorsScope("emp-sup"), null),
      // Run next step: isForbidden,
      isForbidden,
    );
  });

  // Run next step: it("rejects housekeeper scope", () => {
  it("rejects housekeeper scope", () => {
    // Run next step: assert.throws(
    assert.throws(
      // Run next step: () => assertCanCreateSector(hkScope(), "emp-hk"),
      () => assertCanCreateSector(hkScope(), "emp-hk"),
      // Run next step: isForbidden,
      isForbidden,
    );
  });

  // Run next step: it("rejects technician scope", () => {
  it("rejects technician scope", () => {
    // Run next step: assert.throws(
    assert.throws(
      // Run next step: () => assertCanCreateSector(techScope(), "emp-tech"),
      () => assertCanCreateSector(techScope(), "emp-tech"),
      // Run next step: isForbidden,
      isForbidden,
    );
  });
});
