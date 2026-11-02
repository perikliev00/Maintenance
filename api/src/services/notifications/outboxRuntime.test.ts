import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeNotificationPayload } from "./outboxRuntime";

describe("decodeNotificationPayload", () => {
  it("accepts a well-formed CreateNotificationInput", () => {
    const decoded = decodeNotificationPayload({
      type: "ticket.resolved",
      title: "Ticket resolved",
      body: "101: leak",
      entityType: "ticket",
      entityId: "t1",
      recipientEmployeeIds: ["e1"],
      dedupeKey: "ticket.resolved:ev1",
      payload: { panel: "repairs", ticketId: "t1" },
    });
    assert.equal(decoded.entityId, "t1");
    assert.deepEqual(decoded.recipientEmployeeIds, ["e1"]);
  });

  it("rejects malformed persisted JSON instead of casting", () => {
    assert.throws(() => decodeNotificationPayload({ type: "x" }), /required|invalid/i);
    assert.throws(() => decodeNotificationPayload(null));
    assert.throws(() =>
      decodeNotificationPayload({
        type: "ticket.resolved",
        title: "t",
        body: "b",
        entityType: "ticket",
        entityId: "t1",
        recipientEmployeeIds: "not-an-array",
        dedupeKey: "k",
      }),
    );
  });
});
