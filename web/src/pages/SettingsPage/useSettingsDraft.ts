/**
 * Draft lifecycle for the active settings tab.
 *
 * Rules
 * - Draft: a structuredClone of the tab's server value, taken when the tab
 *   changes (not on every bundle change) so SSE updates cannot wipe edits.
 * - Dirty: the draft differs from the tab's last-known server value
 *   (`isTabDraftDirty`); history/issues tabs are never dirty.
 * - Server refresh may replace the draft only when forced (initial load,
 *   post-save, explicit "Reload from server") or when the draft is clean and
 *   no save is in flight. A dirty or saving draft is preserved and, when dirty,
 *   `serverConflict` is raised so the UI can offer a deliberate reload.
 * - Reason is independent of refresh: it is cleared only by tab change, a
 *   successful save, or an explicit reload (`clearReasonAndConflict`).
 * - Any field edit clears the saved message/refresh warning via `clearFeedback`.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { SettingsBundle } from "../../api/client";
import type { Tab } from "./constants";
import {
  applySettingsBundleRefresh,
  isDraftDirty,
  isEditableTab,
  isTabDraftDirty,
  patchDraftChannel,
} from "./settingsDraftLogic";

type Options = {
  tab: Tab;
  /** Last-known server bundle (before any pending refresh is applied). */
  bundle: SettingsBundle | null;
  /** True while a save/SLA mutation is in flight. */
  busyRef: { readonly current: boolean };
  /** Invoked on edits and tab reset to drop stale save feedback. */
  clearFeedback: () => void;
};

// Export function useSettingsDraft as part of this module's API.
export function useSettingsDraft({
  tab,
  bundle,
  busyRef,
  clearFeedback,
}: Options) {
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [reason, setReason] = useState("");
  const [serverConflict, setServerConflict] = useState(false);

  const draftRef = useRef(draft);
  const bundleRef = useRef(bundle);
  const tabRef = useRef(tab);
  const clearFeedbackRef = useRef(clearFeedback);
  draftRef.current = draft;
  bundleRef.current = bundle;
  tabRef.current = tab;
  clearFeedbackRef.current = clearFeedback;

  const dirty = isTabDraftDirty(tab, draft, bundle?.[tab]?.value);

  /**
   * Apply a freshly loaded bundle to the draft (call after the bundle state
   * was committed; "previous" is the last rendered server value).
   */
  const applyServerBundle = useCallback(
    (next: SettingsBundle, opts?: { forceDraft?: boolean }) => {
      const activeTab = tabRef.current;
      if (!isEditableTab(activeTab) || !next[activeTab]) return;

      const previous = bundleRef.current?.[activeTab]?.value;
      const applied = applySettingsBundleRefresh({
        dirty: isDraftDirty(draftRef.current, previous),
        busy: busyRef.current,
        forceDraft: opts?.forceDraft,
        previousServerValue: previous,
        nextServerValue: next[activeTab].value,
        draft: draftRef.current,
        reason: "",
      });
      if (applied.replaced) {
        setDraft(applied.draft as Record<string, unknown>);
      }
      setServerConflict(applied.serverConflict);
    },
    [busyRef],
  );

  // On tab change only (not bundle): re-clone so SSE updates cannot wipe edits.
  useEffect(() => {
    const row = bundleRef.current?.[tab];
    if (isEditableTab(tab) && row) {
      setDraft(structuredClone(row.value) as Record<string, unknown>);
      setReason("");
      setServerConflict(false);
      clearFeedbackRef.current();
    }
  }, [tab]);

  /** Field edit: drops stale save feedback, then updates the draft. */
  const editDraft: Dispatch<SetStateAction<Record<string, unknown>>> =
    useCallback((action) => {
      clearFeedbackRef.current();
      setDraft(action);
    }, []);

  const setBool = useCallback(
    (path: string, value: boolean) => {
      editDraft((prev) => ({ ...prev, [path]: value }));
    },
    [editDraft],
  );

  const setNestedChannel = useCallback(
    (channel: string, field: "enabled" | "status", value: boolean | string) => {
      editDraft((prev) => patchDraftChannel(prev, channel, field, value));
    },
    [editDraft],
  );

  /** After a successful save or deliberate reload: forget reason + conflict. */
  const clearReasonAndConflict = useCallback(() => {
    setReason("");
    setServerConflict(false);
  }, []);

  return {
    draft,
    reason,
    setReason,
    dirty,
    serverConflict,
    applyServerBundle,
    clearReasonAndConflict,
    editDraft,
    setBool,
    setNestedChannel,
  };
}
