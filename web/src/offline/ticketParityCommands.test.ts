/**
 * assign/close/reopen command builders for offline outbox.
 */
import assert from "node:assert/strict";
// Import dependency used by this module.
import { describe, it } from "node:test";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  assignTicketQueued,
  // List item in import/export/params.
  closeTicketQueued,
  // List item in import/export/params.
  reopenTicketQueued,
  // Local type alias shaping data.
  type RunOrEnqueue,
// Close multi-line construct with trailing syntax.
} from "./commands";

// Group related unit tests.
describe("ticket assign/close/reopen command builders (B4)", () => {
  // Unit test case.
  it("builds ticket.assign with assigneeId and REST assign URL", async () => {
    // Mutable local binding.
    let seen: {
      // Field/property in this shape.
      type: string;
      // Field/property in this shape.
      url: string;
      // Field/property in this shape.
      body: Record<string, unknown>;
    // Assign value for subsequent use.
    } | null = null;
    // Local constant binding.
    const run: RunOrEnqueue = async (type, url, body) => {
      // Assign value for subsequent use.
      seen = { type, url, body };
      // Return computed result to caller.
      return { queued: true };
    };
    // Await async work before continuing.
    await assignTicketQueued("t-1", "emp-9", run);
    // Assert expected test outcome.
    assert.equal(seen!.type, "ticket.assign");
    // Assert expected test outcome.
    assert.match(seen!.url, /\/maintenance\/tickets\/t-1\/assign$/);
    // Assert expected test outcome.
    assert.equal(seen!.body.assigneeId, "emp-9");
    // Assert expected test outcome.
    assert.equal(typeof seen!.body.commandId, "string");
  });

  // Unit test case.
  it("builds ticket.close with close URL", async () => {
    // Mutable local binding.
    let seen: { type: string; url: string } | null = null;
    // Local constant binding.
    const run: RunOrEnqueue = async (type, url) => {
      // Assign value for subsequent use.
      seen = { type, url };
      // Return computed result to caller.
      return { queued: true };
    };
    // Await async work before continuing.
    await closeTicketQueued("t-2", run);
    // Assert expected test outcome.
    assert.equal(seen!.type, "ticket.close");
    // Assert expected test outcome.
    assert.match(seen!.url, /\/maintenance\/tickets\/t-2\/close$/);
  });

  // Unit test case.
  it("builds ticket.reopen and omits empty reason", async () => {
    // Mutable local binding.
    let seen: { type: string; body: Record<string, unknown> } | null = null;
    // Local constant binding.
    const run: RunOrEnqueue = async (type, _url, body) => {
      // Assign value for subsequent use.
      seen = { type, body };
      // Return computed result to caller.
      return { queued: true };
    };
    // Await async work before continuing.
    await reopenTicketQueued("t-3", "  ", run);
    // Assert expected test outcome.
    assert.equal(seen!.type, "ticket.reopen");
    // Assert expected test outcome.
    assert.equal(seen!.body.reason, undefined);
    // Await async work before continuing.
    await reopenTicketQueued("t-3", "fixed again", run);
    // Assert expected test outcome.
    assert.equal(seen!.body.reason, "fixed again");
  });
});
