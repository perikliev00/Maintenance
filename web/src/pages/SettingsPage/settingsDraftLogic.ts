/**
 * Pure helpers for Settings draft / save / live-refresh behavior.
 * Kept framework-free so node:test can lock BUG-03/04/06/07 regressions.
 */
import type { SlaPolicyRow } from "../../api/client";
import { mergeSavedWithRefreshFailure } from "../../saveRefresh";
import type { Tab } from "./constants";

/** Domain events that should refresh system diagnostics only (not the draft). */
export const SYSTEM_STATUS_LIVE_EVENTS = [
  "ticket.changed",
  "cleaning.changed",
  "location.changed",
] as const;

/** Events that may refresh the settings bundle / draft. */
export const SETTINGS_BUNDLE_LIVE_EVENTS = ["settings.changed"] as const;

/** Stable JSON compare for dirty detection (key order from structuredClone drafts). */
export function isDraftDirty(draft: unknown, serverValue: unknown): boolean {
  return JSON.stringify(draft) !== JSON.stringify(serverValue);
}

/** Tabs backed by a settings row (draft + save); history/issues are not. */
export function isEditableTab(tab: Tab): boolean {
  return tab !== "history" && tab !== "issues";
}

/**
 * Dirty = the editable tab's draft differs from its last-known server value.
 * Non-editable tabs and tabs without a loaded row are never dirty.
 */
export function isTabDraftDirty(
  tab: Tab,
  draft: unknown,
  serverValue: unknown,
): boolean {
  return isEditableTab(tab) && isDraftDirty(draft, serverValue ?? draft);
}

/**
 * Set one field on a notification channel draft. Device push cannot be enabled
 * from the UI: any `enabled` edit forces `enabled=false, status=not_configured`.
 */
export function patchDraftChannel(
  draft: Record<string, unknown>,
  channel: string,
  field: "enabled" | "status",
  value: boolean | string,
): Record<string, unknown> {
  const cur = { ...((draft[channel] as object) ?? {}) } as Record<
    string,
    unknown
  >;
  cur[field] = value;
  if (channel === "device_push" && field === "enabled") {
    cur.enabled = false;
    // Pass cur.status prop/value into the element or config.
    cur.status = "not_configured";
  }
  return { ...draft, [channel]: cur };
}

/** Replace one priority's SLA row, keeping the list sorted by priority name. */
export function upsertSlaPolicy(
  prev: readonly SlaPolicyRow[],
  row: SlaPolicyRow,
): SlaPolicyRow[] {
  // Filter items down to those relevant for this view.
  const others = prev.filter((p) => p.priority !== row.priority);
  return [...others, row].sort((a, b) => a.priority.localeCompare(b.priority));
}

/** Hours shown for a priority: server row, else the built-in default. */
export function slaHoursForPriority(
  policies: readonly SlaPolicyRow[],
  priority: "low" | "normal" | "high" | "urgent",
): number {
  // Find the first matching item for this lookup.
  const row = policies.find((p) => p.priority === priority);
  if (row) return row.hours;
  if (priority === "urgent") return 4;
  if (priority === "high") return 8;
  if (priority === "low") return 72;
  return 24;
}

/** Whether an SSE/settings refresh may replace the local draft. */
export function shouldReplaceDraftOnRefresh(input: {
  dirty: boolean;
  busy: boolean;
}): boolean {
  return !input.dirty && !input.busy;
}

/**
 * After a settings.changed SSE (or bundle reload), decide draft + conflict UI.
 * Preserves unsaved edits and reason when dirty/busy (BUG-03).
 */
export function applySettingsBundleRefresh(input: {
  dirty: boolean;
  busy: boolean;
  forceDraft?: boolean;
  previousServerValue: unknown;
  nextServerValue: unknown;
  draft: unknown;
  reason: string;
}): {
  draft: unknown;
  reason: string;
  serverConflict: boolean;
  replaced: boolean;
} {
  const replace =
    input.forceDraft === true ||
    shouldReplaceDraftOnRefresh({ dirty: input.dirty, busy: input.busy });
  if (replace) {
    return {
      draft: structuredClone(input.nextServerValue),
      reason: input.forceDraft ? "" : input.reason,
      serverConflict: false,
      replaced: true,
    };
  }
  return {
    draft: input.draft,
    reason: input.reason,
    serverConflict: input.dirty,
    replaced: false,
  };
}

export type SaveErrorOutcome =
  | { kind: "conflict"; message: string; currentVersion?: number }
  | { kind: "failed"; message: string }
  | { kind: "uncertain"; message: string };

/** Classify PATCH errors without treating a later GET failure as a failed save. */
export function classifySaveError(err: unknown): SaveErrorOutcome {
  if (
    err &&
    typeof err === "object" &&
    "kind" in err &&
    (err as { kind?: string }).kind === "network"
  ) {
    return {
      kind: "uncertain",
      message:
        err instanceof Error
          ? err.message
          : "Network error while saving — outcome unknown",
    };
  }
  if (
    err &&
    typeof err === "object" &&
    "status" in err &&
    (err as { status?: number }).status === 409
  ) {
    const details = (err as { details?: { currentVersion?: number } }).details;
    return {
      kind: "conflict",
      message:
        err instanceof Error
          ? err.message
          : "Setting was updated by another user",
      currentVersion:
        typeof details?.currentVersion === "number"
          ? details.currentVersion
          : undefined,
    };
  }
  return {
    kind: "failed",
    message: err instanceof Error ? err.message : "Save failed",
  };
}

/**
 * After a confirmed successful PATCH, a failed follow-up read must not clear
 * the success marker — surface a separate refresh warning instead (BUG-07).
 */
export function mergePostSaveRefresh(input: {
  saveOk: boolean;
  refreshError?: string | null;
}): { message: string | null; refreshWarning: string | null } {
  if (!input.saveOk) {
    return { message: null, refreshWarning: null };
  }
  return mergeSavedWithRefreshFailure({
    successMessage: "saved",
    refreshError: input.refreshError,
  });
}

/**
 * Full save-then-refresh outcome used by SettingsPage (BUG-07).
 * Mutation success is independent of subsequent GET failures.
 */
export function resolveSaveFlow(input: {
  patchResult:
    | { ok: true }
    | { ok: false; error: unknown };
  refreshResults: Array<{ ok: true } | { ok: false; message: string }>;
}): {
  mutation: "saved" | SaveErrorOutcome["kind"];
  message: string | null;
  error: string | null;
  refreshWarning: string | null;
  keepDraft: boolean;
  keepReason: boolean;
} {
  if (!input.patchResult.ok) {
    const classified = classifySaveError(input.patchResult.error);
    return {
      mutation: classified.kind,
      message: null,
      error: classified.message,
      refreshWarning: null,
      keepDraft: true,
      keepReason: classified.kind === "conflict" || classified.kind === "uncertain",
    };
  }
  // Find the first matching item for this lookup.
  const failedRefresh = input.refreshResults.find((r) => !r.ok);
  const merged = mergePostSaveRefresh({
    saveOk: true,
    refreshError: failedRefresh && !failedRefresh.ok ? failedRefresh.message : null,
  });
  return {
    mutation: "saved",
    message: merged.message,
    error: null,
    refreshWarning: merged.refreshWarning,
    keepDraft: false,
    keepReason: false,
  };
}

/** Format a diagnostic count; null → UNKNOWN (never coerce to 0). */
export function formatStatusCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}
