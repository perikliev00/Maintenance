/**
 * Unit: Team lifecycle action visibility by person status + grants.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Person } from "../../api/peopleApi";
import {
  lifecycleActionsForPerson,
  normalizePersonStatus,
} from "./personActions";

// Define function person and its behavior.
function person(partial: Partial<Person> & Pick<Person, "status">): Person {
  return {
    id: "e1",
    employeeId: "e1",
    userId: "u1",
    fullName: "Ada",
    employeeNumber: "1",
    email: "a@test.local",
    role: "housekeeper",
    department: null,
    isActive: true,
    onboarded: true,
    archivedAt: null,
    accessVersion: 0,
    deviceCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("lifecycleActionsForPerson", () => {
  it("exposes view/devices without manage_access", () => {
    const actions = lifecycleActionsForPerson(
      person({ status: "active", deviceCount: 2 }),
      false,
    );
    assert.deepEqual(actions, ["view", "devices"]);
  });

  it("active: block + archive when manage_access", () => {
    const actions = lifecycleActionsForPerson(
      person({ status: "active" }),
      true,
    );
    assert.ok(actions.includes("block"));
    assert.ok(actions.includes("archive"));
    assert.ok(!actions.includes("unblock"));
    assert.ok(!actions.includes("restore"));
  });

  it("blocked: unblock + archive", () => {
    const actions = lifecycleActionsForPerson(
      person({ status: "blocked", isActive: false }),
      true,
    );
    assert.ok(actions.includes("unblock"));
    assert.ok(actions.includes("archive"));
    assert.ok(!actions.includes("block"));
  });

  it("archived: restore only (plus view/devices)", () => {
    const actions = lifecycleActionsForPerson(
      person({
        status: "archived",
        archivedAt: "2026-01-02T00:00:00.000Z",
        isActive: false,
      }),
      true,
    );
    assert.ok(actions.includes("restore"));
    assert.ok(!actions.includes("block"));
    assert.ok(!actions.includes("archive"));
  });

  it("normalizePersonStatus falls back when status omitted", () => {
    assert.equal(
      normalizePersonStatus(
        person({
          status: undefined as unknown as Person["status"],
          isActive: false,
        }),
      ),
      "blocked",
    );
  });

  it("manager cannot get lifecycle mutate actions for owner/admin", () => {
    const ownerActions = lifecycleActionsForPerson(
      person({ status: "active", role: "owner" }),
      true,
      "manager",
    );
    assert.deepEqual(ownerActions, ["view", "devices"]);
    const adminActions = lifecycleActionsForPerson(
      person({ status: "active", role: "admin", deviceCount: 1 }),
      true,
      "manager",
    );
    assert.ok(!adminActions.includes("block"));
    assert.ok(!adminActions.includes("archive"));
  });
});
