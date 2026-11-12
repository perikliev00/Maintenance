/**
 * Regression coverage for Audit page load races and partial failures .
 */
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  combineAuditLoadResults,
  // Support the surrounding logic for this step.
  formatAuditLoadErrors,
  // Support the surrounding logic for this step.
  formatAuditRelated,
  // Support the surrounding logic for this step.
  resolveEventsTableAfterLoad,
  // Support the surrounding logic for this step.
  settleAuditFetch,
  // Support the surrounding logic for this step.
  shouldApplyAuditRefresh,
// Support the surrounding logic for this step.
} from "./auditPageLogic";

// Group related tests under a shared suite name.
describe("stale refresh generation", () => {
  // Define a single test case and its expectation.
  it("rejects older generations", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(shouldApplyAuditRefresh(3, 4), false);
    // Invoke assert.equal to perform this step.
    assert.equal(shouldApplyAuditRefresh(4, 4), true);
  });

  // Define a single test case and its expectation.
  it("late stale success must not apply after a newer filter load", async () => {
    // Bind currentGen for use in the following logic.
    let currentGen = 0;
    // Initialize an array used by subsequent logic.
    let rows: string[] = [];
    // Bind error for use in the following logic.
    let error: string | null = null;

    // Bind run for use in the following logic.
    const run = async (gen: number, label: string, delayMs: number) => {
      // Wait for an async operation before continuing.
      await new Promise((r) => setTimeout(r, delayMs));
      // Conditional branch for the case described by this guard.
      if (!shouldApplyAuditRefresh(gen, currentGen)) return;
      // Pass rows prop/value into the element or config.
      rows = [label];
      // Support the surrounding logic for this step.
      error = null;
    };

    // Bind a for use in the following logic.
    const a = run(++currentGen, "old-filter", 30);
    // Bind b for use in the following logic.
    const b = run(++currentGen, "new-filter", 5);
    // Wait for an async operation before continuing.
    await Promise.all([a, b]);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(rows, ["new-filter"]);
    // Invoke assert.equal to perform this step.
    assert.equal(error, null);
  });
});

// Group related tests under a shared suite name.
describe("independent section settlement", () => {
  // Define a single test case and its expectation.
  it("keeps audit rows when jobs fail", async () => {
    // Bind events for use in the following logic.
    const events = await settleAuditFetch(Promise.resolve([{ id: "e1" }]));
    // Bind jobs for use in the following logic.
    const jobs = await settleAuditFetch(Promise.reject(new Error("jobs 403")));
    // Bind combined for use in the following logic.
    const combined = combineAuditLoadResults({
      // Support the surrounding logic for this step.
      events,
      // Support the surrounding logic for this step.
      jobs,
      // Provide eventsFallback field used by this structure.
      eventsFallback: "audit failed",
      // Provide jobsFallback field used by this structure.
      jobsFallback: "jobs failed",
    });
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(combined.events, [{ id: "e1" }]);
    // Invoke assert.equal to perform this step.
    assert.equal(combined.jobs, undefined);
    // Invoke assert.equal to perform this step.
    assert.equal(combined.anySuccess, true);
    // Invoke assert.equal to perform this step.
    assert.equal(combined.errors.length, 1);
    // Invoke assert.equal to perform this step.
    assert.equal(combined.errors[0]?.section, "jobs");
    // Invoke assert.match to perform this step.
    assert.match(combined.errors[0]!.message, /jobs 403/);
  });

  // Define a single test case and its expectation.
  it("keeps jobs when audit fails", async () => {
    // Bind events for use in the following logic.
    const events = await settleAuditFetch(Promise.reject(new Error("audit 500")));
    // Bind jobs for use in the following logic.
    const jobs = await settleAuditFetch(Promise.resolve([{ id: "j1" }]));
    // Bind combined for use in the following logic.
    const combined = combineAuditLoadResults({
      // Support the surrounding logic for this step.
      events,
      // Support the surrounding logic for this step.
      jobs,
      // Provide eventsFallback field used by this structure.
      eventsFallback: "audit failed",
      // Provide jobsFallback field used by this structure.
      jobsFallback: "jobs failed",
    });
    // Invoke assert.equal to perform this step.
    assert.equal(combined.events, undefined);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(combined.jobs, [{ id: "j1" }]);
    // Invoke assert.equal to perform this step.
    assert.equal(combined.anySuccess, true);
    // Invoke assert.match to perform this step.
    assert.match(formatAuditLoadErrors(combined.errors, "en") ?? "", /Events: audit 500/);
  });

  // Define a single test case and its expectation.
  it("clears banner path when both succeed", async () => {
    // Bind combined for use in the following logic.
    const combined = combineAuditLoadResults({
      // Provide events field used by this structure.
      events: await settleAuditFetch(Promise.resolve([])),
      // Provide jobs field used by this structure.
      jobs: await settleAuditFetch(Promise.resolve([])),
      // Provide eventsFallback field used by this structure.
      eventsFallback: "audit failed",
      // Provide jobsFallback field used by this structure.
      jobsFallback: "jobs failed",
    });
    // Invoke assert.equal to perform this step.
    assert.equal(formatAuditLoadErrors(combined.errors, "bg"), null);
  });

  // Define a single test case and its expectation.
  it("manual refresh recovery: prior error then success yields empty errors", async () => {
    // Bind banner for use in the following logic.
    let banner: string | null = "Events: offline";
    // Bind failed for use in the following logic.
    const failed = combineAuditLoadResults({
      // Provide events field used by this structure.
      events: await settleAuditFetch(Promise.reject(new Error("offline"))),
      // Provide jobs field used by this structure.
      jobs: null,
      // Provide eventsFallback field used by this structure.
      eventsFallback: "audit failed",
      // Provide jobsFallback field used by this structure.
      jobsFallback: "jobs failed",
    });
    // Support the surrounding logic for this step.
    banner = formatAuditLoadErrors(failed.errors, "en");
    // Invoke assert.match to perform this step.
    assert.match(banner ?? "", /offline/);

    // Bind recovered for use in the following logic.
    const recovered = combineAuditLoadResults({
      // Provide events field used by this structure.
      events: await settleAuditFetch(Promise.resolve([{ id: "ok" }])),
      // Provide jobs field used by this structure.
      jobs: null,
      // Provide eventsFallback field used by this structure.
      eventsFallback: "audit failed",
      // Provide jobsFallback field used by this structure.
      jobsFallback: "jobs failed",
    });
    // Support the surrounding logic for this step.
    banner = formatAuditLoadErrors(recovered.errors, "en");
    // Invoke assert.equal to perform this step.
    assert.equal(banner, null);
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(recovered.events, [{ id: "ok" }]);
  });
});

// Group related tests under a shared suite name.
describe("events stale / clear on failure", () => {
  // Define a single test case and its expectation.
  it("clears rows on initial events failure", () => {
    // Bind decision for use in the following logic.
    const decision = resolveEventsTableAfterLoad({
      // Provide initial field used by this structure.
      initial: true,
      // Provide eventsFailed field used by this structure.
      eventsFailed: true,
      // Provide nextEvents field used by this structure.
      nextEvents: undefined,
    });
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(decision.rows, []);
    // Invoke assert.equal to perform this step.
    assert.equal(decision.stale, false);
  });

  // Define a single test case and its expectation.
  it("keeps rows and marks stale on soft-refresh events failure", () => {
    // Bind decision for use in the following logic.
    const decision = resolveEventsTableAfterLoad({
      // Provide initial field used by this structure.
      initial: false,
      // Provide eventsFailed field used by this structure.
      eventsFailed: true,
      // Provide nextEvents field used by this structure.
      nextEvents: undefined,
    });
    // Invoke assert.equal to perform this step.
    assert.equal(decision.rows, "keep");
    // Invoke assert.equal to perform this step.
    assert.equal(decision.stale, true);
  });

  // Define a single test case and its expectation.
  it("does not clear events when only jobs fail", async () => {
    // Bind combined for use in the following logic.
    const combined = combineAuditLoadResults({
      // Provide events field used by this structure.
      events: await settleAuditFetch(Promise.resolve([{ id: "e1" }])),
      // Provide jobs field used by this structure.
      jobs: await settleAuditFetch(Promise.reject(new Error("jobs down"))),
      // Provide eventsFallback field used by this structure.
      eventsFallback: "audit failed",
      // Provide jobsFallback field used by this structure.
      jobsFallback: "jobs failed",
    });
    // Invoke assert.equal to perform this step.
    assert.equal(combined.eventsFailed, false);
    // Bind decision for use in the following logic.
    const decision = resolveEventsTableAfterLoad({
      // Provide initial field used by this structure.
      initial: false,
      // Provide eventsFailed field used by this structure.
      eventsFailed: combined.eventsFailed,
      // Provide nextEvents field used by this structure.
      nextEvents: combined.events,
    });
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(decision.rows, [{ id: "e1" }]);
    // Invoke assert.equal to perform this step.
    assert.equal(decision.stale, false);
    // Invoke assert.match to perform this step.
    assert.match(
      // Invoke formatAuditLoadErrors to perform this step.
      formatAuditLoadErrors(combined.errors, "en") ?? "",
      // Support the surrounding logic for this step.
      /Background tasks/,
    );
  });

  // Define a single test case and its expectation.
  it("banner mentions previous events when stale", () => {
    // Bind banner for use in the following logic.
    const banner = formatAuditLoadErrors(
      // Support the surrounding logic for this step.
      [{ section: "events", message: "offline" }],
      // Support the surrounding logic for this step.
      "en",
      // Support the surrounding logic for this step.
      { eventsStale: true },
    );
    // Invoke assert.match to perform this step.
    assert.match(banner ?? "", /previous events/i);
  });
});

// Group related tests under a shared suite name.
describe("related identity", () => {
  // Define a single test case and its expectation.
  it("distinguishes two SLA rows with identical status/dueAt via location and title", () => {
    // Bind label for use in the following logic.
    const label = (type: string) => (type === "maintenance_ticket" ? "Ticket" : type);
    // Bind a for use in the following logic.
    const a = formatAuditRelated(
      {
        // Provide entityType field used by this structure.
        entityType: "maintenance_ticket",
        // Provide entityId field used by this structure.
        entityId: "aaaaaaaa-1111-1111-1111-111111111111",
        // Provide after field used by this structure.
        after: { status: "new", dueAt: "2026-01-01", locationNumber: "101", title: "AC" },
      },
      // Support the surrounding logic for this step.
      label,
      // Support the surrounding logic for this step.
      "en",
    );
    // Bind b for use in the following logic.
    const b = formatAuditRelated(
      {
        // Provide entityType field used by this structure.
        entityType: "maintenance_ticket",
        // Provide entityId field used by this structure.
        entityId: "bbbbbbbb-2222-2222-2222-222222222222",
        // Provide after field used by this structure.
        after: { status: "new", dueAt: "2026-01-01", locationNumber: "202", title: "Leak" },
      },
      // Support the surrounding logic for this step.
      label,
      // Support the surrounding logic for this step.
      "en",
    );
    // Invoke assert.notEqual to perform this step.
    assert.notEqual(a, b);
    // Invoke assert.match to perform this step.
    assert.match(a, /101/);
    // Invoke assert.match to perform this step.
    assert.match(a, /AC/);
    // Invoke assert.match to perform this step.
    assert.match(b, /202/);
    // Invoke assert.match to perform this step.
    assert.match(b, /Leak/);
  });

  // Define a single test case and its expectation.
  it("falls back to short entity id when after has no room/title", () => {
    // Bind text for use in the following logic.
    const text = formatAuditRelated(
      {
        // Provide entityType field used by this structure.
        entityType: "ticket",
        // Provide entityId field used by this structure.
        entityId: "abcdef12-3456-7890-abcd-ef1234567890",
        // Provide after field used by this structure.
        after: { status: "new" },
      },
      // Support the surrounding logic for this step.
      () => "Ticket",
      // Support the surrounding logic for this step.
      "en",
    );
    // Invoke assert.match to perform this step.
    assert.match(text, /#abcdef12/);
  });
});
