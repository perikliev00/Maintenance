/**
 * Save lifecycle for the active settings tab.
 *
 * - Sends the draft with `expectedVersion` (optimistic concurrency) and the
 *   trimmed optional reason, guarded by the shared busy mutation.
 * - A confirmed PATCH is a success even if follow-up reads fail: those become
 *   a separate `refreshWarning` (BUG-07), never a save error.
 * - Save failures are classified: conflict (draft + reason kept, server
 *   refreshed non-forced so the conflict banner appears), uncertain network
 *   outcome, or plain failure.
 */
import { patchSetting, type SettingsBundle } from "../../api/client";
// Import type-only dependency for typing without runtime cost.
import type { useBusyMutation } from "../../hooks/useBusyMutation";
// Import type-only dependency for typing without runtime cost.
import type { LabelFn, Tab } from "./constants";
// Import module dependency from ./settingsDraftLogic.
import { classifySaveError, isEditableTab } from "./settingsDraftLogic";
// Import type-only dependency for typing without runtime cost.
import type { SettingsFeedback } from "./useSettingsFeedback";

// Declare type alias Options.
type Options = {
  // Provide tab field used by this structure.
  tab: Tab;
  // Provide bundle field used by this structure.
  bundle: SettingsBundle | null;
  // Provide draft field used by this structure.
  draft: Record<string, unknown>;
  // Provide reason field used by this structure.
  reason: string;
  // Provide busy field used by this structure.
  busy: Pick<
    // Support the surrounding logic for this step.
    ReturnType<typeof useBusyMutation>,
    // Support the surrounding logic for this step.
    "busyRef" | "runMutationWithRefresh"
  >;
  // Provide feedback field used by this structure.
  feedback: SettingsFeedback;
  // Provide label field used by this structure.
  label: LabelFn;
  /** Follow-up reads. Each is independent; failures are aggregated. */
  refresh: {
    // Provide settings field used by this structure.
    settings: (opts?: { forceDraft?: boolean }) => Promise<void>;
    /** Never rejects (system failures only mark diagnostics stale). */
    system: () => Promise<void>;
    // Provide history field used by this structure.
    history: () => Promise<void>;
  };
  /** Called after a confirmed save: forget reason + conflict. */
  onSaved: () => void;
};

// Export function useSettingsSave as part of this module's API.
export function useSettingsSave({
  // Support the surrounding logic for this step.
  tab,
  // Support the surrounding logic for this step.
  bundle,
  // Support the surrounding logic for this step.
  draft,
  // Support the surrounding logic for this step.
  reason,
  // Provide busy field used by this structure.
  busy: { busyRef, runMutationWithRefresh },
  // Provide feedback field used by this structure.
  feedback: { setError, setMessage, setRefreshWarning },
  // Support the surrounding logic for this step.
  label,
  // Support the surrounding logic for this step.
  refresh,
  // Support the surrounding logic for this step.
  onSaved,
// Support the surrounding logic for this step.
}: Options) {
  /** Patch the current tab's draft with CAS version, then best-effort refresh. */
  async function save() {
    // Conditional branch for the case described by this guard.
    if (!isEditableTab(tab) || busyRef.current) return;
    // Update React state so the UI reflects the new value.
    setError(null);
    // Update React state so the UI reflects the new value.
    setMessage(null);
    // Update React state so the UI reflects the new value.
    setRefreshWarning(null);
    // Bind expectedVersion for use in the following logic.
    const expectedVersion = bundle?.[tab]?.version;

    // Bind result for use in the following logic.
    const result = await runMutationWithRefresh(
      // Support the surrounding logic for this step.
      () =>
        // Invoke patchSetting to perform this step.
        patchSetting(tab, draft, reason.trim() || undefined, expectedVersion),
      // Support the surrounding logic for this step.
      async () => {
        // Aggregate follow-up reads; any failure → saved_refresh_failed (BUG-07).
        const errors: string[] = [];
        // Begin guarded block to catch runtime failures.
        try {
          // Wait for an async operation before continuing.
          await refresh.settings({ forceDraft: true });
        // Support the surrounding logic for this step.
        } catch (err) {
          // Invoke errors.push to perform this step.
          errors.push(
            // Support the surrounding logic for this step.
            err instanceof Error ? err.message : "settings refresh failed",
          );
        }
        // Wait for an async operation before continuing.
        await refresh.system();
        // Begin guarded block to catch runtime failures.
        try {
          // Wait for an async operation before continuing.
          await refresh.history();
        // Support the surrounding logic for this step.
        } catch (err) {
          // Invoke errors.push to perform this step.
          errors.push(err instanceof Error ? err.message : "history failed");
        }
        // Conditional branch for the case described by this guard.
        if (errors.length > 0) {
          // Abort this path by throwing an error to callers.
          throw new Error(errors.join("; "));
        }
      },
    );

    // Conditional branch for the case described by this guard.
    if (!result.ok) {
      // Conditional branch for the case described by this guard.
      if (result.error === "busy") return;
      // Bind classified for use in the following logic.
      const classified = classifySaveError(
        // Support the surrounding logic for this step.
        result.cause ?? new Error(result.error),
      );
      // Conditional branch for the case described by this guard.
      if (classified.kind === "conflict") {
        // Begin guarded block to catch runtime failures.
        try {
          // Wait for an async operation before continuing.
          await refresh.settings();
        // Support the surrounding logic for this step.
        } catch {
          /* keep draft; conflict banner already set */
        }
        // Update React state so the UI reflects the new value.
        setError(
          // Invoke label to perform this step.
          label(
            // Support the surrounding logic for this step.
            "Конфликт: друг потребител вече е променил тази настройка. Черновата е запазена.",
            // Support the surrounding logic for this step.
            "Conflict: another user changed this setting. Your draft is kept.",
          ),
        );
        // Return early result or rendered output from this path.
        return;
      }
      // Conditional branch for the case described by this guard.
      if (classified.kind === "uncertain") {
        // Update React state so the UI reflects the new value.
        setError(
          // Invoke label to perform this step.
          label(
            // Support the surrounding logic for this step.
            "Мрежова грешка при запис — резултатът е неизвестен. Проверете преди повторен опит.",
            // Support the surrounding logic for this step.
            "Network error while saving — outcome unknown. Check before retrying.",
          ),
        );
        // Return early result or rendered output from this path.
        return;
      }
      // Update React state so the UI reflects the new value.
      setError(classified.message);
      // Return early result or rendered output from this path.
      return;
    }

    // Update React state so the UI reflects the new value.
    setMessage(label("Запазено", "Saved"));
    // Invoke onSaved to perform this step.
    onSaved();
    // Update React state so the UI reflects the new value.
    setRefreshWarning(
      // Support the surrounding logic for this step.
      result.outcome === "saved_refresh_failed" && result.refreshError
        // Support the surrounding logic for this step.
        ? label(
            // Support the surrounding logic for this step.
            `Записът успя, но опресняването се провали: ${result.refreshError}`,
            // Support the surrounding logic for this step.
            `Saved, but refresh failed: ${result.refreshError}`,
          )
        // Support the surrounding logic for this step.
        : null,
    );
  }

  // Return early result or rendered output from this path.
  return { save };
}
