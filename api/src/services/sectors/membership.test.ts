// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module @prisma/client for this service.
import { Role } from "@prisma/client";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import type(s) DataScope for typing without runtime cost.
import type { DataScope } from "../dataScope";
// Import module dependency for this service.
import {
  // Run next step: assertLocationTransferAllowed,
  assertLocationTransferAllowed,
  // Declare type SectorMembershipAuth for callers and internals.
  type SectorMembershipAuth,
// Run next step: } from "./membership";
} from "./membership";

// Define sectorsScope — core behavior for this module.
function sectorsScope(sectorIds: string[]): DataScope {
  // Return the computed result to the caller.
  return {
    // Set kind on the structure being built.
    kind: "sectors",
    // Set employeeId on the structure being built.
    employeeId: "emp-sup",
    // Set role on the structure being built.
    role: Role.supervisor,
    // Run next step: sectorIds,
    sectorIds,
  };
}

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

// Run next step: describe("assertLocationTransferAllowed", () => {
describe("assertLocationTransferAllowed", () => {
  // Run next step: it("allows no-op when source already equals destination", ()…
  it("allows no-op when source already equals destination", () => {
    // Capture auth for use in this scope.
    const auth: SectorMembershipAuth = {
      // Set scope on the structure being built.
      scope: sectorsScope(["sec-a"]),
      // Set allowCrossSectorTransfer on the structure being built.
      allowCrossSectorTransfer: false,
    };
    // Run next step: assert.doesNotThrow(() =>
    assert.doesNotThrow(() =>
      // Run next step: assertLocationTransferAllowed(auth, "sec-a", "sec-a"),
      assertLocationTransferAllowed(auth, "sec-a", "sec-a"),
    );
  });

  // Run next step: it("allows supervisor rebalance among own sectors without tr…
  it("allows supervisor rebalance among own sectors without transfer_cross", () => {
    // Capture auth for use in this scope.
    const auth: SectorMembershipAuth = {
      // Set scope on the structure being built.
      scope: sectorsScope(["sec-a", "sec-b"]),
      // Set allowCrossSectorTransfer on the structure being built.
      allowCrossSectorTransfer: false,
    };
    // Run next step: assert.doesNotThrow(() =>
    assert.doesNotThrow(() =>
      // Run next step: assertLocationTransferAllowed(auth, "sec-b", "sec-a"),
      assertLocationTransferAllowed(auth, "sec-b", "sec-a"),
    );
  });

  // Run next step: it("rejects supervisor steal from foreign sector without tra…
  it("rejects supervisor steal from foreign sector without transfer_cross", () => {
    // Capture auth for use in this scope.
    const auth: SectorMembershipAuth = {
      // Set scope on the structure being built.
      scope: sectorsScope(["sec-a"]),
      // Set allowCrossSectorTransfer on the structure being built.
      allowCrossSectorTransfer: false,
    };
    // Run next step: assert.throws(
    assert.throws(
      // Run next step: () => assertLocationTransferAllowed(auth, "sec-a", "sec-fore…
      () => assertLocationTransferAllowed(auth, "sec-a", "sec-foreign"),
      // Run next step: (err: unknown) =>
      (err: unknown) =>
        // Run next step: err instanceof AppError &&
        err instanceof AppError &&
        // Run next step: err.status === 403 &&
        err.status === 403 &&
        // Run next step: err.code === "forbidden",
        err.code === "forbidden",
    );
  });

  // Run next step: it("rejects supervisor claim of unassigned location without …
  it("rejects supervisor claim of unassigned location without transfer_cross", () => {
    // Capture auth for use in this scope.
    const auth: SectorMembershipAuth = {
      // Set scope on the structure being built.
      scope: sectorsScope(["sec-a"]),
      // Set allowCrossSectorTransfer on the structure being built.
      allowCrossSectorTransfer: false,
    };
    // Run next step: assert.throws(
    assert.throws(
      // Run next step: () => assertLocationTransferAllowed(auth, "sec-a", null),
      () => assertLocationTransferAllowed(auth, "sec-a", null),
      // Run next step: (err: unknown) => err instanceof AppError && err.status === …
      (err: unknown) => err instanceof AppError && err.status === 403,
    );
  });

  // Run next step: it("allows foreign/unassigned when transfer_cross is granted…
  it("allows foreign/unassigned when transfer_cross is granted (supervisor)", () => {
    // Capture auth for use in this scope.
    const auth: SectorMembershipAuth = {
      // Set scope on the structure being built.
      scope: sectorsScope(["sec-a"]),
      // Set allowCrossSectorTransfer on the structure being built.
      allowCrossSectorTransfer: true,
    };
    // Run next step: assert.doesNotThrow(() =>
    assert.doesNotThrow(() =>
      // Run next step: assertLocationTransferAllowed(auth, "sec-a", "sec-foreign"),
      assertLocationTransferAllowed(auth, "sec-a", "sec-foreign"),
    );
    // Run next step: assert.doesNotThrow(() =>
    assert.doesNotThrow(() =>
      // Run next step: assertLocationTransferAllowed(auth, "sec-a", null),
      assertLocationTransferAllowed(auth, "sec-a", null),
    );
  });

  // Run next step: it("rejects kind=all inter-sector move without transfer_cros…
  it("rejects kind=all inter-sector move without transfer_cross", () => {
    // Capture auth for use in this scope.
    const auth: SectorMembershipAuth = {
      // Set scope on the structure being built.
      scope: allScope(),
      // Set allowCrossSectorTransfer on the structure being built.
      allowCrossSectorTransfer: false,
    };
    // Run next step: assert.throws(
    assert.throws(
      // Run next step: () => assertLocationTransferAllowed(auth, "sec-b", "sec-a"),
      () => assertLocationTransferAllowed(auth, "sec-b", "sec-a"),
      // Run next step: (err: unknown) => err instanceof AppError && err.status === …
      (err: unknown) => err instanceof AppError && err.status === 403,
    );
    // Run next step: assert.throws(
    assert.throws(
      // Run next step: () => assertLocationTransferAllowed(auth, "sec-b", null),
      () => assertLocationTransferAllowed(auth, "sec-b", null),
      // Run next step: (err: unknown) => err instanceof AppError && err.status === …
      (err: unknown) => err instanceof AppError && err.status === 403,
    );
  });

  // Run next step: it("allows kind=all inter-sector move with transfer_cross", …
  it("allows kind=all inter-sector move with transfer_cross", () => {
    // Capture auth for use in this scope.
    const auth: SectorMembershipAuth = {
      // Set scope on the structure being built.
      scope: allScope(),
      // Set allowCrossSectorTransfer on the structure being built.
      allowCrossSectorTransfer: true,
    };
    // Run next step: assert.doesNotThrow(() =>
    assert.doesNotThrow(() =>
      // Run next step: assertLocationTransferAllowed(auth, "sec-b", "sec-a"),
      assertLocationTransferAllowed(auth, "sec-b", "sec-a"),
    );
    // Run next step: assert.doesNotThrow(() =>
    assert.doesNotThrow(() =>
      // Run next step: assertLocationTransferAllowed(auth, "sec-b", null),
      assertLocationTransferAllowed(auth, "sec-b", null),
    );
  });
});
