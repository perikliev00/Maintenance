/**
 * Guard: every known live audit producer action must stay listed here so
 * frontend filter sync tests have a stable checklist.
 */
import assert from "node:assert/strict";
// Node test runner (describe/it/hooks).
import { describe, it } from "node:test";
// Runtime import from ./audit.producers.
import { KNOWN_AUDIT_PRODUCER_ACTIONS } from "./audit.producers";

// Test suite: KNOWN_AUDIT_PRODUCER_ACTIONS.
describe("KNOWN_AUDIT_PRODUCER_ACTIONS", () => {
  // Test case: includes SLA, overdue, sector.save, and people lifecycle producers.
  it("includes SLA, overdue, sector.save, and people lifecycle producers", () => {
    // Set set for dedupe/membership.
    const set = new Set<string>(KNOWN_AUDIT_PRODUCER_ACTIONS);
    // Iterate items for aggregation or writes.
    for (const action of [
      "ticket.sla_breach",
      "session.overdue_detected",
      "sector.save",
      "people.block",
      "device.revoke",
      "permission.grant",
    // Support the surrounding control flow.
    ]) {
      // Require truthy condition.
      assert.ok(set.has(action), `missing producer action: ${action}`);
    }
  });

  // Test case: has no duplicates.
  it("has no duplicates", () => {
    // Compare scalar values.
    assert.equal(
      // Support the surrounding control flow.
      KNOWN_AUDIT_PRODUCER_ACTIONS.length,
      // Support the surrounding control flow.
      new Set(KNOWN_AUDIT_PRODUCER_ACTIONS).size,
    );
  });
});
