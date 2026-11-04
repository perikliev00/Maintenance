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
import type { useBusyMutation } from "../../hooks/useBusyMutation";
import type { LabelFn, Tab } from "./constants";
import { classifySaveError, isEditableTab } from "./settingsDraftLogic";
import type { SettingsFeedback } from "./useSettingsFeedback";

type Options = {
  tab: Tab;
  bundle: SettingsBundle | null;
  draft: Record<string, unknown>;
  reason: string;
  busy: Pick<
    ReturnType<typeof useBusyMutation>,
    "busyRef" | "runMutationWithRefresh"
  >;
  feedback: SettingsFeedback;
  label: LabelFn;
  /** Follow-up reads. Each is independent; failures are aggregated. */
  refresh: {
    settings: (opts?: { forceDraft?: boolean }) => Promise<void>;
    /** Never rejects (system failures only mark diagnostics stale). */
    system: () => Promise<void>;
    history: () => Promise<void>;
  };
  /** Called after a confirmed save: forget reason + conflict. */
  onSaved: () => void;
};

export function useSettingsSave({
  tab,
  bundle,
  draft,
  reason,
  busy: { busyRef, runMutationWithRefresh },
  feedback: { setError, setMessage, setRefreshWarning },
  label,
  refresh,
  onSaved,
}: Options) {
  /** Patch the current tab's draft with CAS version, then best-effort refresh. */
  async function save() {
    if (!isEditableTab(tab) || busyRef.current) return;
    setError(null);
    setMessage(null);
    setRefreshWarning(null);
    const expectedVersion = bundle?.[tab]?.version;

    const result = await runMutationWithRefresh(
      () =>
        patchSetting(tab, draft, reason.trim() || undefined, expectedVersion),
      async () => {
        // Aggregate follow-up reads; any failure → saved_refresh_failed (BUG-07).
        const errors: string[] = [];
        try {
          await refresh.settings({ forceDraft: true });
        } catch (err) {
          errors.push(
            err instanceof Error ? err.message : "settings refresh failed",
          );
        }
        await refresh.system();
        try {
          await refresh.history();
        } catch (err) {
          errors.push(err instanceof Error ? err.message : "history failed");
        }
        if (errors.length > 0) {
          throw new Error(errors.join("; "));
        }
      },
    );

    if (!result.ok) {
      if (result.error === "busy") return;
      const classified = classifySaveError(
        result.cause ?? new Error(result.error),
      );
      if (classified.kind === "conflict") {
        try {
          await refresh.settings();
        } catch {
          /* keep draft; conflict banner already set */
        }
        setError(
          label(
            "Конфликт: друг потребител вече е променил тази настройка. Черновата е запазена.",
            "Conflict: another user changed this setting. Your draft is kept.",
          ),
        );
        return;
      }
      if (classified.kind === "uncertain") {
        setError(
          label(
            "Мрежова грешка при запис — резултатът е неизвестен. Проверете преди повторен опит.",
            "Network error while saving — outcome unknown. Check before retrying.",
          ),
        );
        return;
      }
      setError(classified.message);
      return;
    }

    setMessage(label("Запазено", "Saved"));
    onSaved();
    setRefreshWarning(
      result.outcome === "saved_refresh_failed" && result.refreshError
        ? label(
            `Записът успя, но опресняването се провали: ${result.refreshError}`,
            `Saved, but refresh failed: ${result.refreshError}`,
          )
        : null,
    );
  }

  return { save };
}
