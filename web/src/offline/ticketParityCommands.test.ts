/**
 * assign/close/reopen command builders for offline outbox.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignTicketQueued,
  closeTicketQueued,
  reopenTicketQueued,
  type RunOrEnqueue,
} from "./commands";

describe("ticket assign/close/reopen command builders (B4)", () => {
  it("builds ticket.assign with assigneeId and REST assign URL", async () => {
    let seen: {
      type: string;
      url: string;
      body: Record<string, unknown>;
    } | null = null;
    const run: RunOrEnqueue = async (type, url, body) => {
      seen = { type, url, body };
      return { queued: true };
    };
    await assignTicketQueued("t-1", "emp-9", run);
    assert.equal(seen!.type, "ticket.assign");
    assert.match(seen!.url, /\/maintenance\/tickets\/t-1\/assign$/);
    assert.equal(seen!.body.assigneeId, "emp-9");
    assert.equal(typeof seen!.body.commandId, "string");
  });

  it("builds ticket.close with close URL", async () => {
    let seen: { type: string; url: string } | null = null;
    const run: RunOrEnqueue = async (type, url) => {
      seen = { type, url };
      return { queued: true };
    };
    await closeTicketQueued("t-2", run);
    assert.equal(seen!.type, "ticket.close");
    assert.match(seen!.url, /\/maintenance\/tickets\/t-2\/close$/);
  });

  it("builds ticket.reopen and omits empty reason", async () => {
    let seen: { type: string; body: Record<string, unknown> } | null = null;
    const run: RunOrEnqueue = async (type, _url, body) => {
      seen = { type, body };
      return { queued: true };
    };
    await reopenTicketQueued("t-3", "  ", run);
    assert.equal(seen!.type, "ticket.reopen");
    assert.equal(seen!.body.reason, undefined);
    await reopenTicketQueued("t-3", "fixed again", run);
    assert.equal(seen!.body.reason, "fixed again");
  });
});
