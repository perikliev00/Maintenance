// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module ./normalize for this service.
import { normalizePanelsActions } from "./normalize";

// Run next step: describe("normalizePanelsActions", () => {
describe("normalizePanelsActions", () => {
  // Run next step: it("dedupes panels and actions while preserving order", () =…
  it("dedupes panels and actions while preserving order", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: normalizePanelsActions(["rooms", "rooms", "home"], ["rooms.v…
      normalizePanelsActions(["rooms", "rooms", "home"], ["rooms.view", "rooms.view"]),
      // Run next step: { panels: ["rooms", "home"], actions: ["rooms.view"] },
      { panels: ["rooms", "home"], actions: ["rooms.view"] },
    );
  });

  // Run next step: it("filters unknown panel and action keys", () => {
  it("filters unknown panel and action keys", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: normalizePanelsActions(["rooms", "not-a-panel"], ["rooms.vie…
      normalizePanelsActions(["rooms", "not-a-panel"], ["rooms.view", "fake.action"]),
      // Run next step: { panels: ["rooms"], actions: ["rooms.view"] },
      { panels: ["rooms"], actions: ["rooms.view"] },
    );
  });

  // Run next step: it("returns empty grants for unknown-only or empty input", (…
  it("returns empty grants for unknown-only or empty input", () => {
    // Run next step: assert.deepEqual(normalizePanelsActions(["x"], ["y"]), {
    assert.deepEqual(normalizePanelsActions(["x"], ["y"]), {
      // Set panels on the structure being built.
      panels: [],
      // Set actions on the structure being built.
      actions: [],
    });
    // Run next step: assert.deepEqual(normalizePanelsActions([], []), {
    assert.deepEqual(normalizePanelsActions([], []), {
      // Set panels on the structure being built.
      panels: [],
      // Set actions on the structure being built.
      actions: [],
    });
  });

  // Run next step: it("appends permissions panel when permissions.manage is pre…
  it("appends permissions panel when permissions.manage is present", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: normalizePanelsActions(["rooms"], ["permissions.manage"]),
      normalizePanelsActions(["rooms"], ["permissions.manage"]),
      // Run next step: { panels: ["rooms", "permissions"], actions: ["permissions.m…
      { panels: ["rooms", "permissions"], actions: ["permissions.manage"] },
    );
  });

  // Run next step: it("strips permissions panel when permissions.manage is abse…
  it("strips permissions panel when permissions.manage is absent", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: normalizePanelsActions(["permissions", "rooms"], ["rooms.vie…
      normalizePanelsActions(["permissions", "rooms"], ["rooms.view"]),
      // Run next step: { panels: ["rooms"], actions: ["rooms.view"] },
      { panels: ["rooms"], actions: ["rooms.view"] },
    );
  });

  // Run next step: it("keeps a single permissions panel when manage is already …
  it("keeps a single permissions panel when manage is already paired", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: normalizePanelsActions(
      normalizePanelsActions(
        // Run next step: ["permissions", "permissions"],
        ["permissions", "permissions"],
        // Run next step: ["permissions.manage"],
        ["permissions.manage"],
      ),
      // Run next step: { panels: ["permissions"], actions: ["permissions.manage"] }…
      { panels: ["permissions"], actions: ["permissions.manage"] },
    );
  });

  // Run next step: it("keeps only permissions panel when manage is set with unk…
  it("keeps only permissions panel when manage is set with unknown panels", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: normalizePanelsActions(["bogus"], ["permissions.manage"]),
      normalizePanelsActions(["bogus"], ["permissions.manage"]),
      // Run next step: { panels: ["permissions"], actions: ["permissions.manage"] }…
      { panels: ["permissions"], actions: ["permissions.manage"] },
    );
  });

  // Run next step: it("strips lone permissions panel without manage", () => {
  it("strips lone permissions panel without manage", () => {
    // Run next step: assert.deepEqual(normalizePanelsActions(["permissions"], [])…
    assert.deepEqual(normalizePanelsActions(["permissions"], []), {
      // Set panels on the structure being built.
      panels: [],
      // Set actions on the structure being built.
      actions: [],
    });
  });
});
