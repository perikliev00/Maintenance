import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canRebaseConflict,
  decideSyncResult,
  parseConflictDetails,
  rebaseBodyWithCurrentVersion,
  shouldTreatForbiddenAsConflict,
} from "./conflict";

describe("decideSyncResult", () => {
  it("deletes only on ok", () => {
    assert.equal(decideSyncResult({ status: "ok" }, 0, 8).status, "deleted");
  });

  it("keeps conflict rows with reason and details", () => {
    const patch = decideSyncResult(
      {
        status: "conflict",
        code: "version_conflict",
        message: "Task was updated by another user",
        details: { currentVersion: 4, expectedVersion: 2, status: "assigned" },
      },
      0,
      8,
    );
    assert.equal(patch.status, "conflict");
    assert.equal(patch.conflictCode, "version_conflict");
    assert.equal(patch.conflictMessage, "Task was updated by another user");
    assert.deepEqual(patch.conflictDetails, {
      currentVersion: 4,
      expectedVersion: 2,
      status: "assigned",
    });
  });

  it("maps assignee forbidden to conflict (legacy servers)", () => {
    const patch = decideSyncResult(
      {
        status: "forbidden",
        code: "assignee_conflict",
        message: "Task was reassigned to another employee",
        details: { currentVersion: 3, assignedEmployeeId: "emp-x" },
      },
      0,
      8,
    );
    assert.equal(patch.status, "conflict");
    assert.equal(patch.conflictCode, "assignee_conflict");
  });

  it("keeps true permission denials as failed", () => {
    const patch = decideSyncResult(
      {
        status: "forbidden",
        message: "Missing cleaning.start",
      },
      0,
      8,
    );
    assert.equal(patch.status, "failed");
  });
});

describe("rebaseBodyWithCurrentVersion", () => {
  it("rewrites expectedVersion from conflict details", () => {
    const next = rebaseBodyWithCurrentVersion(
      { commandId: "c1", expectedVersion: 2 },
      { currentVersion: 5, expectedVersion: 2 },
    );
    assert.deepEqual(next, { commandId: "c1", expectedVersion: 5 });
  });

  it("returns null when currentVersion missing", () => {
    assert.equal(
      rebaseBodyWithCurrentVersion({ expectedVersion: 1 }, { status: "assigned" }),
      null,
    );
  });
});

describe("canRebaseConflict", () => {
  it("allows version_conflict with currentVersion", () => {
    assert.equal(
      canRebaseConflict("version_conflict", { currentVersion: 9 }),
      true,
    );
  });

  it("blocks assignee_conflict even with currentVersion", () => {
    assert.equal(
      canRebaseConflict("assignee_conflict", { currentVersion: 9 }),
      false,
    );
  });
});

describe("shouldTreatForbiddenAsConflict", () => {
  it("detects reassignment messages", () => {
    assert.equal(
      shouldTreatForbiddenAsConflict(
        "forbidden",
        "Task is assigned to another employee",
      ),
      true,
    );
  });

  it("ignores Missing * permission messages", () => {
    assert.equal(
      shouldTreatForbiddenAsConflict(undefined, "Missing cleaning.start"),
      false,
    );
  });
});

describe("parseConflictDetails", () => {
  it("parses numeric currentVersion", () => {
    const d = parseConflictDetails({
      currentVersion: 3,
      assignedEmployeeId: null,
    });
    assert.equal(d?.currentVersion, 3);
    assert.equal(d?.assignedEmployeeId, null);
  });
});
