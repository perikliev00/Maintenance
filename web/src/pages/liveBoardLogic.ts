/**
 * Pure helpers for the live board (testable without React).
 */
import type {
  // Support the surrounding logic for this step.
  AttentionPageMeta,
  // Support the surrounding logic for this step.
  LiveActiveSession,
  // Support the surrounding logic for this step.
  LiveAttentionPage,
  // Support the surrounding logic for this step.
  LiveNeedsAttention,
  // Support the surrounding logic for this step.
  OperationsLive,
// Support the surrounding logic for this step.
} from "../api/operationsLiveApi";
// Import type-only dependency for typing without runtime cost.
import type { Panel } from "../api/capabilities";
// Import module dependency from ../app/boardFocus.
import { panelForLocationKind } from "../app/boardFocus";

// Export type definition for consumers of this module.
export type LiveCategory =
  // Support the surrounding logic for this step.
  | "active"
  // Support the surrounding logic for this step.
  | "overdue"
  // Support the surrounding logic for this step.
  | "anomaly"
  // Support the surrounding logic for this step.
  | "inspection"
  // Support the surrounding logic for this step.
  | "blocking";

// Export type definition for consumers of this module.
export type LiveBoardCategoryFilter =
  // Support the surrounding logic for this step.
  | "all"
  // Support the surrounding logic for this step.
  | "active"
  // Support the surrounding logic for this step.
  | "overdue"
  // Support the surrounding logic for this step.
  | "anomaly"
  // Support the surrounding logic for this step.
  | "inspection"
  // Support the surrounding logic for this step.
  | "blocking";

// Export type definition for consumers of this module.
export type LiveBoardConnState = "live" | "stale" | "offline";

// Export type definition for consumers of this module.
export type LiveBoardViewPhase =
  // Support the surrounding logic for this step.
  | "loading"
  // Support the surrounding logic for this step.
  | "empty"
  // Support the surrounding logic for this step.
  | "error"
  // Support the surrounding logic for this step.
  | "ready"
  // Support the surrounding logic for this step.
  | "error_with_data";

/** Stale threshold mirrored by useLiveBoardController (45s). */
export const LIVE_BOARD_STALE_MS = 45_000;

// Export function needTitle as part of this module's API.
export function needTitle(
  // Provide item field used by this structure.
  item: Pick<LiveNeedsAttention, "kind" | "title" | "titleKey">,
  // Provide locale field used by this structure.
  locale: "bg" | "en",
// Support the surrounding logic for this step.
): string {
  // Bind key for use in the following logic.
  const key = item.titleKey;
  // Conditional branch for the case described by this guard.
  if (
    // Supply a stable list key so React can reconcile items.
    key === "inspection_needed" ||
    // Support the surrounding logic for this step.
    (!key && item.kind === "awaiting_inspection")
  // Support the surrounding logic for this step.
  ) {
    // Return early result or rendered output from this path.
    return locale === "bg" ? "Нужна инспекция" : "Inspection needed";
  }
  // Conditional branch for the case described by this guard.
  if (key === "past_due" || (!key && item.kind === "past_due")) {
    // Return early result or rendered output from this path.
    return locale === "bg" ? "Просрочена" : "Past due";
  }
  // Return early result or rendered output from this path.
  return item.title;
}

/** Complete on the live board requires cleaning.complete only (BUG-04). */
export function canCompleteFromLiveBoard(actions: readonly string[]): boolean {
  // Return early result or rendered output from this path.
  return actions.includes("cleaning.complete");
}

// Export function attentionActionLabel as part of this module's API.
export function attentionActionLabel(
  // Provide kind field used by this structure.
  kind: LiveNeedsAttention["kind"],
  // Provide locale field used by this structure.
  locale: "bg" | "en",
// Support the surrounding logic for this step.
): string {
  // Conditional branch for the case described by this guard.
  if (kind === "blocking_ticket") {
    // Return early result or rendered output from this path.
    return locale === "bg" ? "Отвори повредата" : "Open issue";
  }
  // Conditional branch for the case described by this guard.
  if (kind === "awaiting_inspection") {
    // Return early result or rendered output from this path.
    return locale === "bg" ? "Преглед на инспекцията" : "Review inspection";
  }
  // Return early result or rendered output from this path.
  return locale === "bg" ? "Отвори задачата" : "Open task";
}

// Export function attentionDestinationPanel as part of this module's API.
export function attentionDestinationPanel(
  // Provide item field used by this structure.
  item: Pick<LiveNeedsAttention, "kind" | "location">,
// Support the surrounding logic for this step.
): Panel {
  // Conditional branch for the case described by this guard.
  if (item.kind === "blocking_ticket") return "repairs";
  // Return early result or rendered output from this path.
  return panelForLocationKind(item.location.kind);
}

/**
 * Leading visual category when a session has multiple flags.
 * Anomaly wins over overdue; overdue wins over active.
 */
export function sessionCategory(flags: {
  // Provide overdue field used by this structure.
  overdue: boolean;
  // Provide anomaly field used by this structure.
  anomaly: boolean;
// Support the surrounding logic for this step.
}): LiveCategory {
  // Conditional branch for the case described by this guard.
  if (flags.anomaly) return "anomaly";
  // Conditional branch for the case described by this guard.
  if (flags.overdue) return "overdue";
  // Return early result or rendered output from this path.
  return "active";
}

/** Recalculate session overdue/anomaly from aligned clock (BUG-07). */
export function sessionFlagsFromElapsed(
  // Provide elapsedMinutes field used by this structure.
  elapsedMinutes: number,
  // Provide overdueThresholdMinutes field used by this structure.
  overdueThresholdMinutes: number,
  // Provide anomalyThresholdMinutes field used by this structure.
  anomalyThresholdMinutes: number,
// Support the surrounding logic for this step.
): { overdue: boolean; anomaly: boolean } {
  // Return early result or rendered output from this path.
  return {
    // Provide overdue field used by this structure.
    overdue: elapsedMinutes >= overdueThresholdMinutes,
    // Provide anomaly field used by this structure.
    anomaly: elapsedMinutes >= anomalyThresholdMinutes,
  };
}

/**
 * Decide whether an incoming live snapshot may replace state.
 * Newer generations always win; equal gen is allowed for the in-flight owner.
 */
export function shouldApplyLiveSnapshot(
  // Provide responseGen field used by this structure.
  responseGen: number,
  // Provide currentGen field used by this structure.
  currentGen: number,
// Support the surrounding logic for this step.
): boolean {
  // Return early result or rendered output from this path.
  return responseGen === currentGen;
}

/** Page chrome phase derived from loading / data / error (matches LiveBoardPage). */
export function liveBoardViewPhase(input: {
  // Provide loading field used by this structure.
  loading: boolean;
  // Provide data field used by this structure.
  data: OperationsLive | null;
  // Provide error field used by this structure.
  error: string | null;
// Support the surrounding logic for this step.
}): LiveBoardViewPhase {
  // Conditional branch for the case described by this guard.
  if (input.loading && !input.data) return "loading";
  // Conditional branch for the case described by this guard.
  if (input.data) {
    // Return early result or rendered output from this path.
    return input.error ? "error_with_data" : "ready";
  }
  // Conditional branch for the case described by this guard.
  if (input.error) return "error";
  // Return early result or rendered output from this path.
  return "empty";
}

/**
 * Connection badge after a successful fetch. Offline is owned by refresh catch;
 * this only flips live → stale after STALE_MS without a newer success.
 */
export function deriveLiveConnAfterTick(input: {
  // Provide conn field used by this structure.
  conn: LiveBoardConnState;
  // Provide lastSuccessAt field used by this structure.
  lastSuccessAt: number | null;
  // Provide now field used by this structure.
  now: number;
  // Support the surrounding logic for this step.
  staleMs?: number;
// Support the surrounding logic for this step.
}): LiveBoardConnState {
  // Conditional branch for the case described by this guard.
  if (input.conn === "offline") return "offline";
  // Conditional branch for the case described by this guard.
  if (input.lastSuccessAt == null) return input.conn;
  // Bind staleMs for use in the following logic.
  const staleMs = input.staleMs ?? LIVE_BOARD_STALE_MS;
  // Conditional branch for the case described by this guard.
  if (input.now - input.lastSuccessAt > staleMs) return "stale";
  // Return early result or rendered output from this path.
  return input.conn === "stale" ? "stale" : "live";
}

/** Whether the offline/stale banner should show (hide during first load). */
export function shouldShowLiveConnBanner(input: {
  // Provide conn field used by this structure.
  conn: LiveBoardConnState;
  // Provide loading field used by this structure.
  loading: boolean;
  // Provide data field used by this structure.
  data: OperationsLive | null;
// Support the surrounding logic for this step.
}): boolean {
  // Conditional branch for the case described by this guard.
  if (input.conn === "stale") return true;
  // Conditional branch for the case described by this guard.
  if (input.conn === "offline" && !(input.loading && !input.data)) return true;
  // Return early result or rendered output from this path.
  return false;
}

// Export function filterLiveSessions as part of this module's API.
export function filterLiveSessions<T extends { overdue: boolean; anomaly: boolean }>(
  // Provide sessions field used by this structure.
  sessions: readonly T[],
  // Provide categoryFilter field used by this structure.
  categoryFilter: LiveBoardCategoryFilter,
// Support the surrounding logic for this step.
): T[] {
  // Conditional branch for the case described by this guard.
  if (
    // Support the surrounding logic for this step.
    categoryFilter === "all" ||
    // Support the surrounding logic for this step.
    categoryFilter === "inspection" ||
    // Support the surrounding logic for this step.
    categoryFilter === "blocking"
  // Support the surrounding logic for this step.
  ) {
    // Return early result or rendered output from this path.
    return [...sessions];
  }
  // Conditional branch for the case described by this guard.
  if (categoryFilter === "active") {
    // Return early result or rendered output from this path.
    return sessions.filter((s) => !s.overdue && !s.anomaly);
  }
  // Conditional branch for the case described by this guard.
  if (categoryFilter === "overdue") {
    // Return early result or rendered output from this path.
    return sessions.filter((s) => s.overdue);
  }
  // Return early result or rendered output from this path.
  return sessions.filter((s) => s.anomaly);
}

// Export function filterLiveNeeds as part of this module's API.
export function filterLiveNeeds(
  // Provide needs field used by this structure.
  needs: readonly LiveNeedsAttention[],
  // Provide categoryFilter field used by this structure.
  categoryFilter: LiveBoardCategoryFilter,
// Support the surrounding logic for this step.
): LiveNeedsAttention[] {
  // Conditional branch for the case described by this guard.
  if (categoryFilter === "inspection") {
    // Return early result or rendered output from this path.
    return needs.filter((n) => n.kind === "awaiting_inspection");
  }
  // Conditional branch for the case described by this guard.
  if (categoryFilter === "blocking") {
    // Return early result or rendered output from this path.
    return needs.filter((n) => n.kind === "blocking_ticket");
  }
  // Conditional branch for the case described by this guard.
  if (categoryFilter === "overdue") {
    // Return early result or rendered output from this path.
    return needs.filter((n) => n.kind === "past_due");
  }
  // Conditional branch for the case described by this guard.
  if (categoryFilter === "active" || categoryFilter === "anomaly") {
    // Return early result or rendered output from this path.
    return [];
  }
  // Return early result or rendered output from this path.
  return [...needs];
}

/** Merge a load-more attention page into the board snapshot (dedupe by kind:id). */
export function mergeAttentionPage(
  // Provide prev field used by this structure.
  prev: OperationsLive,
  // Provide kind field used by this structure.
  kind: LiveNeedsAttention["kind"],
  // Provide page field used by this structure.
  page: LiveAttentionPage,
// Support the surrounding logic for this step.
): OperationsLive {
  // Conditional branch for the case described by this guard.
  if (!prev.attention) return prev;
  // Create a Set/Map for efficient membership or keyed lookup.
  const existingKeys = new Set(
    // Invoke prev.needsAttention.map to perform this step.
    prev.needsAttention.map((n) => `${n.kind}:${n.id}`),
  );
  // Map source items into a derived list for rendering or logic.
  const existingIds = new Set(prev.needsAttention.map((n) => n.id));
  // Initialize an array used by subsequent logic.
  const merged = [
    // Spread prior fields/items so overrides can layer cleanly.
    ...prev.needsAttention,
    // Spread prior fields/items so overrides can layer cleanly.
    ...page.items.filter(
      // Support the surrounding logic for this step.
      (n) =>
        // Support the surrounding logic for this step.
        !existingKeys.has(`${n.kind}:${n.id}`) && !existingIds.has(n.id),
    ),
  ];
  // Initialize an object holding related fields.
  const attention = { ...prev.attention };
  // Bind priorReturned for use in the following logic.
  const priorReturned =
    // Support the surrounding logic for this step.
    kind === "awaiting_inspection"
      // Support the surrounding logic for this step.
      ? attention.awaitingInspection.returned
      // Support the surrounding logic for this step.
      : kind === "past_due"
        // Support the surrounding logic for this step.
        ? attention.pastDue.returned
        // Support the surrounding logic for this step.
        : attention.blockingTickets.returned;
  // Initialize an object holding related fields.
  const nextMeta: AttentionPageMeta = {
    // Provide total field used by this structure.
    total: page.total,
    // Provide returned field used by this structure.
    returned: priorReturned + page.returned,
    // Provide hasMore field used by this structure.
    hasMore: page.hasMore,
    // Provide nextCursor field used by this structure.
    nextCursor: page.nextCursor,
  };
  // Conditional branch for the case described by this guard.
  if (kind === "awaiting_inspection") {
    // Support the surrounding logic for this step.
    attention.awaitingInspection = nextMeta;
  // Support the surrounding logic for this step.
  } else if (kind === "past_due") {
    // Support the surrounding logic for this step.
    attention.pastDue = nextMeta;
  // Support the surrounding logic for this step.
  } else {
    // Support the surrounding logic for this step.
    attention.blockingTickets = nextMeta;
  }
  // Return early result or rendered output from this path.
  return { ...prev, needsAttention: merged, attention };
}

/**
 * Outcome of complete → force refresh. Complete success is kept even when
 * the subsequent refresh fails (message + error both surface).
 */
export function completeThenRefreshOutcome(input: {
  // Provide completeOk field used by this structure.
  completeOk: boolean;
  // Provide refreshOk field used by this structure.
  refreshOk: boolean;
  // Support the surrounding logic for this step.
  completeError?: string;
  // Support the surrounding logic for this step.
  refreshError?: string;
// Support the surrounding logic for this step.
}): {
  // Provide message field used by this structure.
  message: string | null;
  // Provide error field used by this structure.
  error: string | null;
// Support the surrounding logic for this step.
} {
  // Conditional branch for the case described by this guard.
  if (!input.completeOk) {
    // Return early result or rendered output from this path.
    return {
      // Provide message field used by this structure.
      message: null,
      // Provide error field used by this structure.
      error: input.completeError ?? "Complete failed",
    };
  }
  // Conditional branch for the case described by this guard.
  if (!input.refreshOk) {
    // Return early result or rendered output from this path.
    return {
      // Provide message field used by this structure.
      message: "Session completed",
      // Provide error field used by this structure.
      error: input.refreshError ?? "Failed to load live board",
    };
  }
  // Return early result or rendered output from this path.
  return { message: "Session completed", error: null };
}

/** Simulate refresh generation + abort ownership used by the controller. */
export type RefreshFlight = {
  // Provide gen field used by this structure.
  gen: number;
  // Provide aborted field used by this structure.
  aborted: boolean;
};

// Export function beginRefreshFlight as part of this module's API.
export function beginRefreshFlight(
  // Provide state field used by this structure.
  state: { currentGen: number; inFlight: RefreshFlight | null },
  // Provide opts field used by this structure.
  opts: { force?: boolean },
// Support the surrounding logic for this step.
): { state: typeof state; flight: RefreshFlight } | { coalesced: true; flight: RefreshFlight } {
  // Conditional branch for the case described by this guard.
  if (!opts.force && state.inFlight && !state.inFlight.aborted) {
    // Return early result or rendered output from this path.
    return { coalesced: true, flight: state.inFlight };
  }
  // Conditional branch for the case described by this guard.
  if (opts.force && state.inFlight) {
    // Support the surrounding logic for this step.
    state.inFlight.aborted = true;
  }
  // Initialize an object holding related fields.
  const flight: RefreshFlight = {
    // Provide gen field used by this structure.
    gen: state.currentGen + 1,
    // Provide aborted field used by this structure.
    aborted: false,
  };
  // Return early result or rendered output from this path.
  return {
    // Provide state field used by this structure.
    state: { currentGen: flight.gen, inFlight: flight },
    // Support the surrounding logic for this step.
    flight,
  };
}

// Export function invalidateRefreshOnUnmount as part of this module's API.
export function invalidateRefreshOnUnmount(state: {
  // Provide currentGen field used by this structure.
  currentGen: number;
  // Provide inFlight field used by this structure.
  inFlight: RefreshFlight | null;
// Support the surrounding logic for this step.
}): { currentGen: number; inFlight: null } {
  // Conditional branch for the case described by this guard.
  if (state.inFlight) state.inFlight.aborted = true;
  // Return early result or rendered output from this path.
  return { currentGen: state.currentGen + 1, inFlight: null };
}

// Export function applyRefreshResult as part of this module's API.
export function applyRefreshResult(
  // Provide flight field used by this structure.
  flight: RefreshFlight,
  // Provide currentGen field used by this structure.
  currentGen: number,
// Support the surrounding logic for this step.
): boolean {
  // Conditional branch for the case described by this guard.
  if (flight.aborted) return false;
  // Return early result or rendered output from this path.
  return shouldApplyLiveSnapshot(flight.gen, currentGen);
}

/** Session row type after tick enrichment (subset used by filters). */
export type TickedSession = Pick<
  // Support the surrounding logic for this step.
  LiveActiveSession,
  // Support the surrounding logic for this step.
  "sessionId" | "overdue" | "anomaly"
// Support the surrounding logic for this step.
> & { elapsedMinutes: number };
