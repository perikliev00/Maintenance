import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canPerformAction,
  filterPanelsByModules,
  panelsForRole,
  panelsForUser,
  type AuthUser,
  type ModuleToggles,
  type Panel,
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
    assert.equal(canPerformAction(tech, "tickets.close"), false);
  });

  it("panels: [] does not restore role panels (notifications not forced)", () => {
    const tech = user({ role: "technician", panels: [] });
    assert.deepEqual(panelsForUser(tech), []);
  });

  it("non-empty arrays only allow granted capabilities", () => {
    const tech = user({
      role: "technician",
      actions: ["cards.view"],
      panels: ["cards"],
    });
    assert.equal(canPerformAction(tech, "cards.view"), true);
    assert.equal(canPerformAction(tech, "tickets.resolve"), false);
    assert.deepEqual(panelsForUser(tech), ["cards"]);
  });

  it("missing actions/panels keep legacy role fallback including notifications", () => {
    const tech = user({ role: "technician" });
    assert.equal(canPerformAction(tech, "tickets.resolve"), true);
    for (const panel of panelsForRole("technician")) {
      assert.ok(panelsForUser(tech).includes(panel));
    }
    assert.ok(panelsForUser(tech).includes("notifications"));
  });

  it("explicit notifications grant is honored without client inject", () => {
    const tech = user({
      role: "technician",
      panels: ["repairs", "notifications"],
    });
    assert.deepEqual(panelsForUser(tech), ["repairs", "notifications"]);
  });

  it("explicit partial grants authorize only their matching ticket action", () => {
    const housekeeper = user({ role: "housekeeper", actions: ["tickets.assign"] });
    assert.equal(canPerformAction(housekeeper, "tickets.assign"), true);
    assert.equal(canPerformAction(housekeeper, "tickets.resolve"), false);
    assert.equal(canPerformAction(housekeeper, "tickets.close"), false);
  });

  it("owner still bypasses action checks", () => {
    const owner = user({ role: "owner", actions: [] });
    assert.equal(canPerformAction(owner, "tickets.resolve"), true);
  });

  it("legacy role helpers are not part of the public capabilities surface", async () => {
    const caps = await import("./capabilities");
    assert.equal(
      "canResolveIssues" in caps,
      false,
      "canResolveIssues must not be exported",
    );
    assert.equal(
      "canAssignIssues" in caps,
      false,
      "canAssignIssues must not be exported",
    );
    assert.equal(
      "canCloseIssues" in caps,
      false,
      "canCloseIssues must not be exported",
    );
  });
});

const ALL_ON: ModuleToggles = {
  rooms: true,
  common: true,
  cleaning: true,
  maintenance: true,
  my_work: true,
  repairs: true,
  team: true,
  live: true,
  control: true,
  daily_plan: true,
  attendance: true,
  access_cards: true,
  analytics: true,
  audit: true,
};

const SAMPLE_PANELS: Panel[] = [
  "rooms",
  "common",
  "team",
  "live",
  "plan",
  "control",
  "attendance",
  "cards",
  "results",
  "analytics",
  "cleaning",
  "mywork",
  "repairs",
  "audit",
  "home",
  "notifications",
  "settings",
  "permissions",
];

describe("filterPanelsByModules", () => {
  it("passes through when modules are null or undefined", () => {
    assert.deepEqual(filterPanelsByModules(SAMPLE_PANELS, null), SAMPLE_PANELS);
    assert.deepEqual(
      filterPanelsByModules(SAMPLE_PANELS, undefined),
      SAMPLE_PANELS,
    );
  });

  it("hides one-to-one panels when modules are disabled", () => {
    const modules: ModuleToggles = {
      ...ALL_ON,
      rooms: false,
      common: false,
      team: false,
      live: false,
      daily_plan: false,
      control: false,
      attendance: false,
      access_cards: false,
      analytics: false,
      cleaning: false,
      audit: false,
    };
    const kept = filterPanelsByModules(SAMPLE_PANELS, modules);
    for (const hidden of [
      "rooms",
      "common",
      "team",
      "live",
      "plan",
      "control",
      "attendance",
      "cards",
      "results",
      "analytics",
      "cleaning",
      "audit",
    ] as Panel[]) {
      assert.equal(kept.includes(hidden), false, hidden);
    }
  });

  it("requires my_work and maintenance or cleaning for mywork", () => {
    assert.equal(
      filterPanelsByModules(["mywork"], {
        ...ALL_ON,
        my_work: false,
      }).includes("mywork"),
      false,
    );
    assert.equal(
      filterPanelsByModules(["mywork"], {
        ...ALL_ON,
        maintenance: false,
        cleaning: false,
      }).includes("mywork"),
      false,
    );
    assert.equal(
      filterPanelsByModules(["mywork"], {
        ...ALL_ON,
        maintenance: false,
        cleaning: true,
      }).includes("mywork"),
      true,
    );
  });

  it("requires repairs and maintenance for repairs panel", () => {
    assert.equal(
      filterPanelsByModules(["repairs"], {
        ...ALL_ON,
        repairs: false,
      }).includes("repairs"),
      false,
    );
    assert.equal(
      filterPanelsByModules(["repairs"], {
        ...ALL_ON,
        maintenance: false,
      }).includes("repairs"),
      false,
    );
    assert.equal(
      filterPanelsByModules(["repairs"], ALL_ON).includes("repairs"),
      true,
    );
  });

  it("keeps home when maintenance or cleaning is enabled", () => {
    assert.equal(
      filterPanelsByModules(["home"], {
        ...ALL_ON,
        maintenance: false,
        cleaning: false,
      }).includes("home"),
      false,
    );
    assert.equal(
      filterPanelsByModules(["home"], {
        ...ALL_ON,
        maintenance: true,
        cleaning: false,
      }).includes("home"),
      true,
    );
  });

  it("always keeps unmapped panels when modules object is present", () => {
    const kept = filterPanelsByModules(
      ["notifications", "settings", "permissions"],
      { ...ALL_ON, rooms: false },
    );
    assert.deepEqual(kept, ["notifications", "settings", "permissions"]);
  });
});
