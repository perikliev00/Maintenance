import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthUser } from "../../api/client";
import { locationPagePermissions } from "./permissions";

function user(
  overrides: Partial<AuthUser> & Pick<AuthUser, "role">,
): AuthUser {
  return {
    id: "u1",
    employeeId: "e1",
    email: "t@example.com",
    fullName: "Test User",
    ...overrides,
  };
}

const NONE = {
  owner: false,
  canMarkDirty: false,
  canCreateTask: false,
  canStart: false,
  canComplete: false,
  canInspect: false,
  canReassign: false,
  canReportIssue: false,
  canReviewOverdue: false,
  canResolve: false,
  canSetOccupancy: false,
  canSetServiceStatus: false,
  canShowAssigneeToolbar: false,
};

describe("locationPagePermissions", () => {
  it("grants owner all flags except occupancy on common areas", () => {
    const owner = user({ role: "owner", actions: [] });
    assert.deepEqual(locationPagePermissions(owner, false), {
      ...NONE,
      owner: true,
      canMarkDirty: true,
      canCreateTask: true,
      canStart: true,
      canComplete: true,
      canInspect: true,
      canReassign: true,
      canReportIssue: true,
      canReviewOverdue: true,
      canResolve: true,
      canSetOccupancy: true,
      canSetServiceStatus: true,
      canShowAssigneeToolbar: true,
    });
    assert.equal(locationPagePermissions(owner, true).canSetOccupancy, false);
  });

  it("maps each action independently (no OR bleed)", () => {
    const base = user({ role: "housekeeper", actions: [] });
    assert.deepEqual(locationPagePermissions(base, false), NONE);

    assert.equal(
      locationPagePermissions(
        user({ role: "housekeeper", actions: ["cleaning.create"] }),
        false,
      ).canCreateTask,
      true,
    );
    assert.equal(
      locationPagePermissions(
        user({ role: "housekeeper", actions: ["cleaning.create"] }),
        false,
      ).canMarkDirty,
      false,
    );
    assert.equal(
      locationPagePermissions(
        user({ role: "housekeeper", actions: ["rooms.mark_dirty"] }),
        false,
      ).canMarkDirty,
      true,
    );
    assert.equal(
      locationPagePermissions(
        user({ role: "housekeeper", actions: ["rooms.mark_dirty"] }),
        false,
      ).canCreateTask,
      false,
    );
    assert.equal(
      locationPagePermissions(
        user({ role: "housekeeper", actions: ["cleaning.start"] }),
        false,
      ).canStart,
      true,
    );
    assert.equal(
      locationPagePermissions(
        user({ role: "housekeeper", actions: ["cleaning.start"] }),
        false,
      ).canComplete,
      false,
    );
    assert.equal(
      locationPagePermissions(
        user({ role: "housekeeper", actions: ["cleaning.complete"] }),
        false,
      ).canComplete,
      true,
    );
    assert.equal(
      locationPagePermissions(
        user({ role: "housekeeper", actions: ["cleaning.reassign"] }),
        false,
      ).canReassign,
      true,
    );
    assert.equal(
      locationPagePermissions(
        user({ role: "housekeeper", actions: ["tickets.report"] }),
        false,
      ).canReportIssue,
      true,
    );
    assert.equal(
      locationPagePermissions(
        user({ role: "housekeeper", actions: ["cleaning.inspect"] }),
        false,
      ).canInspect,
      true,
    );
  });

  it("role matrix: reception reassign vs housekeeper work", () => {
    const reception = locationPagePermissions(
      user({
        role: "reception",
        actions: ["cleaning.create", "cleaning.reassign", "tickets.report"],
      }),
      false,
    );
    assert.equal(reception.canCreateTask, true);
    assert.equal(reception.canReassign, true);
    assert.equal(reception.canReportIssue, true);
    assert.equal(reception.canStart, false);
    assert.equal(reception.canMarkDirty, false);

    const hk = locationPagePermissions(
      user({
        role: "housekeeper",
        actions: ["cleaning.start", "cleaning.complete"],
      }),
      false,
    );
    assert.equal(hk.canStart, true);
    assert.equal(hk.canComplete, true);
    assert.equal(hk.canReassign, false);
    assert.equal(hk.canCreateTask, false);
  });

  it("disables canSetOccupancy for common areas even with action", () => {
    const withOccupancy = user({
      role: "reception",
      actions: ["rooms.set_occupancy"],
    });
    assert.equal(
      locationPagePermissions(withOccupancy, true).canSetOccupancy,
      false,
    );
  });

  it("canResolve honors explicit grants and retains only missing-actions fallback", () => {
    assert.equal(
      locationPagePermissions(
        user({ role: "technician", actions: [] }),
        false,
      ).canResolve,
      false,
    );
    assert.equal(
      locationPagePermissions(
        user({ role: "housekeeper", actions: ["tickets.resolve"] }),
        false,
      ).canResolve,
      true,
    );
    assert.equal(
      locationPagePermissions(user({ role: "technician" }), false).canResolve,
      true,
    );
  });
});
