/**
 * Unit: Team lifecycle action visibility by person status + grants.
 */
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import type-only dependency for typing without runtime cost.
import type { Person } from "../../api/peopleApi";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  lifecycleActionsForPerson,
  // Support the surrounding logic for this step.
  normalizePersonStatus,
// Support the surrounding logic for this step.
} from "./personActions";

// Define function person and its behavior.
function person(partial: Partial<Person> & Pick<Person, "status">): Person {
  // Return early result or rendered output from this path.
  return {
    // Provide id field used by this structure.
    id: "e1",
    // Provide employeeId field used by this structure.
    employeeId: "e1",
    // Provide userId field used by this structure.
    userId: "u1",
    // Provide fullName field used by this structure.
    fullName: "Ada",
    // Provide employeeNumber field used by this structure.
    employeeNumber: "1",
    // Provide email field used by this structure.
    email: "a@test.local",
    // Provide role field used by this structure.
    role: "housekeeper",
    // Provide department field used by this structure.
    department: null,
    // Provide isActive field used by this structure.
    isActive: true,
    // Provide onboarded field used by this structure.
    onboarded: true,
    // Provide archivedAt field used by this structure.
    archivedAt: null,
    // Provide accessVersion field used by this structure.
    accessVersion: 0,
    // Provide deviceCount field used by this structure.
    deviceCount: 0,
    // Provide createdAt field used by this structure.
    createdAt: "2026-01-01T00:00:00.000Z",
    // Spread prior fields/items so overrides can layer cleanly.
    ...partial,
  };
}

// Group related tests under a shared suite name.
describe("lifecycleActionsForPerson", () => {
  // Define a single test case and its expectation.
  it("exposes view/devices without manage_access", () => {
    // Bind actions for use in the following logic.
    const actions = lifecycleActionsForPerson(
      // Invoke person to perform this step.
      person({ status: "active", deviceCount: 2 }),
      // Support the surrounding logic for this step.
      false,
    );
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(actions, ["view", "devices"]);
  });

  // Define a single test case and its expectation.
  it("active: block + archive when manage_access", () => {
    // Bind actions for use in the following logic.
    const actions = lifecycleActionsForPerson(
      // Invoke person to perform this step.
      person({ status: "active" }),
      // Support the surrounding logic for this step.
      true,
    );
    // Invoke assert.ok to perform this step.
    assert.ok(actions.includes("block"));
    // Invoke assert.ok to perform this step.
    assert.ok(actions.includes("archive"));
    // Invoke assert.ok to perform this step.
    assert.ok(!actions.includes("unblock"));
    // Invoke assert.ok to perform this step.
    assert.ok(!actions.includes("restore"));
  });

  // Define a single test case and its expectation.
  it("blocked: unblock + archive", () => {
    // Bind actions for use in the following logic.
    const actions = lifecycleActionsForPerson(
      // Invoke person to perform this step.
      person({ status: "blocked", isActive: false }),
      // Support the surrounding logic for this step.
      true,
    );
    // Invoke assert.ok to perform this step.
    assert.ok(actions.includes("unblock"));
    // Invoke assert.ok to perform this step.
    assert.ok(actions.includes("archive"));
    // Invoke assert.ok to perform this step.
    assert.ok(!actions.includes("block"));
  });

  // Define a single test case and its expectation.
  it("archived: restore only (plus view/devices)", () => {
    // Bind actions for use in the following logic.
    const actions = lifecycleActionsForPerson(
      // Invoke person to perform this step.
      person({
        // Provide status field used by this structure.
        status: "archived",
        // Provide archivedAt field used by this structure.
        archivedAt: "2026-01-02T00:00:00.000Z",
        // Provide isActive field used by this structure.
        isActive: false,
      }),
      // Support the surrounding logic for this step.
      true,
    );
    // Invoke assert.ok to perform this step.
    assert.ok(actions.includes("restore"));
    // Invoke assert.ok to perform this step.
    assert.ok(!actions.includes("block"));
    // Invoke assert.ok to perform this step.
    assert.ok(!actions.includes("archive"));
  });

  // Define a single test case and its expectation.
  it("normalizePersonStatus falls back when status omitted", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke normalizePersonStatus to perform this step.
      normalizePersonStatus(
        // Invoke person to perform this step.
        person({
          // Provide status field used by this structure.
          status: undefined as unknown as Person["status"],
          // Provide isActive field used by this structure.
          isActive: false,
        }),
      ),
      // Support the surrounding logic for this step.
      "blocked",
    );
  });

  // Define a single test case and its expectation.
  it("manager cannot get lifecycle mutate actions for owner/admin", () => {
    // Bind ownerActions for use in the following logic.
    const ownerActions = lifecycleActionsForPerson(
      // Invoke person to perform this step.
      person({ status: "active", role: "owner" }),
      // Support the surrounding logic for this step.
      true,
      // Support the surrounding logic for this step.
      "manager",
    );
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(ownerActions, ["view", "devices"]);
    // Bind adminActions for use in the following logic.
    const adminActions = lifecycleActionsForPerson(
      // Invoke person to perform this step.
      person({ status: "active", role: "admin", deviceCount: 1 }),
      // Support the surrounding logic for this step.
      true,
      // Support the surrounding logic for this step.
      "manager",
    );
    // Invoke assert.ok to perform this step.
    assert.ok(!adminActions.includes("block"));
    // Invoke assert.ok to perform this step.
    assert.ok(!adminActions.includes("archive"));
  });
});
