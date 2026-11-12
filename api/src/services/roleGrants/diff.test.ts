import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GrantKind } from "@prisma/client";
import { diffGrantSets } from "./diff";

describe("diffGrantSets", () => {
  it("detects panel/action grants and revokes", () => {
    const changes = diffGrantSets(
      { panels: ["home", "rooms"], actions: ["rooms.view"] },
      { panels: ["home", "permissions"], actions: ["rooms.view", "permissions.manage"] },
    );
    assert.deepEqual(changes, [
      { kind: GrantKind.panel, key: "permissions", granted: true },
      { kind: GrantKind.panel, key: "rooms", granted: false },
      { kind: GrantKind.action, key: "permissions.manage", granted: true },
    ]);
  });

  it("returns empty when sets are identical", () => {
    assert.deepEqual(
      diffGrantSets(
        { panels: ["home"], actions: ["rooms.view"] },
        { panels: ["home"], actions: ["rooms.view"] },
      ),
      [],
    );
  });
});
