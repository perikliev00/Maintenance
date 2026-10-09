import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canPerformAction,
  panelsForRole,
  panelsForUser,
  type AuthUser,
} from "./client";

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

describe("canPerformAction / panelsForUser empty capabilities", () => {
  it("actions: [] does not restore role defaults", () => {
    const tech = user({ role: "technician", actions: [] });
    assert.equal(canPerformAction(tech, "tickets.resolve"), false);
    assert.equal(canPerformAction(tech, "tickets.assign"), false);
  });

  it("panels: [] does not restore role panels (notifications still forced)", () => {
    const tech = user({ role: "technician", panels: [] });
    assert.deepEqual(panelsForUser(tech), ["notifications"]);
  });

  it("non-empty arrays only allow granted capabilities", () => {
    const tech = user({
      role: "technician",
      actions: ["cards.view"],
      panels: ["cards"],
    });
    assert.equal(canPerformAction(tech, "cards.view"), true);
    assert.equal(canPerformAction(tech, "tickets.resolve"), false);
    assert.deepEqual(panelsForUser(tech), ["cards", "notifications"]);
  });

  it("missing actions/panels keep legacy role fallback", () => {
    const tech = user({ role: "technician" });
    assert.equal(canPerformAction(tech, "tickets.resolve"), true);
    for (const panel of panelsForRole("technician")) {
      assert.ok(panelsForUser(tech).includes(panel));
    }
  });

  it("owner still bypasses action checks", () => {
    const owner = user({ role: "owner", actions: [] });
    assert.equal(canPerformAction(owner, "tickets.resolve"), true);
  });
});
