/**
 * Regression coverage for Audit page load races and partial failures .
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  combineAuditLoadResults,
  formatAuditLoadErrors,
  formatAuditRelated,
  resolveEventsTableAfterLoad,
  settleAuditFetch,
  shouldApplyAuditRefresh,
} from "./auditPageLogic";

describe("stale refresh generation", () => {
  it("rejects older generations", () => {
    assert.equal(shouldApplyAuditRefresh(3, 4), false);
    assert.equal(shouldApplyAuditRefresh(4, 4), true);
  });

  it("late stale success must not apply after a newer filter load", async () => {
    let currentGen = 0;
    let rows: string[] = [];
    let error: string | null = null;

    const run = async (gen: number, label: string, delayMs: number) => {
      await new Promise((r) => setTimeout(r, delayMs));
      if (!shouldApplyAuditRefresh(gen, currentGen)) return;
      rows = [label];
      error = null;
    };

    const a = run(++currentGen, "old-filter", 30);
    const b = run(++currentGen, "new-filter", 5);
    await Promise.all([a, b]);
    assert.deepEqual(rows, ["new-filter"]);
    assert.equal(error, null);
  });
});

describe("independent section settlement", () => {
  it("keeps audit rows when jobs fail", async () => {
    const events = await settleAuditFetch(Promise.resolve([{ id: "e1" }]));
    const jobs = await settleAuditFetch(Promise.reject(new Error("jobs 403")));
    const combined = combineAuditLoadResults({
      events,
      jobs,
      eventsFallback: "audit failed",
      jobsFallback: "jobs failed",
    });
    assert.deepEqual(combined.events, [{ id: "e1" }]);
    assert.equal(combined.jobs, undefined);
    assert.equal(combined.anySuccess, true);
    assert.equal(combined.errors.length, 1);
    assert.equal(combined.errors[0]?.section, "jobs");
    assert.match(combined.errors[0]!.message, /jobs 403/);
  });

  it("keeps jobs when audit fails", async () => {
    const events = await settleAuditFetch(Promise.reject(new Error("audit 500")));
    const jobs = await settleAuditFetch(Promise.resolve([{ id: "j1" }]));
    const combined = combineAuditLoadResults({
      events,
      jobs,
      eventsFallback: "audit failed",
      jobsFallback: "jobs failed",
    });
    assert.equal(combined.events, undefined);
    assert.deepEqual(combined.jobs, [{ id: "j1" }]);
    assert.equal(combined.anySuccess, true);
    assert.match(formatAuditLoadErrors(combined.errors, "en") ?? "", /Events: audit 500/);
  });

  it("clears banner path when both succeed", async () => {
    const combined = combineAuditLoadResults({
      events: await settleAuditFetch(Promise.resolve([])),
      jobs: await settleAuditFetch(Promise.resolve([])),
      eventsFallback: "audit failed",
      jobsFallback: "jobs failed",
    });
    assert.equal(formatAuditLoadErrors(combined.errors, "bg"), null);
  });

  it("manual refresh recovery: prior error then success yields empty errors", async () => {
    let banner: string | null = "Events: offline";
    const failed = combineAuditLoadResults({
      events: await settleAuditFetch(Promise.reject(new Error("offline"))),
      jobs: null,
      eventsFallback: "audit failed",
      jobsFallback: "jobs failed",
    });
    banner = formatAuditLoadErrors(failed.errors, "en");
    assert.match(banner ?? "", /offline/);

    const recovered = combineAuditLoadResults({
      events: await settleAuditFetch(Promise.resolve([{ id: "ok" }])),
      jobs: null,
      eventsFallback: "audit failed",
      jobsFallback: "jobs failed",
    });
    banner = formatAuditLoadErrors(recovered.errors, "en");
    assert.equal(banner, null);
    assert.deepEqual(recovered.events, [{ id: "ok" }]);
  });
});

describe("events stale / clear on failure", () => {
  it("clears rows on initial events failure", () => {
    const decision = resolveEventsTableAfterLoad({
      initial: true,
      eventsFailed: true,
      nextEvents: undefined,
    });
    assert.deepEqual(decision.rows, []);
    assert.equal(decision.stale, false);
  });

  it("keeps rows and marks stale on soft-refresh events failure", () => {
    const decision = resolveEventsTableAfterLoad({
      initial: false,
      eventsFailed: true,
      nextEvents: undefined,
    });
    assert.equal(decision.rows, "keep");
    assert.equal(decision.stale, true);
  });

  it("does not clear events when only jobs fail", async () => {
    const combined = combineAuditLoadResults({
      events: await settleAuditFetch(Promise.resolve([{ id: "e1" }])),
      jobs: await settleAuditFetch(Promise.reject(new Error("jobs down"))),
      eventsFallback: "audit failed",
      jobsFallback: "jobs failed",
    });
    assert.equal(combined.eventsFailed, false);
    const decision = resolveEventsTableAfterLoad({
      initial: false,
      eventsFailed: combined.eventsFailed,
      nextEvents: combined.events,
    });
    assert.deepEqual(decision.rows, [{ id: "e1" }]);
    assert.equal(decision.stale, false);
    assert.match(
      formatAuditLoadErrors(combined.errors, "en") ?? "",
      /Background tasks/,
    );
  });

  it("banner mentions previous events when stale", () => {
    const banner = formatAuditLoadErrors(
      [{ section: "events", message: "offline" }],
      "en",
      { eventsStale: true },
    );
    assert.match(banner ?? "", /previous events/i);
  });
});

describe("related identity", () => {
  it("distinguishes two SLA rows with identical status/dueAt via location and title", () => {
    const label = (type: string) => (type === "maintenance_ticket" ? "Ticket" : type);
    const a = formatAuditRelated(
      {
        entityType: "maintenance_ticket",
        entityId: "aaaaaaaa-1111-1111-1111-111111111111",
        after: { status: "new", dueAt: "2026-01-01", locationNumber: "101", title: "AC" },
      },
      label,
      "en",
    );
    const b = formatAuditRelated(
      {
        entityType: "maintenance_ticket",
        entityId: "bbbbbbbb-2222-2222-2222-222222222222",
        after: { status: "new", dueAt: "2026-01-01", locationNumber: "202", title: "Leak" },
      },
      label,
      "en",
    );
    assert.notEqual(a, b);
    assert.match(a, /101/);
    assert.match(a, /AC/);
    assert.match(b, /202/);
    assert.match(b, /Leak/);
  });

  it("falls back to short entity id when after has no room/title", () => {
    const text = formatAuditRelated(
      {
        entityType: "ticket",
        entityId: "abcdef12-3456-7890-abcd-ef1234567890",
        after: { status: "new" },
      },
      () => "Ticket",
      "en",
    );
    assert.match(text, /#abcdef12/);
  });
});
