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
  // Support the surrounding logic for this step.
  useCallback,
  // Support the surrounding logic for this step.
  useEffect,
  // Support the surrounding logic for this step.
  useRef,
  // Support the surrounding logic for this step.
  useState,
  // Declare type alias Dispatch.
  type Dispatch,
  // Declare type alias SetStateAction.
  type SetStateAction,
// Support the surrounding logic for this step.
} from "react";
// Import type-only dependency for typing without runtime cost.
import type { SettingsBundle } from "../../api/client";
// Import type-only dependency for typing without runtime cost.
import type { Tab } from "./constants";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  applySettingsBundleRefresh,
  // Support the surrounding logic for this step.
  isDraftDirty,
  // Support the surrounding logic for this step.
  isEditableTab,
  // Support the surrounding logic for this step.
  isTabDraftDirty,
  // Support the surrounding logic for this step.
  patchDraftChannel,
// Support the surrounding logic for this step.
} from "./settingsDraftLogic";

// Declare type alias Options.
type Options = {
  // Provide tab field used by this structure.
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
  // Support the surrounding logic for this step.
  tab,
  // Support the surrounding logic for this step.
  bundle,
  // Support the surrounding logic for this step.
  busyRef,
  // Support the surrounding logic for this step.
  clearFeedback,
// Support the surrounding logic for this step.
}: Options) {
  // React state slot for local UI/data that can change over time.
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  // React state slot for local UI/data that can change over time.
  const [reason, setReason] = useState("");
  // React state slot for local UI/data that can change over time.
  const [serverConflict, setServerConflict] = useState(false);

  // Hold a mutable ref that persists across renders without re-render.
  const draftRef = useRef(draft);
  // Hold a mutable ref that persists across renders without re-render.
  const bundleRef = useRef(bundle);
  // Hold a mutable ref that persists across renders without re-render.
  const tabRef = useRef(tab);
  // Hold a mutable ref that persists across renders without re-render.
  const clearFeedbackRef = useRef(clearFeedback);
  // Support the surrounding logic for this step.
  draftRef.current = draft;
  // Support the surrounding logic for this step.
  bundleRef.current = bundle;
  // Support the surrounding logic for this step.
  tabRef.current = tab;
  // Support the surrounding logic for this step.
  clearFeedbackRef.current = clearFeedback;

  // Bind dirty for use in the following logic.
  const dirty = isTabDraftDirty(tab, draft, bundle?.[tab]?.value);

  /**
   * Apply a freshly loaded bundle to the draft (call after the bundle state
   * was committed; "previous" is the last rendered server value).
   */
  const applyServerBundle = useCallback(
    // Support the surrounding logic for this step.
    (next: SettingsBundle, opts?: { forceDraft?: boolean }) => {
      // Bind activeTab for use in the following logic.
      const activeTab = tabRef.current;
      // Conditional branch for the case described by this guard.
      if (!isEditableTab(activeTab) || !next[activeTab]) return;

      // Bind previous for use in the following logic.
      const previous = bundleRef.current?.[activeTab]?.value;
      // Bind applied for use in the following logic.
      const applied = applySettingsBundleRefresh({
        // Provide dirty field used by this structure.
        dirty: isDraftDirty(draftRef.current, previous),
        // Provide busy field used by this structure.
        busy: busyRef.current,
        // Provide forceDraft field used by this structure.
        forceDraft: opts?.forceDraft,
        // Provide previousServerValue field used by this structure.
        previousServerValue: previous,
        // Provide nextServerValue field used by this structure.
        nextServerValue: next[activeTab].value,
        // Provide draft field used by this structure.
        draft: draftRef.current,
        // Provide reason field used by this structure.
        reason: "",
      });
      // Conditional branch for the case described by this guard.
      if (applied.replaced) {
        // Update React state so the UI reflects the new value.
        setDraft(applied.draft as Record<string, unknown>);
      }
      // Update React state so the UI reflects the new value.
      setServerConflict(applied.serverConflict);
    },
    // Support the surrounding logic for this step.
    [busyRef],
  );

  // On tab change only (not bundle): re-clone so SSE updates cannot wipe edits.
  useEffect(() => {
    // Bind row for use in the following logic.
    const row = bundleRef.current?.[tab];
    // Conditional branch for the case described by this guard.
    if (isEditableTab(tab) && row) {
      // Update React state so the UI reflects the new value.
      setDraft(structuredClone(row.value) as Record<string, unknown>);
      // Update React state so the UI reflects the new value.
      setReason("");
      // Update React state so the UI reflects the new value.
      setServerConflict(false);
      // Invoke clearFeedbackRef.current to perform this step.
      clearFeedbackRef.current();
    }
  // Support the surrounding logic for this step.
  }, [tab]);

  /** Field edit: drops stale save feedback, then updates the draft. */
  const editDraft: Dispatch<SetStateAction<Record<string, unknown>>> =
    // Memoize callback identity for stable child/effect deps.
    useCallback((action) => {
      // Invoke clearFeedbackRef.current to perform this step.
      clearFeedbackRef.current();
      // Update React state so the UI reflects the new value.
      setDraft(action);
    // Support the surrounding logic for this step.
    }, []);

  // Memoize callback identity for stable child/effect deps.
  const setBool = useCallback(
    // Support the surrounding logic for this step.
    (path: string, value: boolean) => {
      // Invoke editDraft to perform this step.
      editDraft((prev) => ({ ...prev, [path]: value }));
    },
    // Support the surrounding logic for this step.
    [editDraft],
  );

  // Memoize callback identity for stable child/effect deps.
  const setNestedChannel = useCallback(
    // Support the surrounding logic for this step.
    (channel: string, field: "enabled" | "status", value: boolean | string) => {
      // Invoke editDraft to perform this step.
      editDraft((prev) => patchDraftChannel(prev, channel, field, value));
    },
    // Support the surrounding logic for this step.
    [editDraft],
  );

  /** After a successful save or deliberate reload: forget reason + conflict. */
  const clearReasonAndConflict = useCallback(() => {
    // Update React state so the UI reflects the new value.
    setReason("");
    // Update React state so the UI reflects the new value.
    setServerConflict(false);
  // Support the surrounding logic for this step.
  }, []);

  // Return early result or rendered output from this path.
  return {
    // Support the surrounding logic for this step.
    draft,
    // Support the surrounding logic for this step.
    reason,
    // Support the surrounding logic for this step.
    setReason,
    // Support the surrounding logic for this step.
    dirty,
    // Support the surrounding logic for this step.
    serverConflict,
    // Support the surrounding logic for this step.
    applyServerBundle,
    // Support the surrounding logic for this step.
    clearReasonAndConflict,
    // Support the surrounding logic for this step.
    editDraft,
    // Support the surrounding logic for this step.
    setBool,
    // Support the surrounding logic for this step.
    setNestedChannel,
  };
}
