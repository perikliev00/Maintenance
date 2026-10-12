import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizePanelsActions } from "./normalize";

describe("normalizePanelsActions", () => {
  it("dedupes panels and actions while preserving order", () => {
    assert.deepEqual(
      normalizePanelsActions(["rooms", "rooms", "home"], ["rooms.view", "rooms.view"]),
      { panels: ["rooms", "home"], actions: ["rooms.view"] },
    );
  });

  it("filters unknown panel and action keys", () => {
    assert.deepEqual(
      normalizePanelsActions(["rooms", "not-a-panel"], ["rooms.view", "fake.action"]),
      { panels: ["rooms"], actions: ["rooms.view"] },
    );
  });

  it("returns empty grants for unknown-only or empty input", () => {
    assert.deepEqual(normalizePanelsActions(["x"], ["y"]), {
      panels: [],
      actions: [],
    });
    assert.deepEqual(normalizePanelsActions([], []), {
      panels: [],
      actions: [],
    });
  });

  it("appends permissions panel when permissions.manage is present", () => {
    assert.deepEqual(
      normalizePanelsActions(["rooms"], ["permissions.manage"]),
      { panels: ["rooms", "permissions"], actions: ["permissions.manage"] },
    );
  });

  it("strips permissions panel when permissions.manage is absent", () => {
    assert.deepEqual(
      normalizePanelsActions(["permissions", "rooms"], ["rooms.view"]),
      { panels: ["rooms"], actions: ["rooms.view"] },
    );
  });

  it("keeps a single permissions panel when manage is already paired", () => {
    assert.deepEqual(
      normalizePanelsActions(
        ["permissions", "permissions"],
        ["permissions.manage"],
      ),
      { panels: ["permissions"], actions: ["permissions.manage"] },
    );
  });

  it("keeps only permissions panel when manage is set with unknown panels", () => {
    assert.deepEqual(
      normalizePanelsActions(["bogus"], ["permissions.manage"]),
      { panels: ["permissions"], actions: ["permissions.manage"] },
    );
  });

  it("strips lone permissions panel without manage", () => {
    assert.deepEqual(normalizePanelsActions(["permissions"], []), {
      panels: [],
      actions: [],
    });
  });
});
