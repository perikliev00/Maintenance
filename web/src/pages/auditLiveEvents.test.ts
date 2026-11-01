/**
 * Contract: Audit page live subscription must include location + jobs (BUG-06/07).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AUDIT_PAGE_LIVE_EVENTS } from "./auditPageLogic";

describe("BUG-06 / BUG-07 / NEW-03 AuditPage live event contract", () => {
  it("subscribes to location.changed for room mutations", () => {
    assert.ok(AUDIT_PAGE_LIVE_EVENTS.includes("location.changed"));
  });

  it("subscribes to jobs.changed for background run completion", () => {
    assert.ok(AUDIT_PAGE_LIVE_EVENTS.includes("jobs.changed"));
  });

  it("subscribes to permissions.changed for grant matrix updates", () => {
    assert.ok(AUDIT_PAGE_LIVE_EVENTS.includes("permissions.changed"));
  });
});
