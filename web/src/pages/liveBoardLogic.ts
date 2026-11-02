/**
 * Pure helpers for the live board (testable without React).
 */
import type {
  AttentionPageMeta,
  LiveActiveSession,
  LiveAttentionPage,
  LiveNeedsAttention,
  OperationsLive,
} from "../api/operationsLiveApi";
import type { Panel } from "../api/capabilities";
import { panelForLocationKind } from "../app/boardFocus";

export type LiveCategory =
  | "active"
  | "overdue"
  | "anomaly"
  | "inspection"
  | "blocking";

export type LiveBoardCategoryFilter =
  | "all"
  | "active"
  | "overdue"
  | "anomaly"
  | "inspection"
  | "blocking";

export type LiveBoardConnState = "live" | "stale" | "offline";

export type LiveBoardViewPhase =
  | "loading"
  | "empty"
  | "error"
  | "ready"
  | "error_with_data";

/** Stale threshold mirrored by useLiveBoardController (45s). */
export const LIVE_BOARD_STALE_MS = 45_000;

export function needTitle(
  item: Pick<LiveNeedsAttention, "kind" | "title" | "titleKey">,
  locale: "bg" | "en",
): string {
  const key = item.titleKey;
  if (
    key === "inspection_needed" ||
    (!key && item.kind === "awaiting_inspection")
  ) {
    return locale === "bg" ? "Нужна инспекция" : "Inspection needed";
  }
  if (key === "past_due" || (!key && item.kind === "past_due")) {
    return locale === "bg" ? "Просрочена" : "Past due";
  }
  return item.title;
}

/** Complete on the live board requires cleaning.complete only (BUG-04). */
export function canCompleteFromLiveBoard(actions: readonly string[]): boolean {
  return actions.includes("cleaning.complete");
}

export function attentionActionLabel(
  kind: LiveNeedsAttention["kind"],
  locale: "bg" | "en",
): string {
  if (kind === "blocking_ticket") {
    return locale === "bg" ? "Отвори повредата" : "Open issue";
  }
  if (kind === "awaiting_inspection") {
    return locale === "bg" ? "Преглед на инспекцията" : "Review inspection";
  }
  return locale === "bg" ? "Отвори задачата" : "Open task";
}

export function attentionDestinationPanel(
  item: Pick<LiveNeedsAttention, "kind" | "location">,
): Panel {
  if (item.kind === "blocking_ticket") return "repairs";
  return panelForLocationKind(item.location.kind);
}

/**
 * Leading visual category when a session has multiple flags.
 * Anomaly wins over overdue; overdue wins over active.
 */
export function sessionCategory(flags: {
  overdue: boolean;
  anomaly: boolean;
}): LiveCategory {
  if (flags.anomaly) return "anomaly";
  if (flags.overdue) return "overdue";
  return "active";
}

/** Recalculate session overdue/anomaly from aligned clock (BUG-07). */
export function sessionFlagsFromElapsed(
  elapsedMinutes: number,
  overdueThresholdMinutes: number,
  anomalyThresholdMinutes: number,
): { overdue: boolean; anomaly: boolean } {
  return {
    overdue: elapsedMinutes >= overdueThresholdMinutes,
    anomaly: elapsedMinutes >= anomalyThresholdMinutes,
  };
}

/**
 * Decide whether an incoming live snapshot may replace state.
 * Newer generations always win; equal gen is allowed for the in-flight owner.
 */
export function shouldApplyLiveSnapshot(
  responseGen: number,
  currentGen: number,
): boolean {
  return responseGen === currentGen;
}

/** Page chrome phase derived from loading / data / error (matches LiveBoardPage). */
export function liveBoardViewPhase(input: {
  loading: boolean;
  data: OperationsLive | null;
  error: string | null;
}): LiveBoardViewPhase {
  if (input.loading && !input.data) return "loading";
  if (input.data) {
    return input.error ? "error_with_data" : "ready";
  }
  if (input.error) return "error";
  return "empty";
}

/**
 * Connection badge after a successful fetch. Offline is owned by refresh catch;
 * this only flips live → stale after STALE_MS without a newer success.
 */
export function deriveLiveConnAfterTick(input: {
  conn: LiveBoardConnState;
  lastSuccessAt: number | null;
  now: number;
  staleMs?: number;
}): LiveBoardConnState {
  if (input.conn === "offline") return "offline";
  if (input.lastSuccessAt == null) return input.conn;
  const staleMs = input.staleMs ?? LIVE_BOARD_STALE_MS;
  if (input.now - input.lastSuccessAt > staleMs) return "stale";
  return input.conn === "stale" ? "stale" : "live";
}

/** Whether the offline/stale banner should show (hide during first load). */
export function shouldShowLiveConnBanner(input: {
  conn: LiveBoardConnState;
  loading: boolean;
  data: OperationsLive | null;
}): boolean {
  if (input.conn === "stale") return true;
  if (input.conn === "offline" && !(input.loading && !input.data)) return true;
  return false;
}

export function filterLiveSessions<T extends { overdue: boolean; anomaly: boolean }>(
  sessions: readonly T[],
  categoryFilter: LiveBoardCategoryFilter,
): T[] {
  if (
    categoryFilter === "all" ||
    categoryFilter === "inspection" ||
    categoryFilter === "blocking"
  ) {
    return [...sessions];
  }
  if (categoryFilter === "active") {
    return sessions.filter((s) => !s.overdue && !s.anomaly);
  }
  if (categoryFilter === "overdue") {
    return sessions.filter((s) => s.overdue);
  }
  return sessions.filter((s) => s.anomaly);
}

export function filterLiveNeeds(
  needs: readonly LiveNeedsAttention[],
  categoryFilter: LiveBoardCategoryFilter,
): LiveNeedsAttention[] {
  if (categoryFilter === "inspection") {
    return needs.filter((n) => n.kind === "awaiting_inspection");
  }
  if (categoryFilter === "blocking") {
    return needs.filter((n) => n.kind === "blocking_ticket");
  }
  if (categoryFilter === "overdue") {
    return needs.filter((n) => n.kind === "past_due");
  }
  if (categoryFilter === "active" || categoryFilter === "anomaly") {
    return [];
  }
  return [...needs];
}

/** Merge a load-more attention page into the board snapshot (dedupe by kind:id). */
export function mergeAttentionPage(
  prev: OperationsLive,
  kind: LiveNeedsAttention["kind"],
  page: LiveAttentionPage,
): OperationsLive {
  if (!prev.attention) return prev;
  const existingKeys = new Set(
    prev.needsAttention.map((n) => `${n.kind}:${n.id}`),
  );
  const existingIds = new Set(prev.needsAttention.map((n) => n.id));
  const merged = [
    ...prev.needsAttention,
    ...page.items.filter(
      (n) =>
        !existingKeys.has(`${n.kind}:${n.id}`) && !existingIds.has(n.id),
    ),
  ];
  const attention = { ...prev.attention };
  const priorReturned =
    kind === "awaiting_inspection"
      ? attention.awaitingInspection.returned
      : kind === "past_due"
        ? attention.pastDue.returned
        : attention.blockingTickets.returned;
  const nextMeta: AttentionPageMeta = {
    total: page.total,
    returned: priorReturned + page.returned,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
  };
  if (kind === "awaiting_inspection") {
    attention.awaitingInspection = nextMeta;
  } else if (kind === "past_due") {
    attention.pastDue = nextMeta;
  } else {
    attention.blockingTickets = nextMeta;
  }
  return { ...prev, needsAttention: merged, attention };
}

/**
 * Outcome of complete → force refresh. Complete success is kept even when
 * the subsequent refresh fails (message + error both surface).
 */
export function completeThenRefreshOutcome(input: {
  completeOk: boolean;
  refreshOk: boolean;
  completeError?: string;
  refreshError?: string;
}): {
  message: string | null;
  error: string | null;
} {
  if (!input.completeOk) {
    return {
      message: null,
      error: input.completeError ?? "Complete failed",
    };
  }
  if (!input.refreshOk) {
    return {
      message: "Session completed",
      error: input.refreshError ?? "Failed to load live board",
    };
  }
  return { message: "Session completed", error: null };
}

/** Simulate refresh generation + abort ownership used by the controller. */
export type RefreshFlight = {
  gen: number;
  aborted: boolean;
};

export function beginRefreshFlight(
  state: { currentGen: number; inFlight: RefreshFlight | null },
  opts: { force?: boolean },
): { state: typeof state; flight: RefreshFlight } | { coalesced: true; flight: RefreshFlight } {
  if (!opts.force && state.inFlight && !state.inFlight.aborted) {
    return { coalesced: true, flight: state.inFlight };
  }
  if (opts.force && state.inFlight) {
    state.inFlight.aborted = true;
  }
  const flight: RefreshFlight = {
    gen: state.currentGen + 1,
    aborted: false,
  };
  return {
    state: { currentGen: flight.gen, inFlight: flight },
    flight,
  };
}

export function invalidateRefreshOnUnmount(state: {
  currentGen: number;
  inFlight: RefreshFlight | null;
}): { currentGen: number; inFlight: null } {
  if (state.inFlight) state.inFlight.aborted = true;
  return { currentGen: state.currentGen + 1, inFlight: null };
}

export function applyRefreshResult(
  flight: RefreshFlight,
  currentGen: number,
): boolean {
  if (flight.aborted) return false;
  return shouldApplyLiveSnapshot(flight.gen, currentGen);
}

/** Session row type after tick enrichment (subset used by filters). */
export type TickedSession = Pick<
  LiveActiveSession,
  "sessionId" | "overdue" | "anomaly"
> & { elapsedMinutes: number };
