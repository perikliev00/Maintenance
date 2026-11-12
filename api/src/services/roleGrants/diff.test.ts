// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module @prisma/client for this service.
import { GrantKind } from "@prisma/client";
// Import module ./diff for this service.
import { diffGrantSets } from "./diff";

// Run next step: describe("diffGrantSets", () => {
describe("diffGrantSets", () => {
  // Run next step: it("detects panel/action grants and revokes", () => {
  it("detects panel/action grants and revokes", () => {
    // Capture changes for use in this scope.
    const changes = diffGrantSets(
      // Run next step: { panels: ["home", "rooms"], actions: ["rooms.view"] },
      { panels: ["home", "rooms"], actions: ["rooms.view"] },
      // Run next step: { panels: ["home", "permissions"], actions: ["rooms.view", "…
      { panels: ["home", "permissions"], actions: ["rooms.view", "permissions.manage"] },
    );
    // Run next step: assert.deepEqual(changes, [
    assert.deepEqual(changes, [
      // Run next step: { kind: GrantKind.panel, key: "permissions", granted: true }…
      { kind: GrantKind.panel, key: "permissions", granted: true },
      // Run next step: { kind: GrantKind.panel, key: "rooms", granted: false },
      { kind: GrantKind.panel, key: "rooms", granted: false },
      // Run next step: { kind: GrantKind.action, key: "permissions.manage", granted…
      { kind: GrantKind.action, key: "permissions.manage", granted: true },
    ]);
  });

  // Run next step: it("returns empty when sets are identical", () => {
  it("returns empty when sets are identical", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: diffGrantSets(
      diffGrantSets(
        // Run next step: { panels: ["home"], actions: ["rooms.view"] },
        { panels: ["home"], actions: ["rooms.view"] },
        // Run next step: { panels: ["home"], actions: ["rooms.view"] },
        { panels: ["home"], actions: ["rooms.view"] },
      ),
      // Run next step: [],
      [],
    );
  });
});
