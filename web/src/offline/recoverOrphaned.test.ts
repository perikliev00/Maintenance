import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recoverOrphanedSending } from "./recoverOrphaned";
import type { QueuedAction } from "./storage";

function row(
  partial: Partial<QueuedAction> & Pick<QueuedAction, "id" | "status">,
): QueuedAction {
  return {
    userId: "u1",
    commandId: `cmd-${partial.id}`,
    type: "cleaning.start",
    url: "/api/tasks/t1/start",
    method: "POST",
    body: {},
    createdAt: 1,
    updatedAt: 100,
    lastError: null,
    conflictCode: null,
    conflictMessage: null,
    conflictDetails: null,
    retries: 0,
    ...partial,
  };
}

describe("recoverOrphanedSending", () => {
  it("returns empty for empty input", () => {
    assert.deepEqual(recoverOrphanedSending([]), []);
  });

  it("leaves non-sending rows unchanged", () => {
    const pending = row({ id: "p", status: "pending", updatedAt: 50 });
    const conflict = row({ id: "c", status: "conflict", updatedAt: 60 });
    const failed = row({ id: "f", status: "failed", updatedAt: 70 });
    const out = recoverOrphanedSending([pending, conflict, failed]);
    assert.equal(out[0], pending);
    assert.equal(out[1], conflict);
    assert.equal(out[2], failed);
    assert.equal(out[0]!.updatedAt, 50);
  });

  it("resets sending to pending with fresh updatedAt", () => {
    const before = Date.now();
    const sending = row({ id: "s", status: "sending", updatedAt: 10 });
    const out = recoverOrphanedSending([sending]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.status, "pending");
    assert.ok(out[0]!.updatedAt >= before);
    assert.equal(sending.status, "sending");
    assert.equal(sending.updatedAt, 10);
  });

  it("only flips sending rows in a mixed list", () => {
    const pending = row({ id: "p", status: "pending" });
    const sending = row({ id: "s", status: "sending", updatedAt: 1 });
    const out = recoverOrphanedSending([pending, sending]);
    assert.equal(out[0], pending);
    assert.equal(out[1]!.status, "pending");
    assert.notEqual(out[1], sending);
  });
});
