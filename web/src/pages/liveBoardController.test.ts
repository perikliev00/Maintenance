/**
 * Characterization for live-board controller orchestration seams
 * (view phases, SSE wiring, stale clock, refresh races, attention pagination,
 * complete→refresh UX). Pure + source-structure — no React renderer.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  LiveNeedsAttention,
  OperationsLive,
} from "../api/operationsLiveApi";
import {
  applyRefreshResult,
  beginRefreshFlight,
  completeThenRefreshOutcome,
  deriveLiveConnAfterTick,
  filterLiveNeeds,
  filterLiveSessions,
  invalidateRefreshOnUnmount,
  LIVE_BOARD_STALE_MS,
  liveBoardViewPhase,
  mergeAttentionPage,
  shouldShowLiveConnBanner,
} from "./liveBoardLogic";

const here = path.dirname(fileURLToPath(import.meta.url));

function loc(id: string, kind: string = "room") {
  return {
    id,
    number: id,
    kind,
    buildingCode: "A",
    floor: 1,
  };
}

function need(
  kind: LiveNeedsAttention["kind"],
  id: string,
): LiveNeedsAttention {
  return {
    kind,
    id,
    title: id,
    location: loc(`L-${id}`),
    employee: null,
    dueAt: null,
    priority: null,
    status: "open",
  };
}

function emptyBoard(overrides: Partial<OperationsLive> = {}): OperationsLive {
  return {
    updatedAt: "2026-11-02T12:00:00.000Z",
    overdueThresholdMinutes: 240,
    anomalyThresholdMinutes: 480,
    activeSessions: [],
    recentlyCompleted: [],
    needsAttention: [],
    attention: {
      awaitingInspection: {
        total: 0,
        returned: 0,
        hasMore: false,
        nextCursor: null,
      },
      pastDue: { total: 0, returned: 0, hasMore: false, nextCursor: null },
      blockingTickets: {
        total: 0,
        returned: 0,
        hasMore: false,
        nextCursor: null,
      },
    },
    auditFeed: [],
    counts: {
      active: 0,
      overdue: 0,
      anomalies: 0,
      awaitingInspection: 0,
      blockingTickets: 0,
    },
    ...overrides,
  };
}

describe("liveBoard view phases (loading / empty / error / ready)", () => {
  it("first load shows loading until data arrives", () => {
    assert.equal(
      liveBoardViewPhase({ loading: true, data: null, error: null }),
      "loading",
    );
  });

  it("failed first load is error; empty ready board is empty", () => {
    assert.equal(
      liveBoardViewPhase({
        loading: false,
        data: null,
        error: "Failed to load live board",
      }),
      "error",
    );
    assert.equal(
      liveBoardViewPhase({ loading: false, data: null, error: null }),
      "empty",
    );
  });

  it("refresh failure keeps prior data as error_with_data", () => {
    const data = emptyBoard();
    assert.equal(
      liveBoardViewPhase({
        loading: false,
        data,
        error: "Failed to load live board",
      }),
      "error_with_data",
    );
    assert.equal(
      liveBoardViewPhase({ loading: false, data, error: null }),
      "ready",
    );
  });

  it("offline banner hidden only during first in-flight load", () => {
    assert.equal(
      shouldShowLiveConnBanner({
        conn: "offline",
        loading: true,
        data: null,
      }),
      false,
    );
    assert.equal(
      shouldShowLiveConnBanner({
        conn: "offline",
        loading: false,
        data: null,
      }),
      true,
    );
    assert.equal(
      shouldShowLiveConnBanner({
        conn: "stale",
        loading: false,
        data: emptyBoard(),
      }),
      true,
    );
  });
});

describe("stale detection (fake clock)", () => {
  it("stays live until STALE_MS after last success, then flips stale", () => {
    const t0 = 1_000_000;
    assert.equal(
      deriveLiveConnAfterTick({
        conn: "live",
        lastSuccessAt: t0,
        now: t0 + LIVE_BOARD_STALE_MS,
      }),
      "live",
    );
    assert.equal(
      deriveLiveConnAfterTick({
        conn: "live",
        lastSuccessAt: t0,
        now: t0 + LIVE_BOARD_STALE_MS + 1,
      }),
      "stale",
    );
  });

  it("offline is sticky; missing lastSuccessAt does not invent stale", () => {
    assert.equal(
      deriveLiveConnAfterTick({
        conn: "offline",
        lastSuccessAt: 1,
        now: 1 + LIVE_BOARD_STALE_MS * 10,
      }),
      "offline",
    );
    assert.equal(
      deriveLiveConnAfterTick({
        conn: "live",
        lastSuccessAt: null,
        now: 99_999,
      }),
      "live",
    );
  });
});

describe("category filter + attention pagination", () => {
  const sessions = [
    { sessionId: "a", overdue: false, anomaly: false, elapsedMinutes: 10 },
    { sessionId: "b", overdue: true, anomaly: false, elapsedMinutes: 250 },
    { sessionId: "c", overdue: true, anomaly: true, elapsedMinutes: 500 },
  ];
  const needs = [
    need("awaiting_inspection", "i1"),
    need("past_due", "p1"),
    need("blocking_ticket", "t1"),
  ];

  it("filters sessions and clears attention for active/anomaly cards", () => {
    assert.deepEqual(
      filterLiveSessions(sessions, "active").map((s) => s.sessionId),
      ["a"],
    );
    assert.deepEqual(
      filterLiveSessions(sessions, "overdue").map((s) => s.sessionId),
      ["b", "c"],
    );
    assert.deepEqual(
      filterLiveSessions(sessions, "anomaly").map((s) => s.sessionId),
      ["c"],
    );
    assert.equal(filterLiveNeeds(needs, "active").length, 0);
    assert.equal(filterLiveNeeds(needs, "anomaly").length, 0);
  });

  it("overdue card filters past_due attention; inspection/blocking isolate kinds", () => {
    assert.deepEqual(
      filterLiveNeeds(needs, "overdue").map((n) => n.id),
      ["p1"],
    );
    assert.deepEqual(
      filterLiveNeeds(needs, "inspection").map((n) => n.id),
      ["i1"],
    );
    assert.deepEqual(
      filterLiveNeeds(needs, "blocking").map((n) => n.id),
      ["t1"],
    );
  });

  it("load-more merges pages, dedupes, and advances cursor after filter context", () => {
    const board = emptyBoard({
      needsAttention: [need("awaiting_inspection", "i1")],
      attention: {
        awaitingInspection: {
          total: 3,
          returned: 1,
          hasMore: true,
          nextCursor: "c1",
        },
        pastDue: { total: 0, returned: 0, hasMore: false, nextCursor: null },
        blockingTickets: {
          total: 0,
          returned: 0,
          hasMore: false,
          nextCursor: null,
        },
      },
    });
    // Filtered view still paginates the underlying attention bucket.
    assert.deepEqual(
      filterLiveNeeds(board.needsAttention, "inspection").map((n) => n.id),
      ["i1"],
    );
    const next = mergeAttentionPage(board, "awaiting_inspection", {
      kind: "awaiting_inspection",
      items: [
        need("awaiting_inspection", "i1"), // duplicate
        need("awaiting_inspection", "i2"),
      ],
      total: 3,
      returned: 2,
      hasMore: true,
      nextCursor: "c2",
    });
    assert.deepEqual(
      next.needsAttention.map((n) => n.id),
      ["i1", "i2"],
    );
    assert.deepEqual(next.attention?.awaitingInspection, {
      total: 3,
      returned: 3,
      hasMore: true,
      nextCursor: "c2",
    });
    assert.deepEqual(
      filterLiveNeeds(next.needsAttention, "inspection").map((n) => n.id),
      ["i1", "i2"],
    );
  });
});

describe("overlapping refresh / unmount / out-of-order", () => {
  it("coalesces non-force onto in-flight; force aborts and bumps gen", () => {
    let state = {
      currentGen: 0,
      inFlight: null as ReturnType<typeof beginRefreshFlight> extends {
        flight: infer F;
      }
        ? F | null
        : never,
    };
    const first = beginRefreshFlight(state, {});
    assert.equal("coalesced" in first, false);
    if ("coalesced" in first) throw new Error("unreachable");
    state = first.state;

    const joined = beginRefreshFlight(state, {});
    assert.equal("coalesced" in joined, true);
    if (!("coalesced" in joined)) throw new Error("unreachable");
    assert.equal(joined.flight.gen, first.flight.gen);

    const forced = beginRefreshFlight(state, { force: true });
    assert.equal("coalesced" in forced, false);
    if ("coalesced" in forced) throw new Error("unreachable");
    assert.equal(first.flight.aborted, true);
    assert.equal(forced.flight.gen, first.flight.gen + 1);
    assert.equal(
      applyRefreshResult(first.flight, forced.state.currentGen),
      false,
    );
    assert.equal(
      applyRefreshResult(forced.flight, forced.state.currentGen),
      true,
    );
  });

  it("unmount invalidates so a late response cannot apply", () => {
    let state = {
      currentGen: 0,
      inFlight: null as {
        gen: number;
        aborted: boolean;
      } | null,
    };
    const started = beginRefreshFlight(state, {});
    if ("coalesced" in started) throw new Error("unreachable");
    state = started.state;
    const afterUnmount = invalidateRefreshOnUnmount(state);
    assert.equal(started.flight.aborted, true);
    assert.equal(afterUnmount.currentGen, started.flight.gen + 1);
    assert.equal(
      applyRefreshResult(started.flight, afterUnmount.currentGen),
      false,
    );
  });

  it("late stale GET after forced post-mutation refresh is dropped", () => {
    let state = {
      currentGen: 0,
      inFlight: null as { gen: number; aborted: boolean } | null,
    };
    const stale = beginRefreshFlight(state, {});
    if ("coalesced" in stale) throw new Error("unreachable");
    state = stale.state;
    const fresh = beginRefreshFlight(state, { force: true });
    if ("coalesced" in fresh) throw new Error("unreachable");
    state = fresh.state;
    assert.equal(applyRefreshResult(fresh.flight, state.currentGen), true);
    assert.equal(applyRefreshResult(stale.flight, state.currentGen), false);
  });
});

describe("mutation pending + refresh failure UX", () => {
  it("complete ok + refresh fail keeps success message and surfaces error", () => {
    assert.deepEqual(
      completeThenRefreshOutcome({
        completeOk: true,
        refreshOk: false,
        refreshError: "network",
      }),
      { message: "Session completed", error: "network" },
    );
  });

  it("complete fail does not claim session completed", () => {
    assert.deepEqual(
      completeThenRefreshOutcome({
        completeOk: false,
        refreshOk: false,
        completeError: "forbidden",
      }),
      { message: null, error: "forbidden" },
    );
  });
});

describe("controller wiring (structure)", () => {
  const src = readFileSync(
    path.join(here, "useLiveBoardController.ts"),
    "utf8",
  );

  it("subscribes via useLiveRefresh to domain change events", () => {
    assert.match(src, /useLiveRefresh\(/);
    assert.match(src, /"location\.changed"/);
    assert.match(src, /"cleaning\.changed"/);
    assert.match(src, /"ticket\.changed"/);
    assert.match(src, /"settings\.changed"/);
    assert.match(src, /enabled:\s*!loading/);
    assert.match(src, /busy:\s*busyIds\.size\s*>\s*0/);
  });

  it("mount refresh + unmount aborts and bumps generation", () => {
    assert.match(src, /void refresh\(\{\s*silent:\s*false\s*\}\)/);
    assert.match(src, /refreshGen\.current\s*\+=\s*1/);
    assert.match(src, /abortRef\.current\?\.abort\(\)/);
  });

  it("uses shared pure helpers for filters, merge, stale, attention actions", () => {
    assert.match(src, /filterLiveSessions/);
    assert.match(src, /filterLiveNeeds/);
    assert.match(src, /mergeAttentionPage/);
    assert.match(src, /deriveLiveConnAfterTick/);
    assert.match(src, /attentionActionLabel/);
    assert.match(src, /attentionDestinationPanel/);
  });
});
