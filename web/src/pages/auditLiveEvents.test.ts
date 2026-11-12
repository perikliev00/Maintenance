/**
 * Contract: Audit page live subscription must include location + jobs .
 */
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency from ./auditPageLogic.
import { AUDIT_PAGE_LIVE_EVENTS } from "./auditPageLogic";

// Group related tests under a shared suite name.
describe("AuditPage live event contract", () => {
  // Define a single test case and its expectation.
  it("subscribes to location.changed for room mutations", () => {
    // Invoke assert.ok to perform this step.
    assert.ok(AUDIT_PAGE_LIVE_EVENTS.includes("location.changed"));
  });

  // Define a single test case and its expectation.
  it("subscribes to jobs.changed for background run completion", () => {
    // Invoke assert.ok to perform this step.
    assert.ok(AUDIT_PAGE_LIVE_EVENTS.includes("jobs.changed"));
  });

  // Define a single test case and its expectation.
  it("subscribes to permissions.changed for grant matrix updates", () => {
    // Invoke assert.ok to perform this step.
    assert.ok(AUDIT_PAGE_LIVE_EVENTS.includes("permissions.changed"));
  });
});
