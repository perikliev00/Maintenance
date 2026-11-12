/**
 * Control people/roles section: searched people list, unsaved role drafts,
 * debounced search, and per-user role saves.
 *
 * Draft rules (`mergeRoleDraftsOnRefresh`): a refresh never wipes an unsaved
 * role choice. Clean rows follow the server; dirty or saving rows keep their
 * draft (and warn if the server role moved too); a just-saved user is
 * force-synced from the server.
 *
 * Refresh scope: `load` reloads the searched people list only (a search commit
 * does not refetch tickets or rooms). After a role save the picker feed for
 * ticket assignees is refreshed through `refreshAssignees`, since a role change
 * can add/remove a technician. Missing `people.change_role` skips fetching
 * without affecting Tickets or Cleaning.
 */
import { useCallback, useEffect, useRef, useState } from "react";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  fetchPeople,
  // Support the surrounding logic for this step.
  updatePersonRole,
  // Declare type alias Person.
  type Person,
  // Declare type alias Role.
  type Role,
// Support the surrounding logic for this step.
} from "../../api/client";
// Import module dependency from ../team/debouncedSearch.
import { createDebouncedSearch } from "../team/debouncedSearch";
// Import module dependency from ../locations/busyIds.
import { addBusyId, removeBusyId } from "../locations/busyIds";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  formatRoleConflicts,
  // Support the surrounding logic for this step.
  mergeMutationAndRefresh,
  // Support the surrounding logic for this step.
  mergeRoleDraftsOnRefresh,
  // Support the surrounding logic for this step.
  sectionFromSettled,
  // Support the surrounding logic for this step.
  settleOptional,
  // Support the surrounding logic for this step.
  shouldApplyControlRefresh,
  // Declare type alias ControlSectionErrors.
  type ControlSectionErrors,
  // Declare type alias SectionLoadResult.
  type SectionLoadResult,
// Support the surrounding logic for this step.
} from "../controlPageState";
// Import type-only dependency for typing without runtime cost.
import type { ControlFeedback, ReportLoad } from "./controlBoardTypes";

// Bind SEARCH_DEBOUNCE_MS for use in the following logic.
const SEARCH_DEBOUNCE_MS = 300;

// Initialize an array used by subsequent logic.
const SCOPE = ["people"] as const;

// Declare type alias LoadOptions.
type LoadOptions = {
  /** Silent loads do not show the "Searching…" indicator. */
  silent?: boolean;
  /** Explicit query (manual Refresh); defaults to the committed query. */
  query?: string;
  /** Users whose draft is force-synced from the server (just saved). */
  replaceUserIds?: ReadonlySet<string>;
};

// Declare type alias Options.
type Options = {
  /** `controlLoadPlan.people` (`people.change_role`). */
  enabled: boolean;
  /** Search-triggered reloads wait until the first page load settles. */
  initialLoading: boolean;
  // Provide feedback field used by this structure.
  feedback: ControlFeedback;
  // Provide reportLoad field used by this structure.
  reportLoad: ReportLoad;
  /** Refresh the ticket assignee picker after a role save. */
  refreshAssignees: () => Promise<unknown>;
};

// Export function useControlPeople as part of this module's API.
export function useControlPeople({
  // Support the surrounding logic for this step.
  enabled,
  // Support the surrounding logic for this step.
  initialLoading,
  // Provide feedback field used by this structure.
  feedback: { setError, setMessage, setRefreshWarning },
  // Support the surrounding logic for this step.
  reportLoad,
  // Support the surrounding logic for this step.
  refreshAssignees,
// Support the surrounding logic for this step.
}: Options) {
  // React state slot for local UI/data that can change over time.
  const [people, setPeople] = useState<Person[]>([]);
  // React state slot for local UI/data that can change over time.
  const [roleDrafts, setRoleDrafts] = useState<Record<string, Role>>({});
  // Bind roleDraftsRef for use in the following logic.
  const roleDraftsRef = useRef<Record<string, Role>>({});
  // Bind serverRolesRef for use in the following logic.
  const serverRolesRef = useRef<Record<string, Role>>({});
  // Support the surrounding logic for this step.
  roleDraftsRef.current = roleDrafts;

  // React state slot for local UI/data that can change over time.
  const [searchInput, setSearchInput] = useState("");
  // React state slot for local UI/data that can change over time.
  const [committedQuery, setCommittedQuery] = useState("");
  // React state slot for local UI/data that can change over time.
  const [searchPending, setSearchPending] = useState(false);
  // Hold a mutable ref that persists across renders without re-render.
  const committedQueryRef = useRef(committedQuery);
  // Support the surrounding logic for this step.
  committedQueryRef.current = committedQuery;

  // React state slot for local UI/data that can change over time.
  const [peopleLoading, setPeopleLoading] = useState(false);
  // React state slot for local UI/data that can change over time.
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(
    // Support the surrounding logic for this step.
    () => new Set(),
  );
  // Create a Set/Map for efficient membership or keyed lookup.
  const savingIdsRef = useRef<Set<string>>(new Set());

  // Hold a mutable ref that persists across renders without re-render.
  const revisionRef = useRef(0);
  // Hold a mutable ref that persists across renders without re-render.
  const mountedRef = useRef(true);

  // Memoize callback identity for stable child/effect deps.
  const beginSaving = useCallback((id: string) => {
    // Conditional branch for the case described by this guard.
    if (savingIdsRef.current.has(id)) return false;
    // Support the surrounding logic for this step.
    savingIdsRef.current = addBusyId(savingIdsRef.current, id);
    // Update React state so the UI reflects the new value.
    setSavingIds(savingIdsRef.current);
    // Return early result or rendered output from this path.
    return true;
  // Support the surrounding logic for this step.
  }, []);

  // Memoize callback identity for stable child/effect deps.
  const endSaving = useCallback((id: string) => {
    // Support the surrounding logic for this step.
    savingIdsRef.current = removeBusyId(savingIdsRef.current, id);
    // Update React state so the UI reflects the new value.
    setSavingIds(savingIdsRef.current);
  // Support the surrounding logic for this step.
  }, []);

  // Memoize callback identity for stable child/effect deps.
  const applyPeopleSection = useCallback(
    (
      // Provide peopleData field used by this structure.
      peopleData: Person[],
      // Support the surrounding logic for this step.
      opts?: { replaceUserIds?: ReadonlySet<string> },
    // Support the surrounding logic for this step.
    ) => {
      // Bind merged for use in the following logic.
      const merged = mergeRoleDraftsOnRefresh({
        // Provide prevDrafts field used by this structure.
        prevDrafts: roleDraftsRef.current,
        // Provide prevServerRoles field used by this structure.
        prevServerRoles: serverRolesRef.current,
        // Provide nextPeople field used by this structure.
        nextPeople: peopleData,
        // Provide replaceUserIds field used by this structure.
        replaceUserIds: opts?.replaceUserIds,
        // Provide busyUserIds field used by this structure.
        busyUserIds: savingIdsRef.current,
      });
      // Support the surrounding logic for this step.
      serverRolesRef.current = merged.serverRoles;
      // Support the surrounding logic for this step.
      roleDraftsRef.current = merged.drafts;
      // Update React state so the UI reflects the new value.
      setPeople(peopleData);
      // Update React state so the UI reflects the new value.
      setRoleDrafts(merged.drafts);
      // Initialize an object holding related fields.
      const nameByUserId: Record<string, string> = {};
      // Iterate a collection or counted range.
      for (const p of peopleData) {
        // Conditional branch for the case described by this guard.
        if (p.userId) nameByUserId[p.userId] = p.fullName;
      }
      // Bind conflictMsg for use in the following logic.
      const conflictMsg = formatRoleConflicts(merged.conflicts, nameByUserId);
      // Conditional branch for the case described by this guard.
      if (conflictMsg) setRefreshWarning(conflictMsg);
    },
    // Support the surrounding logic for this step.
    [setRefreshWarning],
  );

  // Memoize callback identity for stable child/effect deps.
  const load = useCallback(
    // Support the surrounding logic for this step.
    async (opts?: LoadOptions): Promise<SectionLoadResult> => {
      // Bind revision for use in the following logic.
      const revision = ++revisionRef.current;
      // Conditional branch for the case described by this guard.
      if (!enabled) return { status: "done", scope: [], errors: {} };

      // Bind q for use in the following logic.
      const q =
        // Support the surrounding logic for this step.
        opts?.query !== undefined
          // Support the surrounding logic for this step.
          ? opts.query
          // Support the surrounding logic for this step.
          : committedQueryRef.current.trim();
      // Bind markLoading for use in the following logic.
      const markLoading = !opts?.silent;
      // Conditional branch for the case described by this guard.
      if (markLoading) setPeopleLoading(true);

      // Begin guarded block to catch runtime failures.
      try {
        // Bind settled for use in the following logic.
        const settled = await settleOptional(
          // Invoke fetchPeople to perform this step.
          fetchPeople({ q: q || undefined, includeInactive: true }),
        );
        // Conditional branch for the case described by this guard.
        if (!shouldApplyControlRefresh(revision, revisionRef.current)) {
          // Return early result or rendered output from this path.
          return { status: "stale" };
        }

        // Initialize an object holding related fields.
        const errors: ControlSectionErrors = {};
        // Bind result for use in the following logic.
        const result = sectionFromSettled(settled, true);
        // Conditional branch for the case described by this guard.
        if (result.status === "ok") {
          // Invoke applyPeopleSection to perform this step.
          applyPeopleSection(result.data, {
            // Provide replaceUserIds field used by this structure.
            replaceUserIds: opts?.replaceUserIds,
          });
        // Support the surrounding logic for this step.
        } else if (result.status === "error") {
          // Support the surrounding logic for this step.
          errors.people = result.message;
        }

        // Initialize an object holding related fields.
        const done: SectionLoadResult = { status: "done", scope: SCOPE, errors };
        // Invoke reportLoad to perform this step.
        reportLoad(done);
        // Return early result or rendered output from this path.
        return done;
      // Support the surrounding logic for this step.
      } finally {
        // Conditional branch for the case described by this guard.
        if (markLoading && revision === revisionRef.current) {
          // Update React state so the UI reflects the new value.
          setPeopleLoading(false);
        }
      }
    },
    // Support the surrounding logic for this step.
    [applyPeopleSection, enabled, reportLoad],
  );

  // Hold a mutable ref that persists across renders without re-render.
  const searchBridgeRef = useRef(
    // Invoke createDebouncedSearch to perform this step.
    createDebouncedSearch({
      // Provide debounceMs field used by this structure.
      debounceMs: SEARCH_DEBOUNCE_MS,
      // Provide onInvalidate field used by this structure.
      onInvalidate: () => setSearchPending(true),
      // Provide onCommit field used by this structure.
      onCommit: (q) => {
        // Update React state so the UI reflects the new value.
        setSearchPending(false);
        // Update React state so the UI reflects the new value.
        setCommittedQuery(q);
      },
    }),
  );

  // Run side effects after render when dependencies change.
  useEffect(() => {
    // Support the surrounding logic for this step.
    mountedRef.current = true;
    // Bind bridge for use in the following logic.
    const bridge = searchBridgeRef.current;
    // Return early result or rendered output from this path.
    return () => {
      // Support the surrounding logic for this step.
      mountedRef.current = false;
      // Invoke bridge.dispose to perform this step.
      bridge.dispose();
      // Unmount: late responses become stale.
      revisionRef.current++;
    };
  // Support the surrounding logic for this step.
  }, []);

  // A committed search reloads the people list only.
  useEffect(() => {
    // Conditional branch for the case described by this guard.
    if (initialLoading) return;
    // Conditional branch for the case described by this guard.
    if (!enabled) return;
    // Fire-and-forget async work without awaiting in this path.
    void load({ silent: false }).catch((err) => {
      // Conditional branch for the case described by this guard.
      if (!mountedRef.current) return;
      // Invoke reportLoad to perform this step.
      reportLoad({
        // Provide status field used by this structure.
        status: "done",
        // Provide scope field used by this structure.
        scope: SCOPE,
        // Provide errors field used by this structure.
        errors: {
          // Provide people field used by this structure.
          people:
            // Support the surrounding logic for this step.
            err instanceof Error ? err.message : "Failed to search people",
        },
      });
      // Update React state so the UI reflects the new value.
      setPeopleLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedQuery]);

  // Memoize callback identity for stable child/effect deps.
  const onSearchInputChange = useCallback((raw: string) => {
    // Update React state so the UI reflects the new value.
    setSearchInput(raw);
    // Invoke searchBridgeRef.current.onInput to perform this step.
    searchBridgeRef.current.onInput(raw);
  // Support the surrounding logic for this step.
  }, []);

  /**
   * Manual Refresh: commit the typed query now. When it differs from the
   * committed one, the committed-query effect reloads people; otherwise the
   * caller reloads with `query`.
   */
  const commitSearchNow = useCallback((): {
    // Provide query field used by this structure.
    query: string;
    // Provide changed field used by this structure.
    changed: boolean;
  // Support the surrounding logic for this step.
  } => {
    // Bind query for use in the following logic.
    const query = searchBridgeRef.current.forceCommitFromInput();
    // Update React state so the UI reflects the new value.
    setSearchInput(searchBridgeRef.current.getInput());
    // Update React state so the UI reflects the new value.
    setSearchPending(false);
    // Bind changed for use in the following logic.
    const changed = query !== committedQueryRef.current;
    // Conditional branch for the case described by this guard.
    if (changed) setCommittedQuery(query);
    // Return early result or rendered output from this path.
    return { query, changed };
  // Support the surrounding logic for this step.
  }, []);

  // Memoize callback identity for stable child/effect deps.
  const saveRole = useCallback(
    // Support the surrounding logic for this step.
    async (person: Person) => {
      // Conditional branch for the case described by this guard.
      if (!person.userId || !person.role) return;
      // Bind next for use in the following logic.
      const next = roleDrafts[person.userId];
      // Conditional branch for the case described by this guard.
      if (!next || next === person.role) return;
      // Conditional branch for the case described by this guard.
      if (!beginSaving(person.userId)) return;
      // Update React state so the UI reflects the new value.
      setError(null);
      // Update React state so the UI reflects the new value.
      setMessage(null);
      // Update React state so the UI reflects the new value.
      setRefreshWarning(null);
      // Begin guarded block to catch runtime failures.
      try {
        // Wait for an async operation before continuing.
        await updatePersonRole(person.userId, next);
        // Begin guarded block to catch runtime failures.
        try {
          // Wait for an async operation before continuing.
          await Promise.all([
            // Invoke load to perform this step.
            load({
              // Provide silent field used by this structure.
              silent: true,
              // Provide replaceUserIds field used by this structure.
              replaceUserIds: new Set([person.userId]),
            }),
            // Invoke refreshAssignees to perform this step.
            refreshAssignees(),
          // Support the surrounding logic for this step.
          ]);
          // Update React state so the UI reflects the new value.
          setMessage(`Updated role for ${person.fullName}`);
          // Update React state so the UI reflects the new value.
          setRefreshWarning(null);
        // Support the surrounding logic for this step.
        } catch (err) {
          // Bind feedback for use in the following logic.
          const feedback = mergeMutationAndRefresh({
            // Provide successMessage field used by this structure.
            successMessage: `Updated role for ${person.fullName}`,
            // Provide refreshError field used by this structure.
            refreshError:
              // Support the surrounding logic for this step.
              err instanceof Error ? err.message : "Failed to refresh",
          });
          // Update React state so the UI reflects the new value.
          setMessage(feedback.message);
          // Update React state so the UI reflects the new value.
          setRefreshWarning(feedback.refreshWarning);
        }
      // Support the surrounding logic for this step.
      } catch (err) {
        // Update React state so the UI reflects the new value.
        setError(err instanceof Error ? err.message : "Failed to update role");
      // Support the surrounding logic for this step.
      } finally {
        // Invoke endSaving to perform this step.
        endSaving(person.userId);
      }
    },
    [
      // Support the surrounding logic for this step.
      beginSaving,
      // Support the surrounding logic for this step.
      endSaving,
      // Support the surrounding logic for this step.
      load,
      // Support the surrounding logic for this step.
      refreshAssignees,
      // Support the surrounding logic for this step.
      roleDrafts,
      // Support the surrounding logic for this step.
      setError,
      // Support the surrounding logic for this step.
      setMessage,
      // Support the surrounding logic for this step.
      setRefreshWarning,
    ],
  );

  // Return early result or rendered output from this path.
  return {
    // Support the surrounding logic for this step.
    people,
    // Support the surrounding logic for this step.
    roleDrafts,
    // Support the surrounding logic for this step.
    setRoleDrafts,
    // Support the surrounding logic for this step.
    searchInput,
    // Support the surrounding logic for this step.
    searchPending,
    // Support the surrounding logic for this step.
    peopleLoading,
    // Support the surrounding logic for this step.
    savingIds,
    // Support the surrounding logic for this step.
    onSearchInputChange,
    // Support the surrounding logic for this step.
    commitSearchNow,
    // Support the surrounding logic for this step.
    saveRole,
    // Support the surrounding logic for this step.
    load,
  };
}
