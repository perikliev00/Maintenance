/**
 * Pure helpers for Settings draft / save / live-refresh behavior.
 * Kept framework-free so node:test can lock BUG-03/04/06/07 regressions.
 */
import type { SlaPolicyRow } from "../../api/client";
// Import module dependency from ../../saveRefresh.
import { mergeSavedWithRefreshFailure } from "../../saveRefresh";
// Import type-only dependency for typing without runtime cost.
import type { Tab } from "./constants";

/** Domain events that should refresh system diagnostics only (not the draft). */
export const SYSTEM_STATUS_LIVE_EVENTS = [
  // Support the surrounding logic for this step.
  "ticket.changed",
  // Support the surrounding logic for this step.
  "cleaning.changed",
  // Support the surrounding logic for this step.
  "location.changed",
// Support the surrounding logic for this step.
] as const;

/** Events that may refresh the settings bundle / draft. */
export const SETTINGS_BUNDLE_LIVE_EVENTS = ["settings.changed"] as const;

/** Stable JSON compare for dirty detection (key order from structuredClone drafts). */
export function isDraftDirty(draft: unknown, serverValue: unknown): boolean {
  // Return early result or rendered output from this path.
  return JSON.stringify(draft) !== JSON.stringify(serverValue);
}

/** Tabs backed by a settings row (draft + save); history/issues are not. */
export function isEditableTab(tab: Tab): boolean {
  // Return early result or rendered output from this path.
  return tab !== "history" && tab !== "issues";
}

/**
 * Dirty = the editable tab's draft differs from its last-known server value.
 * Non-editable tabs and tabs without a loaded row are never dirty.
 */
export function isTabDraftDirty(
  // Provide tab field used by this structure.
  tab: Tab,
  // Provide draft field used by this structure.
  draft: unknown,
  // Provide serverValue field used by this structure.
  serverValue: unknown,
// Support the surrounding logic for this step.
): boolean {
  // Return early result or rendered output from this path.
  return isEditableTab(tab) && isDraftDirty(draft, serverValue ?? draft);
}

/**
 * Set one field on a notification channel draft. Device push cannot be enabled
 * from the UI: any `enabled` edit forces `enabled=false, status=not_configured`.
 */
export function patchDraftChannel(
  // Provide draft field used by this structure.
  draft: Record<string, unknown>,
  // Provide channel field used by this structure.
  channel: string,
  // Provide field field used by this structure.
  field: "enabled" | "status",
  // Provide value field used by this structure.
  value: boolean | string,
// Support the surrounding logic for this step.
): Record<string, unknown> {
  // Initialize an object holding related fields.
  const cur = { ...((draft[channel] as object) ?? {}) } as Record<
    // Support the surrounding logic for this step.
    string,
    // Support the surrounding logic for this step.
    unknown
  >;
  // Support the surrounding logic for this step.
  cur[field] = value;
  // Conditional branch for the case described by this guard.
  if (channel === "device_push" && field === "enabled") {
    // Support the surrounding logic for this step.
    cur.enabled = false;
    // Pass cur.status prop/value into the element or config.
    cur.status = "not_configured";
  }
  // Return early result or rendered output from this path.
  return { ...draft, [channel]: cur };
}

/** Replace one priority's SLA row, keeping the list sorted by priority name. */
export function upsertSlaPolicy(
  // Provide prev field used by this structure.
  prev: readonly SlaPolicyRow[],
  // Provide row field used by this structure.
  row: SlaPolicyRow,
// Support the surrounding logic for this step.
): SlaPolicyRow[] {
  // Filter items down to those relevant for this view.
  const others = prev.filter((p) => p.priority !== row.priority);
  // Return early result or rendered output from this path.
  return [...others, row].sort((a, b) => a.priority.localeCompare(b.priority));
}

/** Hours shown for a priority: server row, else the built-in default. */
export function slaHoursForPriority(
  // Provide policies field used by this structure.
  policies: readonly SlaPolicyRow[],
  // Provide priority field used by this structure.
  priority: "low" | "normal" | "high" | "urgent",
// Support the surrounding logic for this step.
): number {
  // Find the first matching item for this lookup.
  const row = policies.find((p) => p.priority === priority);
  // Conditional branch for the case described by this guard.
  if (row) return row.hours;
  // Conditional branch for the case described by this guard.
  if (priority === "urgent") return 4;
  // Conditional branch for the case described by this guard.
  if (priority === "high") return 8;
  // Conditional branch for the case described by this guard.
  if (priority === "low") return 72;
  // Return early result or rendered output from this path.
  return 24;
}

/** Whether an SSE/settings refresh may replace the local draft. */
export function shouldReplaceDraftOnRefresh(input: {
  // Provide dirty field used by this structure.
  dirty: boolean;
  // Provide busy field used by this structure.
  busy: boolean;
// Support the surrounding logic for this step.
}): boolean {
  // Return early result or rendered output from this path.
  return !input.dirty && !input.busy;
}

/**
 * After a settings.changed SSE (or bundle reload), decide draft + conflict UI.
 * Preserves unsaved edits and reason when dirty/busy (BUG-03).
 */
export function applySettingsBundleRefresh(input: {
  // Provide dirty field used by this structure.
  dirty: boolean;
  // Provide busy field used by this structure.
  busy: boolean;
  // Support the surrounding logic for this step.
  forceDraft?: boolean;
  // Provide previousServerValue field used by this structure.
  previousServerValue: unknown;
  // Provide nextServerValue field used by this structure.
  nextServerValue: unknown;
  // Provide draft field used by this structure.
  draft: unknown;
  // Provide reason field used by this structure.
  reason: string;
// Support the surrounding logic for this step.
}): {
  // Provide draft field used by this structure.
  draft: unknown;
  // Provide reason field used by this structure.
  reason: string;
  // Provide serverConflict field used by this structure.
  serverConflict: boolean;
  // Provide replaced field used by this structure.
  replaced: boolean;
// Support the surrounding logic for this step.
} {
  // Bind replace for use in the following logic.
  const replace =
    // Support the surrounding logic for this step.
    input.forceDraft === true ||
    // Invoke shouldReplaceDraftOnRefresh to perform this step.
    shouldReplaceDraftOnRefresh({ dirty: input.dirty, busy: input.busy });
  // Conditional branch for the case described by this guard.
  if (replace) {
    // Return early result or rendered output from this path.
    return {
      // Provide draft field used by this structure.
      draft: structuredClone(input.nextServerValue),
      // Provide reason field used by this structure.
      reason: input.forceDraft ? "" : input.reason,
      // Provide serverConflict field used by this structure.
      serverConflict: false,
      // Provide replaced field used by this structure.
      replaced: true,
    };
  }
  // Return early result or rendered output from this path.
  return {
    // Provide draft field used by this structure.
    draft: input.draft,
    // Provide reason field used by this structure.
    reason: input.reason,
    // Provide serverConflict field used by this structure.
    serverConflict: input.dirty,
    // Provide replaced field used by this structure.
    replaced: false,
  };
}

// Export type definition for consumers of this module.
export type SaveErrorOutcome =
  // Support the surrounding logic for this step.
  | { kind: "conflict"; message: string; currentVersion?: number }
  // Support the surrounding logic for this step.
  | { kind: "failed"; message: string }
  // Support the surrounding logic for this step.
  | { kind: "uncertain"; message: string };

/** Classify PATCH errors without treating a later GET failure as a failed save. */
export function classifySaveError(err: unknown): SaveErrorOutcome {
  // Conditional branch for the case described by this guard.
  if (
    // Support the surrounding logic for this step.
    err &&
    // Support the surrounding logic for this step.
    typeof err === "object" &&
    // Support the surrounding logic for this step.
    "kind" in err &&
    // Support the surrounding logic for this step.
    (err as { kind?: string }).kind === "network"
  // Support the surrounding logic for this step.
  ) {
    // Return early result or rendered output from this path.
    return {
      // Provide kind field used by this structure.
      kind: "uncertain",
      // Provide message field used by this structure.
      message:
        // Support the surrounding logic for this step.
        err instanceof Error
          // Support the surrounding logic for this step.
          ? err.message
          // Support the surrounding logic for this step.
          : "Network error while saving — outcome unknown",
    };
  }
  // Conditional branch for the case described by this guard.
  if (
    // Support the surrounding logic for this step.
    err &&
    // Support the surrounding logic for this step.
    typeof err === "object" &&
    // Support the surrounding logic for this step.
    "status" in err &&
    // Support the surrounding logic for this step.
    (err as { status?: number }).status === 409
  // Support the surrounding logic for this step.
  ) {
    // Bind details for use in the following logic.
    const details = (err as { details?: { currentVersion?: number } }).details;
    // Return early result or rendered output from this path.
    return {
      // Provide kind field used by this structure.
      kind: "conflict",
      // Provide message field used by this structure.
      message:
        // Support the surrounding logic for this step.
        err instanceof Error
          // Support the surrounding logic for this step.
          ? err.message
          // Support the surrounding logic for this step.
          : "Setting was updated by another user",
      // Provide currentVersion field used by this structure.
      currentVersion:
        // Support the surrounding logic for this step.
        typeof details?.currentVersion === "number"
          // Support the surrounding logic for this step.
          ? details.currentVersion
          // Support the surrounding logic for this step.
          : undefined,
    };
  }
  // Return early result or rendered output from this path.
  return {
    // Provide kind field used by this structure.
    kind: "failed",
    // Provide message field used by this structure.
    message: err instanceof Error ? err.message : "Save failed",
  };
}

/**
 * After a confirmed successful PATCH, a failed follow-up read must not clear
 * the success marker — surface a separate refresh warning instead (BUG-07).
 */
export function mergePostSaveRefresh(input: {
  // Provide saveOk field used by this structure.
  saveOk: boolean;
  // Support the surrounding logic for this step.
  refreshError?: string | null;
// Support the surrounding logic for this step.
}): { message: string | null; refreshWarning: string | null } {
  // Conditional branch for the case described by this guard.
  if (!input.saveOk) {
    // Return early result or rendered output from this path.
    return { message: null, refreshWarning: null };
  }
  // Return early result or rendered output from this path.
  return mergeSavedWithRefreshFailure({
    // Provide successMessage field used by this structure.
    successMessage: "saved",
    // Provide refreshError field used by this structure.
    refreshError: input.refreshError,
  });
}

/**
 * Full save-then-refresh outcome used by SettingsPage (BUG-07).
 * Mutation success is independent of subsequent GET failures.
 */
export function resolveSaveFlow(input: {
  // Provide patchResult field used by this structure.
  patchResult:
    // Support the surrounding logic for this step.
    | { ok: true }
    // Support the surrounding logic for this step.
    | { ok: false; error: unknown };
  // Provide refreshResults field used by this structure.
  refreshResults: Array<{ ok: true } | { ok: false; message: string }>;
// Support the surrounding logic for this step.
}): {
  // Provide mutation field used by this structure.
  mutation: "saved" | SaveErrorOutcome["kind"];
  // Provide message field used by this structure.
  message: string | null;
  // Provide error field used by this structure.
  error: string | null;
  // Provide refreshWarning field used by this structure.
  refreshWarning: string | null;
  // Provide keepDraft field used by this structure.
  keepDraft: boolean;
  // Provide keepReason field used by this structure.
  keepReason: boolean;
// Support the surrounding logic for this step.
} {
  // Conditional branch for the case described by this guard.
  if (!input.patchResult.ok) {
    // Bind classified for use in the following logic.
    const classified = classifySaveError(input.patchResult.error);
    // Return early result or rendered output from this path.
    return {
      // Provide mutation field used by this structure.
      mutation: classified.kind,
      // Provide message field used by this structure.
      message: null,
      // Provide error field used by this structure.
      error: classified.message,
      // Provide refreshWarning field used by this structure.
      refreshWarning: null,
      // Provide keepDraft field used by this structure.
      keepDraft: true,
      // Provide keepReason field used by this structure.
      keepReason: classified.kind === "conflict" || classified.kind === "uncertain",
    };
  }
  // Find the first matching item for this lookup.
  const failedRefresh = input.refreshResults.find((r) => !r.ok);
  // Bind merged for use in the following logic.
  const merged = mergePostSaveRefresh({
    // Provide saveOk field used by this structure.
    saveOk: true,
    // Provide refreshError field used by this structure.
    refreshError: failedRefresh && !failedRefresh.ok ? failedRefresh.message : null,
  });
  // Return early result or rendered output from this path.
  return {
    // Provide mutation field used by this structure.
    mutation: "saved",
    // Provide message field used by this structure.
    message: merged.message,
    // Provide error field used by this structure.
    error: null,
    // Provide refreshWarning field used by this structure.
    refreshWarning: merged.refreshWarning,
    // Provide keepDraft field used by this structure.
    keepDraft: false,
    // Provide keepReason field used by this structure.
    keepReason: false,
  };
}

/** Format a diagnostic count; null → UNKNOWN (never coerce to 0). */
export function formatStatusCount(value: number | null | undefined): string {
  // Conditional branch for the case described by this guard.
  if (value === null || value === undefined) return "—";
  // Return early result or rendered output from this path.
  return String(value);
}
