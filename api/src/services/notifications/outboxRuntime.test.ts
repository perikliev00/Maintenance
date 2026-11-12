// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module zod/v3 for this service.
import { ZodError } from "zod/v3";
// Import module dependency for this service.
import {
  // Run next step: classifyOutboxError,
  classifyOutboxError,
  // Run next step: computeNextAttemptAt,
  computeNextAttemptAt,
  // Run next step: decodeNotificationPayload,
  decodeNotificationPayload,
  // Run next step: flushOutbox,
  flushOutbox,
  // Run next step: OUTBOX_MAX_TRANSIENT_ATTEMPTS,
  OUTBOX_MAX_TRANSIENT_ATTEMPTS,
// Run next step: } from "./outboxRuntime";
} from "./outboxRuntime";

// Run next step: describe("decodeNotificationPayload", () => {
describe("decodeNotificationPayload", () => {
  // Run next step: it("accepts a well-formed CreateNotificationInput", () => {
  it("accepts a well-formed CreateNotificationInput", () => {
    // Capture decoded for use in this scope.
    const decoded = decodeNotificationPayload({
      // Set type on the structure being built.
      type: "ticket.resolved",
      // Set title on the structure being built.
      title: "Ticket resolved",
      // Set body on the structure being built.
      body: "101: leak",
      // Set entityType on the structure being built.
      entityType: "ticket",
      // Set entityId on the structure being built.
      entityId: "t1",
      // Set recipientEmployeeIds on the structure being built.
      recipientEmployeeIds: ["e1"],
      // Set dedupeKey on the structure being built.
      dedupeKey: "ticket.resolved:ev1",
      // Set payload on the structure being built.
      payload: { panel: "repairs", ticketId: "t1" },
    });
    // Run next step: assert.equal(decoded.entityId, "t1");
    assert.equal(decoded.entityId, "t1");
    // Run next step: assert.deepEqual(decoded.recipientEmployeeIds, ["e1"]);
    assert.deepEqual(decoded.recipientEmployeeIds, ["e1"]);
  });

  // Run next step: it("rejects malformed persisted JSON instead of casting", ()…
  it("rejects malformed persisted JSON instead of casting", () => {
    // Run next step: assert.throws(() => decodeNotificationPayload({ type: "x" })…
    assert.throws(() => decodeNotificationPayload({ type: "x" }), /required|invalid/i);
    // Run next step: assert.throws(() => decodeNotificationPayload(null));
    assert.throws(() => decodeNotificationPayload(null));
    // Run next step: assert.throws(() =>
    assert.throws(() =>
      // Run next step: decodeNotificationPayload({
      decodeNotificationPayload({
        // Set type on the structure being built.
        type: "ticket.resolved",
        // Set title on the structure being built.
        title: "t",
        // Set body on the structure being built.
        body: "b",
        // Set entityType on the structure being built.
        entityType: "ticket",
        // Set entityId on the structure being built.
        entityId: "t1",
        // Set recipientEmployeeIds on the structure being built.
        recipientEmployeeIds: "not-an-array",
        // Set dedupeKey on the structure being built.
        dedupeKey: "k",
      }),
    );
  });
});

// Run next step: describe("classifyOutboxError / backoff", () => {
describe("classifyOutboxError / backoff", () => {
  // Run next step: it("treats ZodError as permanent and others as transient", (…
  it("treats ZodError as permanent and others as transient", () => {
    // Run next step: assert.equal(classifyOutboxError(new ZodError([])), "permane…
    assert.equal(classifyOutboxError(new ZodError([])), "permanent");
    // Run next step: assert.equal(classifyOutboxError(new Error("connection reset…
    assert.equal(classifyOutboxError(new Error("connection reset")), "transient");
  });

  // Run next step: it("caps exponential backoff at one hour", () => {
  it("caps exponential backoff at one hour", () => {
    // Capture now for use in this scope.
    const now = new Date("2026-11-03T12:00:00.000Z");
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: computeNextAttemptAt(1, now).toISOString(),
      computeNextAttemptAt(1, now).toISOString(),
      // Run next step: "2026-11-03T12:00:30.000Z",
      "2026-11-03T12:00:30.000Z",
    );
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: computeNextAttemptAt(2, now).toISOString(),
      computeNextAttemptAt(2, now).toISOString(),
      // Run next step: "2026-11-03T12:01:00.000Z",
      "2026-11-03T12:01:00.000Z",
    );
    // Capture capped for use in this scope.
    const capped = computeNextAttemptAt(20, now).getTime() - now.getTime();
    // Run next step: assert.equal(capped, 3600_000);
    assert.equal(capped, 3600_000);
  });
});

// Run next step: describe("flushOutbox fairness", () => {
describe("flushOutbox fairness", () => {
  // Run next step: it("quarantines permanent failures then reports honest backl…
  it("quarantines permanent failures then reports honest backlog metrics", async () => {
    // Capture failures for use in this scope.
    const failures = new Map<string, { kind: string; message: string }>();
    // Capture delivered for use in this scope.
    const delivered: string[] = [];
    // Load result asynchronously for the next steps.
    const result = await flushOutbox({
      // Set listEligibleKeys on the structure being built.
      listEligibleKeys: async () => ["bad-1", "bad-2", "good"],
      // Set deliver on the structure being built.
      deliver: async (key) => {
        // Branch when this condition holds so the right path runs.
        if (key.startsWith("bad")) {
          // Abort with an error so callers can react.
          throw new ZodError([]);
        }
        // Append an entry to the accumulating collection.
        delivered.push(key);
      },
      // Set recordFailure on the structure being built.
      recordFailure: async (key, kind, message) => {
        // Store a keyed value for later lookup.
        failures.set(key, { kind, message });
      },
      // Set countBacklog on the structure being built.
      countBacklog: async () => ({
        // Set eligiblePending on the structure being built.
        eligiblePending: 0,
        // Set scheduledRetry on the structure being built.
        scheduledRetry: 0,
        // Set quarantined on the structure being built.
        quarantined: 2,
        // Set backlog on the structure being built.
        backlog: 2,
      }),
      // Set errorLabel on the structure being built.
      errorLabel: "test outbox failed",
    });
    // Run next step: assert.deepEqual(delivered, ["good"]);
    assert.deepEqual(delivered, ["good"]);
    // Run next step: assert.equal(result.delivered, 1);
    assert.equal(result.delivered, 1);
    // Run next step: assert.equal(result.batchFailures, 2);
    assert.equal(result.batchFailures, 2);
    // Run next step: assert.equal(result.quarantined, 2);
    assert.equal(result.quarantined, 2);
    // Run next step: assert.equal(result.backlog, 2);
    assert.equal(result.backlog, 2);
    // Run next step: assert.equal(result.pending, 0);
    assert.equal(result.pending, 0);
    // Run next step: assert.equal(result.error, "test outbox failed");
    assert.equal(result.error, "test outbox failed");
    // Run next step: assert.equal(failures.get("bad-1")?.kind, "permanent");
    assert.equal(failures.get("bad-1")?.kind, "permanent");
    // Run next step: assert.equal(OUTBOX_MAX_TRANSIENT_ATTEMPTS >= 2, true);
    assert.equal(OUTBOX_MAX_TRANSIENT_ATTEMPTS >= 2, true);
  });

  // Run next step: it("records transient failures without treating backlog as z…
  it("records transient failures without treating backlog as zero", async () => {
    // Load result asynchronously for the next steps.
    const result = await flushOutbox({
      // Set listEligibleKeys on the structure being built.
      listEligibleKeys: async () => ["a"],
      // Set deliver on the structure being built.
      deliver: async () => {
        // Abort with an error so callers can react.
        throw new Error("smtp down");
      },
      // Set recordFailure on the structure being built.
      recordFailure: async () => {},
      // Set countBacklog on the structure being built.
      countBacklog: async () => ({
        // Set eligiblePending on the structure being built.
        eligiblePending: 0,
        // Set scheduledRetry on the structure being built.
        scheduledRetry: 1,
        // Set quarantined on the structure being built.
        quarantined: 0,
        // Set backlog on the structure being built.
        backlog: 1,
      }),
      // Set errorLabel on the structure being built.
      errorLabel: "down",
    });
    // Run next step: assert.equal(result.delivered, 0);
    assert.equal(result.delivered, 0);
    // Run next step: assert.equal(result.batchFailures, 1);
    assert.equal(result.batchFailures, 1);
    // Run next step: assert.equal(result.scheduledRetry, 1);
    assert.equal(result.scheduledRetry, 1);
    // Run next step: assert.equal(result.backlog, 1);
    assert.equal(result.backlog, 1);
    // Run next step: assert.equal(result.pending, 0);
    assert.equal(result.pending, 0);
  });
});
