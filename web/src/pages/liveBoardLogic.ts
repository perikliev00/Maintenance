/**
 * Pure helpers for the live board (testable without React).
 */
import type { LiveNeedsAttention } from "../api/operationsLiveApi";
import type { Panel } from "../api/capabilities";
import { panelForLocationKind } from "../app/boardFocus";

export type LiveCategory =
  | "active"
  | "overdue"
  | "anomaly"
  | "inspection"
  | "blocking";

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
