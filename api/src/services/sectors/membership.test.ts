import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Role } from "@prisma/client";
import { AppError } from "../../errors";
// Import type(s) DataScope for typing without runtime cost.
import type { DataScope } from "../dataScope";
import {
  assertLocationTransferAllowed,
  // Declare type SectorMembershipAuth for callers and internals.
  type SectorMembershipAuth,
} from "./membership";

function sectorsScope(sectorIds: string[]): DataScope {
  return {
    kind: "sectors",
    employeeId: "emp-sup",
    role: Role.supervisor,
    sectorIds,
  };
}

function allScope(): DataScope {
  return {
    kind: "all",
    employeeId: "emp-mgr",
    role: Role.manager,
    sectorIds: [],
  };
}

describe("assertLocationTransferAllowed", () => {
  it("allows no-op when source already equals destination", () => {
    const auth: SectorMembershipAuth = {
      scope: sectorsScope(["sec-a"]),
      allowCrossSectorTransfer: false,
    };
    assert.doesNotThrow(() =>
      assertLocationTransferAllowed(auth, "sec-a", "sec-a"),
    );
  });

  it("allows supervisor rebalance among own sectors without transfer_cross", () => {
    const auth: SectorMembershipAuth = {
      scope: sectorsScope(["sec-a", "sec-b"]),
      allowCrossSectorTransfer: false,
    };
    assert.doesNotThrow(() =>
      assertLocationTransferAllowed(auth, "sec-b", "sec-a"),
    );
  });

  it("rejects supervisor steal from foreign sector without transfer_cross", () => {
    const auth: SectorMembershipAuth = {
      scope: sectorsScope(["sec-a"]),
      allowCrossSectorTransfer: false,
    };
    assert.throws(
      () => assertLocationTransferAllowed(auth, "sec-a", "sec-foreign"),
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 403 &&
        err.code === "forbidden",
    );
  });

  it("rejects supervisor claim of unassigned location without transfer_cross", () => {
    const auth: SectorMembershipAuth = {
      scope: sectorsScope(["sec-a"]),
      allowCrossSectorTransfer: false,
    };
    assert.throws(
      () => assertLocationTransferAllowed(auth, "sec-a", null),
      (err: unknown) => err instanceof AppError && err.status === 403,
    );
  });

  it("allows foreign/unassigned when transfer_cross is granted (supervisor)", () => {
    const auth: SectorMembershipAuth = {
      scope: sectorsScope(["sec-a"]),
      allowCrossSectorTransfer: true,
    };
    assert.doesNotThrow(() =>
      assertLocationTransferAllowed(auth, "sec-a", "sec-foreign"),
    );
    assert.doesNotThrow(() =>
      assertLocationTransferAllowed(auth, "sec-a", null),
    );
  });

  it("rejects kind=all inter-sector move without transfer_cross", () => {
    const auth: SectorMembershipAuth = {
      scope: allScope(),
      allowCrossSectorTransfer: false,
    };
    assert.throws(
      () => assertLocationTransferAllowed(auth, "sec-b", "sec-a"),
      (err: unknown) => err instanceof AppError && err.status === 403,
    );
    assert.throws(
      () => assertLocationTransferAllowed(auth, "sec-b", null),
      (err: unknown) => err instanceof AppError && err.status === 403,
    );
  });

  it("allows kind=all inter-sector move with transfer_cross", () => {
    const auth: SectorMembershipAuth = {
      scope: allScope(),
      allowCrossSectorTransfer: true,
    };
    assert.doesNotThrow(() =>
      assertLocationTransferAllowed(auth, "sec-b", "sec-a"),
    );
    assert.doesNotThrow(() =>
      assertLocationTransferAllowed(auth, "sec-b", null),
    );
  });
});
