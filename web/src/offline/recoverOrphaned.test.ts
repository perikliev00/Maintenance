// Import dependency used by this module.
import assert from "node:assert/strict";
// Import dependency used by this module.
import { describe, it } from "node:test";
// Import dependency used by this module.
import { recoverOrphanedSending } from "./recoverOrphaned";
// Import dependency used by this module.
import type { QueuedAction } from "./storage";

// Function definition.
function row(
  // Field/property in this shape.
  partial: Partial<QueuedAction> & Pick<QueuedAction, "id" | "status">,
// Open multi-line construct.
): QueuedAction {
  // Return computed result to caller.
  return {
    // Field/property in this shape.
    userId: "u1",
    // Field/property in this shape.
    commandId: `cmd-${partial.id}`,
    // Field/property in this shape.
    type: "cleaning.start",
    // Field/property in this shape.
    url: "/api/tasks/t1/start",
    // Field/property in this shape.
    method: "POST",
    // Field/property in this shape.
    body: {},
    // Field/property in this shape.
    createdAt: 1,
    // Field/property in this shape.
    updatedAt: 100,
    // Field/property in this shape.
    lastError: null,
    // Field/property in this shape.
    conflictCode: null,
    // Field/property in this shape.
    conflictMessage: null,
    // Field/property in this shape.
    conflictDetails: null,
    // Field/property in this shape.
    retries: 0,
    // Spread remaining fields/props.
    ...partial,
  };
}

// Group related unit tests.
describe("recoverOrphanedSending", () => {
  // Unit test case.
  it("returns empty for empty input", () => {
    // Assert expected test outcome.
    assert.deepEqual(recoverOrphanedSending([]), []);
  });

  // Unit test case.
  it("leaves non-sending rows unchanged", () => {
    // Local constant binding.
    const pending = row({ id: "p", status: "pending", updatedAt: 50 });
    // Local constant binding.
    const conflict = row({ id: "c", status: "conflict", updatedAt: 60 });
    // Local constant binding.
    const failed = row({ id: "f", status: "failed", updatedAt: 70 });
    // Local constant binding.
    const out = recoverOrphanedSending([pending, conflict, failed]);
    // Assert expected test outcome.
    assert.equal(out[0], pending);
    // Assert expected test outcome.
    assert.equal(out[1], conflict);
    // Assert expected test outcome.
    assert.equal(out[2], failed);
    // Assert expected test outcome.
    assert.equal(out[0]!.updatedAt, 50);
  });

  // Unit test case.
  it("resets sending to pending with fresh updatedAt", () => {
    // Local constant binding.
    const before = Date.now();
    // Local constant binding.
    const sending = row({ id: "s", status: "sending", updatedAt: 10 });
    // Local constant binding.
    const out = recoverOrphanedSending([sending]);
    // Assert expected test outcome.
    assert.equal(out.length, 1);
    // Assert expected test outcome.
    assert.equal(out[0]!.status, "pending");
    // Assert expected test outcome.
    assert.ok(out[0]!.updatedAt >= before);
    // Assert expected test outcome.
    assert.equal(sending.status, "sending");
    // Assert expected test outcome.
    assert.equal(sending.updatedAt, 10);
  });

  // Unit test case.
  it("only flips sending rows in a mixed list", () => {
    // Local constant binding.
    const pending = row({ id: "p", status: "pending" });
    // Local constant binding.
    const sending = row({ id: "s", status: "sending", updatedAt: 1 });
    // Local constant binding.
    const out = recoverOrphanedSending([pending, sending]);
    // Assert expected test outcome.
    assert.equal(out[0], pending);
    // Assert expected test outcome.
    assert.equal(out[1]!.status, "pending");
    // Assert expected test outcome.
    assert.notEqual(out[1], sending);
  });
});
