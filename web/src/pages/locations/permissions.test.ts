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

describe("locationPagePermissions", () => {
  it("grants owner all flags except occupancy on common areas", () => {
    const owner = user({ role: "owner", actions: [] });
    assert.deepEqual(locationPagePermissions(owner, false), {
      owner: true,
      canManage: true,
      canWork: true,
      canInspect: true,
      canReviewOverdue: true,
      canResolve: true,
      canSetOccupancy: true,
      canSetServiceStatus: true,
    });
    assert.equal(locationPagePermissions(owner, true).canSetOccupancy, false);
  });

  it("maps granted actions to UI flags", () => {
    const base = user({
      role: "housekeeper",
      actions: [],
    });
    assert.deepEqual(locationPagePermissions(base, false), {
      owner: false,
      canManage: false,
      canWork: false,
      canInspect: false,
      canReviewOverdue: false,
      canResolve: false,
      canSetOccupancy: false,
      canSetServiceStatus: false,
    });

    assert.equal(
      locationPagePermissions(
        user({ role: "housekeeper", actions: ["cleaning.create"] }),
        false,
      ).canManage,
      true,
    );
    assert.equal(
      locationPagePermissions(
        user({ role: "housekeeper", actions: ["rooms.mark_dirty"] }),
        false,
      ).canManage,
      true,
    );
    assert.equal(
      locationPagePermissions(
        user({ role: "housekeeper", actions: ["cleaning.start"] }),
        false,
      ).canWork,
      true,
    );
    assert.equal(
      locationPagePermissions(
        user({ role: "housekeeper", actions: ["cleaning.complete"] }),
        false,
      ).canWork,
      true,
    );
    assert.equal(
      locationPagePermissions(
        user({ role: "housekeeper", actions: ["cleaning.inspect"] }),
        false,
      ).canInspect,
      true,
    );
    assert.equal(
      locationPagePermissions(
        user({ role: "housekeeper", actions: ["cleaning.review_overdue"] }),
        false,
      ).canReviewOverdue,
      true,
    );
    assert.equal(
      locationPagePermissions(
        user({ role: "housekeeper", actions: ["rooms.set_occupancy"] }),
        false,
      ).canSetOccupancy,
      true,
    );
    assert.equal(
      locationPagePermissions(
        user({ role: "housekeeper", actions: ["rooms.set_service_status"] }),
        false,
      ).canSetServiceStatus,
      true,
    );
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
        user({ role: "housekeeper", actions: [] }),
        false,
      ).canResolve,
      false,
    );
    assert.equal(
      locationPagePermissions(
        user({ role: "supervisor", actions: [] }),
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
