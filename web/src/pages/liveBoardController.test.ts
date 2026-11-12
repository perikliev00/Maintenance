/**
 * Characterization for live-board controller orchestration seams
 * (view phases, SSE wiring, stale clock, refresh races, attention pagination,
 * complete→refresh UX). Pure + source-structure — no React renderer.
 */
import assert from "node:assert/strict";
// Import module dependency from node:fs.
import { readFileSync } from "node:fs";
// Import module dependency from node:path.
import path from "node:path";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency from node:url.
import { fileURLToPath } from "node:url";
// Import type-only dependency for typing without runtime cost.
import type {
  // Support the surrounding logic for this step.
  LiveNeedsAttention,
  // Support the surrounding logic for this step.
  OperationsLive,
// Support the surrounding logic for this step.
} from "../api/operationsLiveApi";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  applyRefreshResult,
  // Support the surrounding logic for this step.
  beginRefreshFlight,
  // Support the surrounding logic for this step.
  completeThenRefreshOutcome,
  // Support the surrounding logic for this step.
  deriveLiveConnAfterTick,
  // Support the surrounding logic for this step.
  filterLiveNeeds,
  // Support the surrounding logic for this step.
  filterLiveSessions,
  // Support the surrounding logic for this step.
  invalidateRefreshOnUnmount,
  // Support the surrounding logic for this step.
  LIVE_BOARD_STALE_MS,
  // Support the surrounding logic for this step.
  liveBoardViewPhase,
  // Support the surrounding logic for this step.
  mergeAttentionPage,
  // Support the surrounding logic for this step.
  shouldShowLiveConnBanner,
// Support the surrounding logic for this step.
} from "./liveBoardLogic";

// Bind here for use in the following logic.
const here = path.dirname(fileURLToPath(import.meta.url));

// Define function loc and its behavior.
function loc(id: string, kind: string = "room") {
  // Return early result or rendered output from this path.
  return {
    // Support the surrounding logic for this step.
    id,
    // Provide number field used by this structure.
    number: id,
    // Support the surrounding logic for this step.
    kind,
    // Provide buildingCode field used by this structure.
    buildingCode: "A",
    // Provide floor field used by this structure.
    floor: 1,
  };
}

// Define function need and its behavior.
function need(
  // Provide kind field used by this structure.
  kind: LiveNeedsAttention["kind"],
  // Provide id field used by this structure.
  id: string,
// Support the surrounding logic for this step.
): LiveNeedsAttention {
  // Return early result or rendered output from this path.
  return {
    // Support the surrounding logic for this step.
    kind,
    // Support the surrounding logic for this step.
    id,
    // Provide title field used by this structure.
    title: id,
    // Provide location field used by this structure.
    location: loc(`L-${id}`),
    // Provide employee field used by this structure.
    employee: null,
    // Provide dueAt field used by this structure.
    dueAt: null,
    // Provide priority field used by this structure.
    priority: null,
    // Provide status field used by this structure.
    status: "open",
  };
}

// Define function emptyBoard and its behavior.
function emptyBoard(overrides: Partial<OperationsLive> = {}): OperationsLive {
  // Return early result or rendered output from this path.
  return {
    // Provide updatedAt field used by this structure.
    updatedAt: "2026-11-02T12:00:00.000Z",
    // Provide overdueThresholdMinutes field used by this structure.
    overdueThresholdMinutes: 240,
    // Provide anomalyThresholdMinutes field used by this structure.
    anomalyThresholdMinutes: 480,
    // Provide activeSessions field used by this structure.
    activeSessions: [],
    // Provide recentlyCompleted field used by this structure.
    recentlyCompleted: [],
    // Provide needsAttention field used by this structure.
    needsAttention: [],
    // Provide attention field used by this structure.
    attention: {
      // Provide awaitingInspection field used by this structure.
      awaitingInspection: {
        // Provide total field used by this structure.
        total: 0,
        // Provide returned field used by this structure.
        returned: 0,
        // Provide hasMore field used by this structure.
        hasMore: false,
        // Provide nextCursor field used by this structure.
        nextCursor: null,
      },
      // Provide pastDue field used by this structure.
      pastDue: { total: 0, returned: 0, hasMore: false, nextCursor: null },
      // Provide blockingTickets field used by this structure.
      blockingTickets: {
        // Provide total field used by this structure.
        total: 0,
        // Provide returned field used by this structure.
        returned: 0,
        // Provide hasMore field used by this structure.
        hasMore: false,
        // Provide nextCursor field used by this structure.
        nextCursor: null,
      },
    },
    // Provide auditFeed field used by this structure.
    auditFeed: [],
    // Provide counts field used by this structure.
    counts: {
      // Provide active field used by this structure.
      active: 0,
      // Provide overdue field used by this structure.
      overdue: 0,
      // Provide anomalies field used by this structure.
      anomalies: 0,
      // Provide awaitingInspection field used by this structure.
      awaitingInspection: 0,
      // Provide blockingTickets field used by this structure.
      blockingTickets: 0,
    },
    // Spread prior fields/items so overrides can layer cleanly.
    ...overrides,
  };
}

// Group related tests under a shared suite name.
describe("liveBoard view phases (loading / empty / error / ready)", () => {
  // Define a single test case and its expectation.
  it("first load shows loading until data arrives", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke liveBoardViewPhase to perform this step.
      liveBoardViewPhase({ loading: true, data: null, error: null }),
      // Support the surrounding logic for this step.
      "loading",
    );
  });

  // Define a single test case and its expectation.
  it("failed first load is error; empty ready board is empty", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke liveBoardViewPhase to perform this step.
      liveBoardViewPhase({
        // Provide loading field used by this structure.
        loading: false,
        // Provide data field used by this structure.
        data: null,
        // Provide error field used by this structure.
        error: "Failed to load live board",
      }),
      // Support the surrounding logic for this step.
      "error",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke liveBoardViewPhase to perform this step.
      liveBoardViewPhase({ loading: false, data: null, error: null }),
      // Support the surrounding logic for this step.
      "empty",
    );
  });

  // Define a single test case and its expectation.
  it("refresh failure keeps prior data as error_with_data", () => {
    // Bind data for use in the following logic.
    const data = emptyBoard();
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke liveBoardViewPhase to perform this step.
      liveBoardViewPhase({
        // Provide loading field used by this structure.
        loading: false,
        // Support the surrounding logic for this step.
        data,
        // Provide error field used by this structure.
        error: "Failed to load live board",
      }),
      // Support the surrounding logic for this step.
      "error_with_data",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke liveBoardViewPhase to perform this step.
      liveBoardViewPhase({ loading: false, data, error: null }),
      // Support the surrounding logic for this step.
      "ready",
    );
  });

  // Define a single test case and its expectation.
  it("offline banner hidden only during first in-flight load", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke shouldShowLiveConnBanner to perform this step.
      shouldShowLiveConnBanner({
        // Provide conn field used by this structure.
        conn: "offline",
        // Provide loading field used by this structure.
        loading: true,
        // Provide data field used by this structure.
        data: null,
      }),
      // Support the surrounding logic for this step.
      false,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke shouldShowLiveConnBanner to perform this step.
      shouldShowLiveConnBanner({
        // Provide conn field used by this structure.
        conn: "offline",
        // Provide loading field used by this structure.
        loading: false,
        // Provide data field used by this structure.
        data: null,
      }),
      // Support the surrounding logic for this step.
      true,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke shouldShowLiveConnBanner to perform this step.
      shouldShowLiveConnBanner({
        // Provide conn field used by this structure.
        conn: "stale",
        // Provide loading field used by this structure.
        loading: false,
        // Provide data field used by this structure.
        data: emptyBoard(),
      }),
      // Support the surrounding logic for this step.
      true,
    );
  });
});

// Group related tests under a shared suite name.
describe("stale detection (fake clock)", () => {
  // Define a single test case and its expectation.
  it("stays live until STALE_MS after last success, then flips stale", () => {
    // Bind t0 for use in the following logic.
    const t0 = 1_000_000;
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke deriveLiveConnAfterTick to perform this step.
      deriveLiveConnAfterTick({
        // Provide conn field used by this structure.
        conn: "live",
        // Provide lastSuccessAt field used by this structure.
        lastSuccessAt: t0,
        // Provide now field used by this structure.
        now: t0 + LIVE_BOARD_STALE_MS,
      }),
      // Support the surrounding logic for this step.
      "live",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke deriveLiveConnAfterTick to perform this step.
      deriveLiveConnAfterTick({
        // Provide conn field used by this structure.
        conn: "live",
        // Provide lastSuccessAt field used by this structure.
        lastSuccessAt: t0,
        // Provide now field used by this structure.
        now: t0 + LIVE_BOARD_STALE_MS + 1,
      }),
      // Support the surrounding logic for this step.
      "stale",
    );
  });

  // Define a single test case and its expectation.
  it("offline is sticky; missing lastSuccessAt does not invent stale", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke deriveLiveConnAfterTick to perform this step.
      deriveLiveConnAfterTick({
        // Provide conn field used by this structure.
        conn: "offline",
        // Provide lastSuccessAt field used by this structure.
        lastSuccessAt: 1,
        // Provide now field used by this structure.
        now: 1 + LIVE_BOARD_STALE_MS * 10,
      }),
      // Support the surrounding logic for this step.
      "offline",
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke deriveLiveConnAfterTick to perform this step.
      deriveLiveConnAfterTick({
        // Provide conn field used by this structure.
        conn: "live",
        // Provide lastSuccessAt field used by this structure.
        lastSuccessAt: null,
        // Provide now field used by this structure.
        now: 99_999,
      }),
      // Support the surrounding logic for this step.
      "live",
    );
  });
});

// Group related tests under a shared suite name.
describe("category filter + attention pagination", () => {
  // Initialize an array used by subsequent logic.
  const sessions = [
    // Support the surrounding logic for this step.
    { sessionId: "a", overdue: false, anomaly: false, elapsedMinutes: 10 },
    // Support the surrounding logic for this step.
    { sessionId: "b", overdue: true, anomaly: false, elapsedMinutes: 250 },
    // Support the surrounding logic for this step.
    { sessionId: "c", overdue: true, anomaly: true, elapsedMinutes: 500 },
  ];
  // Initialize an array used by subsequent logic.
  const needs = [
    // Invoke need to perform this step.
    need("awaiting_inspection", "i1"),
    // Invoke need to perform this step.
    need("past_due", "p1"),
    // Invoke need to perform this step.
    need("blocking_ticket", "t1"),
  ];

  // Define a single test case and its expectation.
  it("filters sessions and clears attention for active/anomaly cards", () => {
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke filterLiveSessions to perform this step.
      filterLiveSessions(sessions, "active").map((s) => s.sessionId),
      // Support the surrounding logic for this step.
      ["a"],
    );
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke filterLiveSessions to perform this step.
      filterLiveSessions(sessions, "overdue").map((s) => s.sessionId),
      // Support the surrounding logic for this step.
      ["b", "c"],
    );
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke filterLiveSessions to perform this step.
      filterLiveSessions(sessions, "anomaly").map((s) => s.sessionId),
      // Support the surrounding logic for this step.
      ["c"],
    );
    // Invoke assert.equal to perform this step.
    assert.equal(filterLiveNeeds(needs, "active").length, 0);
    // Invoke assert.equal to perform this step.
    assert.equal(filterLiveNeeds(needs, "anomaly").length, 0);
  });

  // Define a single test case and its expectation.
  it("overdue card filters past_due attention; inspection/blocking isolate kinds", () => {
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke filterLiveNeeds to perform this step.
      filterLiveNeeds(needs, "overdue").map((n) => n.id),
      // Support the surrounding logic for this step.
      ["p1"],
    );
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke filterLiveNeeds to perform this step.
      filterLiveNeeds(needs, "inspection").map((n) => n.id),
      // Support the surrounding logic for this step.
      ["i1"],
    );
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke filterLiveNeeds to perform this step.
      filterLiveNeeds(needs, "blocking").map((n) => n.id),
      // Support the surrounding logic for this step.
      ["t1"],
    );
  });

  // Define a single test case and its expectation.
  it("load-more merges pages, dedupes, and advances cursor after filter context", () => {
    // Bind board for use in the following logic.
    const board = emptyBoard({
      // Provide needsAttention field used by this structure.
      needsAttention: [need("awaiting_inspection", "i1")],
      // Provide attention field used by this structure.
      attention: {
        // Provide awaitingInspection field used by this structure.
        awaitingInspection: {
          // Provide total field used by this structure.
          total: 3,
          // Provide returned field used by this structure.
          returned: 1,
          // Provide hasMore field used by this structure.
          hasMore: true,
          // Provide nextCursor field used by this structure.
          nextCursor: "c1",
        },
        // Provide pastDue field used by this structure.
        pastDue: { total: 0, returned: 0, hasMore: false, nextCursor: null },
        // Provide blockingTickets field used by this structure.
        blockingTickets: {
          // Provide total field used by this structure.
          total: 0,
          // Provide returned field used by this structure.
          returned: 0,
          // Provide hasMore field used by this structure.
          hasMore: false,
          // Provide nextCursor field used by this structure.
          nextCursor: null,
        },
      },
    });
    // Filtered view still paginates the underlying attention bucket.
    assert.deepEqual(
      // Invoke filterLiveNeeds to perform this step.
      filterLiveNeeds(board.needsAttention, "inspection").map((n) => n.id),
      // Support the surrounding logic for this step.
      ["i1"],
    );
    // Bind next for use in the following logic.
    const next = mergeAttentionPage(board, "awaiting_inspection", {
      // Provide kind field used by this structure.
      kind: "awaiting_inspection",
      // Provide items field used by this structure.
      items: [
        need("awaiting_inspection", "i1"), // duplicate
        // Invoke need to perform this step.
        need("awaiting_inspection", "i2"),
      ],
      // Provide total field used by this structure.
      total: 3,
      // Provide returned field used by this structure.
      returned: 2,
      // Provide hasMore field used by this structure.
      hasMore: true,
      // Provide nextCursor field used by this structure.
      nextCursor: "c2",
    });
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke next.needsAttention.map to perform this step.
      next.needsAttention.map((n) => n.id),
      // Support the surrounding logic for this step.
      ["i1", "i2"],
    );
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(next.attention?.awaitingInspection, {
      // Provide total field used by this structure.
      total: 3,
      // Provide returned field used by this structure.
      returned: 3,
      // Provide hasMore field used by this structure.
      hasMore: true,
      // Provide nextCursor field used by this structure.
      nextCursor: "c2",
    });
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke filterLiveNeeds to perform this step.
      filterLiveNeeds(next.needsAttention, "inspection").map((n) => n.id),
      // Support the surrounding logic for this step.
      ["i1", "i2"],
    );
  });
});

// Group related tests under a shared suite name.
describe("overlapping refresh / unmount / out-of-order", () => {
  // Define a single test case and its expectation.
  it("coalesces non-force onto in-flight; force aborts and bumps gen", () => {
    // Initialize an object holding related fields.
    let state = {
      // Provide currentGen field used by this structure.
      currentGen: 0,
      // Provide inFlight field used by this structure.
      inFlight: null as ReturnType<typeof beginRefreshFlight> extends {
        // Provide flight field used by this structure.
        flight: infer F;
      }
        // Support the surrounding logic for this step.
        ? F | null
        // Support the surrounding logic for this step.
        : never,
    };
    // Bind first for use in the following logic.
    const first = beginRefreshFlight(state, {});
    // Invoke assert.equal to perform this step.
    assert.equal("coalesced" in first, false);
    // Conditional branch for the case described by this guard.
    if ("coalesced" in first) throw new Error("unreachable");
    // Support the surrounding logic for this step.
    state = first.state;

    // Bind joined for use in the following logic.
    const joined = beginRefreshFlight(state, {});
    // Invoke assert.equal to perform this step.
    assert.equal("coalesced" in joined, true);
    // Conditional branch for the case described by this guard.
    if (!("coalesced" in joined)) throw new Error("unreachable");
    // Invoke assert.equal to perform this step.
    assert.equal(joined.flight.gen, first.flight.gen);

    // Bind forced for use in the following logic.
    const forced = beginRefreshFlight(state, { force: true });
    // Invoke assert.equal to perform this step.
    assert.equal("coalesced" in forced, false);
    // Conditional branch for the case described by this guard.
    if ("coalesced" in forced) throw new Error("unreachable");
    // Invoke assert.equal to perform this step.
    assert.equal(first.flight.aborted, true);
    // Invoke assert.equal to perform this step.
    assert.equal(forced.flight.gen, first.flight.gen + 1);
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke applyRefreshResult to perform this step.
      applyRefreshResult(first.flight, forced.state.currentGen),
      // Support the surrounding logic for this step.
      false,
    );
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke applyRefreshResult to perform this step.
      applyRefreshResult(forced.flight, forced.state.currentGen),
      // Support the surrounding logic for this step.
      true,
    );
  });

  // Define a single test case and its expectation.
  it("unmount invalidates so a late response cannot apply", () => {
    // Initialize an object holding related fields.
    let state = {
      // Provide currentGen field used by this structure.
      currentGen: 0,
      // Provide inFlight field used by this structure.
      inFlight: null as {
        // Provide gen field used by this structure.
        gen: number;
        // Provide aborted field used by this structure.
        aborted: boolean;
      // Support the surrounding logic for this step.
      } | null,
    };
    // Bind started for use in the following logic.
    const started = beginRefreshFlight(state, {});
    // Conditional branch for the case described by this guard.
    if ("coalesced" in started) throw new Error("unreachable");
    // Support the surrounding logic for this step.
    state = started.state;
    // Bind afterUnmount for use in the following logic.
    const afterUnmount = invalidateRefreshOnUnmount(state);
    // Invoke assert.equal to perform this step.
    assert.equal(started.flight.aborted, true);
    // Invoke assert.equal to perform this step.
    assert.equal(afterUnmount.currentGen, started.flight.gen + 1);
    // Invoke assert.equal to perform this step.
    assert.equal(
      // Invoke applyRefreshResult to perform this step.
      applyRefreshResult(started.flight, afterUnmount.currentGen),
      // Support the surrounding logic for this step.
      false,
    );
  });

  // Define a single test case and its expectation.
  it("late stale GET after forced post-mutation refresh is dropped", () => {
    // Initialize an object holding related fields.
    let state = {
      // Provide currentGen field used by this structure.
      currentGen: 0,
      // Provide inFlight field used by this structure.
      inFlight: null as { gen: number; aborted: boolean } | null,
    };
    // Bind stale for use in the following logic.
    const stale = beginRefreshFlight(state, {});
    // Conditional branch for the case described by this guard.
    if ("coalesced" in stale) throw new Error("unreachable");
    // Support the surrounding logic for this step.
    state = stale.state;
    // Bind fresh for use in the following logic.
    const fresh = beginRefreshFlight(state, { force: true });
    // Conditional branch for the case described by this guard.
    if ("coalesced" in fresh) throw new Error("unreachable");
    // Support the surrounding logic for this step.
    state = fresh.state;
    // Invoke assert.equal to perform this step.
    assert.equal(applyRefreshResult(fresh.flight, state.currentGen), true);
    // Invoke assert.equal to perform this step.
    assert.equal(applyRefreshResult(stale.flight, state.currentGen), false);
  });
});

// Group related tests under a shared suite name.
describe("mutation pending + refresh failure UX", () => {
  // Define a single test case and its expectation.
  it("complete ok + refresh fail keeps success message and surfaces error", () => {
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke completeThenRefreshOutcome to perform this step.
      completeThenRefreshOutcome({
        // Provide completeOk field used by this structure.
        completeOk: true,
        // Provide refreshOk field used by this structure.
        refreshOk: false,
        // Provide refreshError field used by this structure.
        refreshError: "network",
      }),
      // Support the surrounding logic for this step.
      { message: "Session completed", error: "network" },
    );
  });

  // Define a single test case and its expectation.
  it("complete fail does not claim session completed", () => {
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke completeThenRefreshOutcome to perform this step.
      completeThenRefreshOutcome({
        // Provide completeOk field used by this structure.
        completeOk: false,
        // Provide refreshOk field used by this structure.
        refreshOk: false,
        // Provide completeError field used by this structure.
        completeError: "forbidden",
      }),
      // Support the surrounding logic for this step.
      { message: null, error: "forbidden" },
    );
  });
});

// Group related tests under a shared suite name.
describe("controller wiring (structure)", () => {
  // Bind src for use in the following logic.
  const src = readFileSync(
    // Invoke path.join to perform this step.
    path.join(here, "useLiveBoardController.ts"),
    // Support the surrounding logic for this step.
    "utf8",
  );

  // Define a single test case and its expectation.
  it("subscribes via useLiveRefresh to domain change events", () => {
    // Invoke assert.match to perform this step.
    assert.match(src, /useLiveRefresh\(/);
    // Invoke assert.match to perform this step.
    assert.match(src, /"location\.changed"/);
    // Invoke assert.match to perform this step.
    assert.match(src, /"cleaning\.changed"/);
    // Invoke assert.match to perform this step.
    assert.match(src, /"ticket\.changed"/);
    // Invoke assert.match to perform this step.
    assert.match(src, /"settings\.changed"/);
    // Invoke assert.match to perform this step.
    assert.match(src, /enabled:\s*!loading/);
    // Invoke assert.match to perform this step.
    assert.match(src, /busy:\s*busyIds\.size\s*>\s*0/);
  });

  // Define a single test case and its expectation.
  it("mount refresh + unmount aborts and bumps generation", () => {
    // Invoke assert.match to perform this step.
    assert.match(src, /void refresh\(\{\s*silent:\s*false\s*\}\)/);
    // Invoke assert.match to perform this step.
    assert.match(src, /refreshGen\.current\s*\+=\s*1/);
    // Invoke assert.match to perform this step.
    assert.match(src, /abortRef\.current\?\.abort\(\)/);
  });

  // Define a single test case and its expectation.
  it("uses shared pure helpers for filters, merge, stale, attention actions", () => {
    // Invoke assert.match to perform this step.
    assert.match(src, /filterLiveSessions/);
    // Invoke assert.match to perform this step.
    assert.match(src, /filterLiveNeeds/);
    // Invoke assert.match to perform this step.
    assert.match(src, /mergeAttentionPage/);
    // Invoke assert.match to perform this step.
    assert.match(src, /deriveLiveConnAfterTick/);
    // Invoke assert.match to perform this step.
    assert.match(src, /attentionActionLabel/);
    // Invoke assert.match to perform this step.
    assert.match(src, /attentionDestinationPanel/);
  });
});
