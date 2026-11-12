/**
 * Contract: Audit page live subscription must include location + jobs .
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AUDIT_PAGE_LIVE_EVENTS } from "./auditPageLogic";

describe("AuditPage live event contract", () => {
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
