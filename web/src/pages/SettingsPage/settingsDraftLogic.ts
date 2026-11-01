/**
 * Pure helpers for Settings draft / save / live-refresh behavior.
 * Kept framework-free so node:test can lock BUG-03/04/06/07 regressions.
 */

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

/** While a PATCH is in flight, editors and tab switches must be locked (BUG-04). */
export function isSettingsEditingLocked(busy: boolean): boolean {
  return busy;
}

/** Which live event types should trigger a system-status refresh (BUG-06). */
export function shouldRefreshSystemStatus(eventType: string): boolean {
  return (SYSTEM_STATUS_LIVE_EVENTS as readonly string[]).includes(eventType);
}

/** Settings bundle refresh must not run for operational domain events (BUG-06). */
export function shouldRefreshSettingsBundle(eventType: string): boolean {
  return (SETTINGS_BUNDLE_LIVE_EVENTS as readonly string[]).includes(eventType);
}

/**
 * Race-safe apply for system status responses (BUG-06).
 * A slower older response must not overwrite a newer one.
 */
export function shouldApplySystemStatusRevision(
  mine: number,
  latest: number,
): boolean {
  return mine === latest;
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
  return {
    message: "saved",
    refreshWarning: input.refreshError ?? null,
  };
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
