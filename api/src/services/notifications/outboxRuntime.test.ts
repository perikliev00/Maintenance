import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ZodError } from "zod/v3";
import {
  classifyOutboxError,
  computeNextAttemptAt,
  decodeNotificationPayload,
  flushOutbox,
  OUTBOX_MAX_TRANSIENT_ATTEMPTS,
} from "./outboxRuntime";

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

describe("classifyOutboxError / backoff", () => {
  it("treats ZodError as permanent and others as transient", () => {
    assert.equal(classifyOutboxError(new ZodError([])), "permanent");
    assert.equal(classifyOutboxError(new Error("connection reset")), "transient");
  });

  it("caps exponential backoff at one hour", () => {
    const now = new Date("2026-11-03T12:00:00.000Z");
    assert.equal(
      computeNextAttemptAt(1, now).toISOString(),
      "2026-11-03T12:00:30.000Z",
    );
    assert.equal(
      computeNextAttemptAt(2, now).toISOString(),
      "2026-11-03T12:01:00.000Z",
    );
    const capped = computeNextAttemptAt(20, now).getTime() - now.getTime();
    assert.equal(capped, 3600_000);
  });
});

describe("flushOutbox fairness", () => {
  it("quarantines permanent failures then reports honest backlog metrics", async () => {
    const failures = new Map<string, { kind: string; message: string }>();
    const delivered: string[] = [];
    const result = await flushOutbox({
      listEligibleKeys: async () => ["bad-1", "bad-2", "good"],
      deliver: async (key) => {
        if (key.startsWith("bad")) {
          throw new ZodError([]);
        }
        delivered.push(key);
      },
      recordFailure: async (key, kind, message) => {
        failures.set(key, { kind, message });
      },
      countBacklog: async () => ({
        eligiblePending: 0,
        scheduledRetry: 0,
        quarantined: 2,
        backlog: 2,
      }),
      errorLabel: "test outbox failed",
    });
    assert.deepEqual(delivered, ["good"]);
    assert.equal(result.delivered, 1);
    assert.equal(result.batchFailures, 2);
    assert.equal(result.quarantined, 2);
    assert.equal(result.backlog, 2);
    assert.equal(result.pending, 0);
    assert.equal(result.error, "test outbox failed");
    assert.equal(failures.get("bad-1")?.kind, "permanent");
    assert.equal(OUTBOX_MAX_TRANSIENT_ATTEMPTS >= 2, true);
  });

  it("records transient failures without treating backlog as zero", async () => {
    const result = await flushOutbox({
      listEligibleKeys: async () => ["a"],
      deliver: async () => {
        throw new Error("smtp down");
      },
      recordFailure: async () => {},
      countBacklog: async () => ({
        eligiblePending: 0,
        scheduledRetry: 1,
        quarantined: 0,
        backlog: 1,
      }),
      errorLabel: "down",
    });
    assert.equal(result.delivered, 0);
    assert.equal(result.batchFailures, 1);
    assert.equal(result.scheduledRetry, 1);
    assert.equal(result.backlog, 1);
    assert.equal(result.pending, 0);
  });
});
