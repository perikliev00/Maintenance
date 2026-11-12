// Import module dependency from node:assert/strict.
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import type-only dependency for typing without runtime cost.
import type { AuthUser } from "../../api/client";
// Import module dependency from ./permissions.
import { locationPagePermissions } from "./permissions";

// Define function user and its behavior.
function user(
  // Provide overrides field used by this structure.
  overrides: Partial<AuthUser> & Pick<AuthUser, "role">,
// Support the surrounding logic for this step.
): AuthUser {
  // Return early result or rendered output from this path.
  return {
    // Provide id field used by this structure.
    id: "u1",
    // Provide employeeId field used by this structure.
    employeeId: "e1",
    // Provide email field used by this structure.
    email: "t@example.com",
    // Provide fullName field used by this structure.
    fullName: "Test User",
    // Spread prior fields/items so overrides can layer cleanly.
    ...overrides,
  };
}

// Initialize an object holding related fields.
const NONE = {
  // Provide owner field used by this structure.
  owner: false,
  // Provide canMarkDirty field used by this structure.
  canMarkDirty: false,
  // Provide canCreateTask field used by this structure.
  canCreateTask: false,
  // Provide canStart field used by this structure.
  canStart: false,
  // Provide canComplete field used by this structure.
  canComplete: false,
  // Provide canInspect field used by this structure.
  canInspect: false,
  // Provide canReassign field used by this structure.
  canReassign: false,
  // Provide canReportIssue field used by this structure.
  canReportIssue: false,
  // Provide canReviewOverdue field used by this structure.
  canReviewOverdue: false,
  // Provide canResolve field used by this structure.
  canResolve: false,
  // Provide canSetOccupancy field used by this structure.
  canSetOccupancy: false,
  // Provide canSetServiceStatus field used by this structure.
  canSetServiceStatus: false,
  // Provide canShowAssigneeToolbar field used by this structure.
  canShowAssigneeToolbar: false,
};

// Group related tests under a shared suite name.
describe("locationPagePermissions", () => {
  // Define a single test case and its expectation.
  it("grants owner all flags except occupancy on common areas", () => {
    // Bind owner for use in the following logic.
    const owner = user({ role: "owner", actions: [] });
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(locationPagePermissions(owner, false), {
      // Spread prior fields/items so overrides can layer cleanly.
      ...NONE,
      // Provide owner field used by this structure.
      owner: true,
      // Provide canMarkDirty field used by this structure.
      canMarkDirty: true,
      // Provide canCreateTask field used by this structure.
      canCreateTask: true,
      // Provide canStart field used by this structure.
      canStart: true,
      // Provide canComplete field used by this structure.
      canComplete: true,
      // Provide canInspect field used by this structure.
      canInspect: true,
      // Provide canReassign field used by this structure.
      canReassign: true,
      // Provide canReportIssue field used by this structure.
      canReportIssue: true,
      // Provide canReviewOverdue field used by this structure.
      canReviewOverdue: true,
      // Provide canResolve field used by this structure.
      canResolve: true,
      // Provide canSetOccupancy field used by this structure.
      canSetOccupancy: true,
      // Provide canSetServiceStatus field used by this structure.
      canSetServiceStatus: true,
      // Provide canShowAssigneeToolbar field used by this structure.
      canShowAssigneeToolbar: true,
    });
    // Invoke assert.equal to perform this step.
    assert.equal(locationPagePermissions(owner, true).canSetOccupancy, false);
  });

  // Define a single test case and its expectation.
  it("maps each action independently (no OR bleed)", () => {
    // Bind base for use in the following logic.
    const base = user({ role: "housekeeper", actions: [] });
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(locationPagePermissions(base, false), NONE);

    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke locationPagePermissions to perform this step.
      locationPagePermissions(
        // Invoke user to perform this step.
        user({ role: "housekeeper", actions: ["cleaning.create"] }),
        // Support the surrounding logic for this step.
        false,
      // Support the surrounding logic for this step.
      ).canCreateTask,
      // Support the surrounding logic for this step.
      true,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke locationPagePermissions to perform this step.
      locationPagePermissions(
        // Invoke user to perform this step.
        user({ role: "housekeeper", actions: ["cleaning.create"] }),
        // Support the surrounding logic for this step.
        false,
      // Support the surrounding logic for this step.
      ).canMarkDirty,
      // Support the surrounding logic for this step.
      false,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke locationPagePermissions to perform this step.
      locationPagePermissions(
        // Invoke user to perform this step.
        user({ role: "housekeeper", actions: ["rooms.mark_dirty"] }),
        // Support the surrounding logic for this step.
        false,
      // Support the surrounding logic for this step.
      ).canMarkDirty,
      // Support the surrounding logic for this step.
      true,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke locationPagePermissions to perform this step.
      locationPagePermissions(
        // Invoke user to perform this step.
        user({ role: "housekeeper", actions: ["rooms.mark_dirty"] }),
        // Support the surrounding logic for this step.
        false,
      // Support the surrounding logic for this step.
      ).canCreateTask,
      // Support the surrounding logic for this step.
      false,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke locationPagePermissions to perform this step.
      locationPagePermissions(
        // Invoke user to perform this step.
        user({ role: "housekeeper", actions: ["cleaning.start"] }),
        // Support the surrounding logic for this step.
        false,
      // Support the surrounding logic for this step.
      ).canStart,
      // Support the surrounding logic for this step.
      true,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke locationPagePermissions to perform this step.
      locationPagePermissions(
        // Invoke user to perform this step.
        user({ role: "housekeeper", actions: ["cleaning.start"] }),
        // Support the surrounding logic for this step.
        false,
      // Support the surrounding logic for this step.
      ).canComplete,
      // Support the surrounding logic for this step.
      false,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke locationPagePermissions to perform this step.
      locationPagePermissions(
        // Invoke user to perform this step.
        user({ role: "housekeeper", actions: ["cleaning.complete"] }),
        // Support the surrounding logic for this step.
        false,
      // Support the surrounding logic for this step.
      ).canComplete,
      // Support the surrounding logic for this step.
      true,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke locationPagePermissions to perform this step.
      locationPagePermissions(
        // Invoke user to perform this step.
        user({ role: "housekeeper", actions: ["cleaning.reassign"] }),
        // Support the surrounding logic for this step.
        false,
      // Support the surrounding logic for this step.
      ).canReassign,
      // Support the surrounding logic for this step.
      true,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke locationPagePermissions to perform this step.
      locationPagePermissions(
        // Invoke user to perform this step.
        user({ role: "housekeeper", actions: ["tickets.report"] }),
        // Support the surrounding logic for this step.
        false,
      // Support the surrounding logic for this step.
      ).canReportIssue,
      // Support the surrounding logic for this step.
      true,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke locationPagePermissions to perform this step.
      locationPagePermissions(
        // Invoke user to perform this step.
        user({ role: "housekeeper", actions: ["cleaning.inspect"] }),
        // Support the surrounding logic for this step.
        false,
      // Support the surrounding logic for this step.
      ).canInspect,
      // Support the surrounding logic for this step.
      true,
    );
  });

  // Define a single test case and its expectation.
  it("role matrix: reception reassign vs housekeeper work", () => {
    // Bind reception for use in the following logic.
    const reception = locationPagePermissions(
      // Invoke user to perform this step.
      user({
        // Provide role field used by this structure.
        role: "reception",
        // Provide actions field used by this structure.
        actions: ["cleaning.create", "cleaning.reassign", "tickets.report"],
      }),
      // Support the surrounding logic for this step.
      false,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(reception.canCreateTask, true);
    // Invoke assert.equal to perform this step.
    assert.equal(reception.canReassign, true);
    // Invoke assert.equal to perform this step.
    assert.equal(reception.canReportIssue, true);
    // Invoke assert.equal to perform this step.
    assert.equal(reception.canStart, false);
    // Invoke assert.equal to perform this step.
    assert.equal(reception.canMarkDirty, false);

    // Bind hk for use in the following logic.
    const hk = locationPagePermissions(
      // Invoke user to perform this step.
      user({
        // Provide role field used by this structure.
        role: "housekeeper",
        // Provide actions field used by this structure.
        actions: ["cleaning.start", "cleaning.complete"],
      }),
      // Support the surrounding logic for this step.
      false,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(hk.canStart, true);
    // Invoke assert.equal to perform this step.
    assert.equal(hk.canComplete, true);
    // Invoke assert.equal to perform this step.
    assert.equal(hk.canReassign, false);
    // Invoke assert.equal to perform this step.
    assert.equal(hk.canCreateTask, false);
  });

  // Define a single test case and its expectation.
  it("disables canSetOccupancy for common areas even with action", () => {
    // Bind withOccupancy for use in the following logic.
    const withOccupancy = user({
      // Provide role field used by this structure.
      role: "reception",
      // Provide actions field used by this structure.
      actions: ["rooms.set_occupancy"],
    });
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke locationPagePermissions to perform this step.
      locationPagePermissions(withOccupancy, true).canSetOccupancy,
      // Support the surrounding logic for this step.
      false,
    );
  });

  // Define a single test case and its expectation.
  it("canResolve honors explicit grants and retains only missing-actions fallback", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke locationPagePermissions to perform this step.
      locationPagePermissions(
        // Invoke user to perform this step.
        user({ role: "technician", actions: [] }),
        // Support the surrounding logic for this step.
        false,
      // Support the surrounding logic for this step.
      ).canResolve,
      // Support the surrounding logic for this step.
      false,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke locationPagePermissions to perform this step.
      locationPagePermissions(
        // Invoke user to perform this step.
        user({ role: "housekeeper", actions: ["tickets.resolve"] }),
        // Support the surrounding logic for this step.
        false,
      // Support the surrounding logic for this step.
      ).canResolve,
      // Support the surrounding logic for this step.
      true,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke locationPagePermissions to perform this step.
      locationPagePermissions(user({ role: "technician" }), false).canResolve,
      // Support the surrounding logic for this step.
      true,
    );
  });
});
