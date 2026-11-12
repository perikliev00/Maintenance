/**
 * Guard: every known live audit producer action must stay listed here so
 * frontend filter sync tests have a stable checklist.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KNOWN_AUDIT_PRODUCER_ACTIONS } from "./audit.producers";

describe("KNOWN_AUDIT_PRODUCER_ACTIONS", () => {
  it("includes SLA, overdue, sector.save, and people lifecycle producers", () => {
    const set = new Set<string>(KNOWN_AUDIT_PRODUCER_ACTIONS);
    for (const action of [
      "ticket.sla_breach",
      "session.overdue_detected",
      "sector.save",
      "people.block",
      "device.revoke",
      "permission.grant",
    ]) {
      assert.ok(set.has(action), `missing producer action: ${action}`);
    }
  });

  it("has no duplicates", () => {
    assert.equal(
      KNOWN_AUDIT_PRODUCER_ACTIONS.length,
      new Set(KNOWN_AUDIT_PRODUCER_ACTIONS).size,
    );
  });
});
