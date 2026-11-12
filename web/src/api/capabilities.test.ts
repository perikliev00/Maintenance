// Import dependency used by this module.
import assert from "node:assert/strict";
// Import dependency used by this module.
import { describe, it } from "node:test";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  canPerformAction,
  // List item in import/export/params.
  filterPanelsByModules,
  // List item in import/export/params.
  panelsForRole,
  // List item in import/export/params.
  panelsForUser,
  // Local type alias shaping data.
  type AuthUser,
  // Local type alias shaping data.
  type ModuleToggles,
  // Local type alias shaping data.
  type Panel,
// Close multi-line construct with trailing syntax.
} from "./client";

// Function definition.
function user(
  // Field/property in this shape.
  overrides: Partial<AuthUser> & Pick<AuthUser, "role">,
// Open multi-line construct.
): AuthUser {
  // Return computed result to caller.
  return {
    // Field/property in this shape.
    id: "u1",
    // Field/property in this shape.
    employeeId: "e1",
    // Field/property in this shape.
    email: "t@example.com",
    // Field/property in this shape.
    fullName: "Test User",
    // Spread remaining fields/props.
    ...overrides,
  };
}

// Group related unit tests.
describe("canPerformAction / panelsForUser empty capabilities", () => {
  // Unit test case.
  it("actions: [] does not restore role defaults", () => {
    // Local constant binding.
    const tech = user({ role: "technician", actions: [] });
    // Assert expected test outcome.
    assert.equal(canPerformAction(tech, "tickets.resolve"), false);
    // Assert expected test outcome.
    assert.equal(canPerformAction(tech, "tickets.assign"), false);
    // Assert expected test outcome.
    assert.equal(canPerformAction(tech, "tickets.close"), false);
  });

  // Unit test case.
  it("panels: [] does not restore role panels (notifications not forced)", () => {
    // Local constant binding.
    const tech = user({ role: "technician", panels: [] });
    // Assert expected test outcome.
    assert.deepEqual(panelsForUser(tech), []);
  });

  // Unit test case.
  it("non-empty arrays only allow granted capabilities", () => {
    // Local constant binding.
    const tech = user({
      // Field/property in this shape.
      role: "technician",
      // Field/property in this shape.
      actions: ["cards.view"],
      // Field/property in this shape.
      panels: ["cards"],
    });
    // Assert expected test outcome.
    assert.equal(canPerformAction(tech, "cards.view"), true);
    // Assert expected test outcome.
    assert.equal(canPerformAction(tech, "tickets.resolve"), false);
    // Assert expected test outcome.
    assert.deepEqual(panelsForUser(tech), ["cards"]);
  });

  // Unit test case.
  it("missing actions/panels keep legacy role fallback including notifications", () => {
    // Local constant binding.
    const tech = user({ role: "technician" });
    // Assert expected test outcome.
    assert.equal(canPerformAction(tech, "tickets.resolve"), true);
    // Iterate collection / range.
    for (const panel of panelsForRole("technician")) {
      // Assert expected test outcome.
      assert.ok(panelsForUser(tech).includes(panel));
    }
    // Assert expected test outcome.
    assert.ok(panelsForUser(tech).includes("notifications"));
  });

  // Unit test case.
  it("explicit notifications grant is honored without client inject", () => {
    // Local constant binding.
    const tech = user({
      // Field/property in this shape.
      role: "technician",
      // Field/property in this shape.
      panels: ["repairs", "notifications"],
    });
    // Assert expected test outcome.
    assert.deepEqual(panelsForUser(tech), ["repairs", "notifications"]);
  });

  // Unit test case.
  it("explicit partial grants authorize only their matching ticket action", () => {
    // Local constant binding.
    const housekeeper = user({ role: "housekeeper", actions: ["tickets.assign"] });
    // Assert expected test outcome.
    assert.equal(canPerformAction(housekeeper, "tickets.assign"), true);
    // Assert expected test outcome.
    assert.equal(canPerformAction(housekeeper, "tickets.resolve"), false);
    // Assert expected test outcome.
    assert.equal(canPerformAction(housekeeper, "tickets.close"), false);
  });

  // Unit test case.
  it("owner still bypasses action checks", () => {
    // Local constant binding.
    const owner = user({ role: "owner", actions: [] });
    // Assert expected test outcome.
    assert.equal(canPerformAction(owner, "tickets.resolve"), true);
  });

  // Unit test case.
  it("legacy role helpers are not part of the public capabilities surface", async () => {
    // Local constant binding.
    const caps = await import("./capabilities");
    // Assert expected test outcome.
    assert.equal(
      // Continue multi-line list/arguments.
      "canResolveIssues" in caps,
      // List item in import/export/params.
      false,
      // Continue multi-line list/arguments.
      "canResolveIssues must not be exported",
    );
    // Assert expected test outcome.
    assert.equal(
      // Continue multi-line list/arguments.
      "canAssignIssues" in caps,
      // List item in import/export/params.
      false,
      // Continue multi-line list/arguments.
      "canAssignIssues must not be exported",
    );
    // Assert expected test outcome.
    assert.equal(
      // Continue multi-line list/arguments.
      "canCloseIssues" in caps,
      // List item in import/export/params.
      false,
      // Continue multi-line list/arguments.
      "canCloseIssues must not be exported",
    );
  });
});

// Local constant binding.
const ALL_ON: ModuleToggles = {
  // Field/property in this shape.
  rooms: true,
  // Field/property in this shape.
  common: true,
  // Field/property in this shape.
  cleaning: true,
  // Field/property in this shape.
  maintenance: true,
  // Field/property in this shape.
  my_work: true,
  // Field/property in this shape.
  repairs: true,
  // Field/property in this shape.
  team: true,
  // Field/property in this shape.
  live: true,
  // Field/property in this shape.
  control: true,
  // Field/property in this shape.
  daily_plan: true,
  // Field/property in this shape.
  attendance: true,
  // Field/property in this shape.
  access_cards: true,
  // Field/property in this shape.
  analytics: true,
  // Field/property in this shape.
  audit: true,
};

// Local constant binding.
const SAMPLE_PANELS: Panel[] = [
  // Continue multi-line list/arguments.
  "rooms",
  // Continue multi-line list/arguments.
  "common",
  // Continue multi-line list/arguments.
  "team",
  // Continue multi-line list/arguments.
  "live",
  // Continue multi-line list/arguments.
  "plan",
  // Continue multi-line list/arguments.
  "control",
  // Continue multi-line list/arguments.
  "attendance",
  // Continue multi-line list/arguments.
  "cards",
  // Continue multi-line list/arguments.
  "results",
  // Continue multi-line list/arguments.
  "analytics",
  // Continue multi-line list/arguments.
  "cleaning",
  // Continue multi-line list/arguments.
  "mywork",
  // Continue multi-line list/arguments.
  "repairs",
  // Continue multi-line list/arguments.
  "audit",
  // Continue multi-line list/arguments.
  "home",
  // Continue multi-line list/arguments.
  "notifications",
  // Continue multi-line list/arguments.
  "settings",
  // Continue multi-line list/arguments.
  "permissions",
];

// Group related unit tests.
describe("filterPanelsByModules", () => {
  // Unit test case.
  it("passes through when modules are null or undefined", () => {
    // Assert expected test outcome.
    assert.deepEqual(filterPanelsByModules(SAMPLE_PANELS, null), SAMPLE_PANELS);
    // Assert expected test outcome.
    assert.deepEqual(
      // Invoke helper or pass arguments.
      filterPanelsByModules(SAMPLE_PANELS, undefined),
      // List item in import/export/params.
      SAMPLE_PANELS,
    );
  });

  // Unit test case.
  it("hides one-to-one panels when modules are disabled", () => {
    // Local constant binding.
    const modules: ModuleToggles = {
      // Spread remaining fields/props.
      ...ALL_ON,
      // Field/property in this shape.
      rooms: false,
      // Field/property in this shape.
      common: false,
      // Field/property in this shape.
      team: false,
      // Field/property in this shape.
      live: false,
      // Field/property in this shape.
      daily_plan: false,
      // Field/property in this shape.
      control: false,
      // Field/property in this shape.
      attendance: false,
      // Field/property in this shape.
      access_cards: false,
      // Field/property in this shape.
      analytics: false,
      // Field/property in this shape.
      cleaning: false,
      // Field/property in this shape.
      audit: false,
    };
    // Local constant binding.
    const kept = filterPanelsByModules(SAMPLE_PANELS, modules);
    // Iterate collection / range.
    for (const hidden of [
      // Continue multi-line list/arguments.
      "rooms",
      // Continue multi-line list/arguments.
      "common",
      // Continue multi-line list/arguments.
      "team",
      // Continue multi-line list/arguments.
      "live",
      // Continue multi-line list/arguments.
      "plan",
      // Continue multi-line list/arguments.
      "control",
      // Continue multi-line list/arguments.
      "attendance",
      // Continue multi-line list/arguments.
      "cards",
      // Continue multi-line list/arguments.
      "results",
      // Continue multi-line list/arguments.
      "analytics",
      // Continue multi-line list/arguments.
      "cleaning",
      // Continue multi-line list/arguments.
      "audit",
    // Open multi-line construct.
    ] as Panel[]) {
      // Assert expected test outcome.
      assert.equal(kept.includes(hidden), false, hidden);
    }
  });

  // Unit test case.
  it("requires my_work and maintenance or cleaning for mywork", () => {
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      filterPanelsByModules(["mywork"], {
        // Spread remaining fields/props.
        ...ALL_ON,
        // Field/property in this shape.
        my_work: false,
      // Invoke helper or pass arguments.
      }).includes("mywork"),
      // List item in import/export/params.
      false,
    );
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      filterPanelsByModules(["mywork"], {
        // Spread remaining fields/props.
        ...ALL_ON,
        // Field/property in this shape.
        maintenance: false,
        // Field/property in this shape.
        cleaning: false,
      // Invoke helper or pass arguments.
      }).includes("mywork"),
      // List item in import/export/params.
      false,
    );
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      filterPanelsByModules(["mywork"], {
        // Spread remaining fields/props.
        ...ALL_ON,
        // Field/property in this shape.
        maintenance: false,
        // Field/property in this shape.
        cleaning: true,
      // Invoke helper or pass arguments.
      }).includes("mywork"),
      // List item in import/export/params.
      true,
    );
  });

  // Unit test case.
  it("requires repairs and maintenance for repairs panel", () => {
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      filterPanelsByModules(["repairs"], {
        // Spread remaining fields/props.
        ...ALL_ON,
        // Field/property in this shape.
        repairs: false,
      // Invoke helper or pass arguments.
      }).includes("repairs"),
      // List item in import/export/params.
      false,
    );
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      filterPanelsByModules(["repairs"], {
        // Spread remaining fields/props.
        ...ALL_ON,
        // Field/property in this shape.
        maintenance: false,
      // Invoke helper or pass arguments.
      }).includes("repairs"),
      // List item in import/export/params.
      false,
    );
    // Assert expected test outcome.
    assert.equal(
      // Invoke helper or pass arguments.
      filterPanelsByModules(["repairs"], ALL_ON).includes("repairs"),
      // List item in import/export/params.
      true,
    );
  });

  // Unit test case.
  it("keeps home when maintenance or cleaning is enabled", () => {
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      filterPanelsByModules(["home"], {
        // Spread remaining fields/props.
        ...ALL_ON,
        // Field/property in this shape.
        maintenance: false,
        // Field/property in this shape.
        cleaning: false,
      // Invoke helper or pass arguments.
      }).includes("home"),
      // List item in import/export/params.
      false,
    );
    // Assert expected test outcome.
    assert.equal(
      // Open multi-line construct.
      filterPanelsByModules(["home"], {
        // Spread remaining fields/props.
        ...ALL_ON,
        // Field/property in this shape.
        maintenance: true,
        // Field/property in this shape.
        cleaning: false,
      // Invoke helper or pass arguments.
      }).includes("home"),
      // List item in import/export/params.
      true,
    );
  });

  // Unit test case.
  it("always keeps unmapped panels when modules object is present", () => {
    // Local constant binding.
    const kept = filterPanelsByModules(
      // Continue multi-line list/arguments.
      ["notifications", "settings", "permissions"],
      // Continue multi-line list/arguments.
      { ...ALL_ON, rooms: false },
    );
    // Assert expected test outcome.
    assert.deepEqual(kept, ["notifications", "settings", "permissions"]);
  });
});
