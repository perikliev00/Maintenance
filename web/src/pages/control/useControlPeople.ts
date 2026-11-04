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
import {
  fetchPeople,
  updatePersonRole,
  type Person,
  type Role,
} from "../../api/client";
import { createDebouncedSearch } from "../team/debouncedSearch";
import { addBusyId, removeBusyId } from "../locations/busyIds";
import {
  formatRoleConflicts,
  mergeMutationAndRefresh,
  mergeRoleDraftsOnRefresh,
  sectionFromSettled,
  settleOptional,
  shouldApplyControlRefresh,
  type ControlSectionErrors,
  type SectionLoadResult,
} from "../controlPageState";
import type { ControlFeedback, ReportLoad } from "./controlBoardTypes";

const SEARCH_DEBOUNCE_MS = 300;

const SCOPE = ["people"] as const;

type LoadOptions = {
  /** Silent loads do not show the "Searching…" indicator. */
  silent?: boolean;
  /** Explicit query (manual Refresh); defaults to the committed query. */
  query?: string;
  /** Users whose draft is force-synced from the server (just saved). */
  replaceUserIds?: ReadonlySet<string>;
};

type Options = {
  /** `controlLoadPlan.people` (`people.change_role`). */
  enabled: boolean;
  /** Search-triggered reloads wait until the first page load settles. */
  initialLoading: boolean;
  feedback: ControlFeedback;
  reportLoad: ReportLoad;
  /** Refresh the ticket assignee picker after a role save. */
  refreshAssignees: () => Promise<unknown>;
};

export function useControlPeople({
  enabled,
  initialLoading,
  feedback: { setError, setMessage, setRefreshWarning },
  reportLoad,
  refreshAssignees,
}: Options) {
  const [people, setPeople] = useState<Person[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, Role>>({});
  const roleDraftsRef = useRef<Record<string, Role>>({});
  const serverRolesRef = useRef<Record<string, Role>>({});
  roleDraftsRef.current = roleDrafts;

  const [searchInput, setSearchInput] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [searchPending, setSearchPending] = useState(false);
  const committedQueryRef = useRef(committedQuery);
  committedQueryRef.current = committedQuery;

  const [peopleLoading, setPeopleLoading] = useState(false);
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const savingIdsRef = useRef<Set<string>>(new Set());

  const revisionRef = useRef(0);
  const mountedRef = useRef(true);

  const beginSaving = useCallback((id: string) => {
    if (savingIdsRef.current.has(id)) return false;
    savingIdsRef.current = addBusyId(savingIdsRef.current, id);
    setSavingIds(savingIdsRef.current);
    return true;
  }, []);

  const endSaving = useCallback((id: string) => {
    savingIdsRef.current = removeBusyId(savingIdsRef.current, id);
    setSavingIds(savingIdsRef.current);
  }, []);

  const applyPeopleSection = useCallback(
    (
      peopleData: Person[],
      opts?: { replaceUserIds?: ReadonlySet<string> },
    ) => {
      const merged = mergeRoleDraftsOnRefresh({
        prevDrafts: roleDraftsRef.current,
        prevServerRoles: serverRolesRef.current,
        nextPeople: peopleData,
        replaceUserIds: opts?.replaceUserIds,
        busyUserIds: savingIdsRef.current,
      });
      serverRolesRef.current = merged.serverRoles;
      roleDraftsRef.current = merged.drafts;
      setPeople(peopleData);
      setRoleDrafts(merged.drafts);
      const nameByUserId: Record<string, string> = {};
      for (const p of peopleData) {
        if (p.userId) nameByUserId[p.userId] = p.fullName;
      }
      const conflictMsg = formatRoleConflicts(merged.conflicts, nameByUserId);
      if (conflictMsg) setRefreshWarning(conflictMsg);
    },
    [setRefreshWarning],
  );

  const load = useCallback(
    async (opts?: LoadOptions): Promise<SectionLoadResult> => {
      const revision = ++revisionRef.current;
      if (!enabled) return { status: "done", scope: [], errors: {} };

      const q =
        opts?.query !== undefined
          ? opts.query
          : committedQueryRef.current.trim();
      const markLoading = !opts?.silent;
      if (markLoading) setPeopleLoading(true);

      try {
        const settled = await settleOptional(
          fetchPeople({ q: q || undefined, includeInactive: true }),
        );
        if (!shouldApplyControlRefresh(revision, revisionRef.current)) {
          return { status: "stale" };
        }

        const errors: ControlSectionErrors = {};
        const result = sectionFromSettled(settled, true);
        if (result.status === "ok") {
          applyPeopleSection(result.data, {
            replaceUserIds: opts?.replaceUserIds,
          });
        } else if (result.status === "error") {
          errors.people = result.message;
        }

        const done: SectionLoadResult = { status: "done", scope: SCOPE, errors };
        reportLoad(done);
        return done;
      } finally {
        if (markLoading && revision === revisionRef.current) {
          setPeopleLoading(false);
        }
      }
    },
    [applyPeopleSection, enabled, reportLoad],
  );

  const searchBridgeRef = useRef(
    createDebouncedSearch({
      debounceMs: SEARCH_DEBOUNCE_MS,
      onInvalidate: () => setSearchPending(true),
      onCommit: (q) => {
        setSearchPending(false);
        setCommittedQuery(q);
      },
    }),
  );

  useEffect(() => {
    mountedRef.current = true;
    const bridge = searchBridgeRef.current;
    return () => {
      mountedRef.current = false;
      bridge.dispose();
      // Unmount: late responses become stale.
      revisionRef.current++;
    };
  }, []);

  // A committed search reloads the people list only.
  useEffect(() => {
    if (initialLoading) return;
    if (!enabled) return;
    void load({ silent: false }).catch((err) => {
      if (!mountedRef.current) return;
      reportLoad({
        status: "done",
        scope: SCOPE,
        errors: {
          people:
            err instanceof Error ? err.message : "Failed to search people",
        },
      });
      setPeopleLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedQuery]);

  const onSearchInputChange = useCallback((raw: string) => {
    setSearchInput(raw);
    searchBridgeRef.current.onInput(raw);
  }, []);

  /**
   * Manual Refresh: commit the typed query now. When it differs from the
   * committed one, the committed-query effect reloads people; otherwise the
   * caller reloads with `query`.
   */
  const commitSearchNow = useCallback((): {
    query: string;
    changed: boolean;
  } => {
    const query = searchBridgeRef.current.forceCommitFromInput();
    setSearchInput(searchBridgeRef.current.getInput());
    setSearchPending(false);
    const changed = query !== committedQueryRef.current;
    if (changed) setCommittedQuery(query);
    return { query, changed };
  }, []);

  const saveRole = useCallback(
    async (person: Person) => {
      if (!person.userId || !person.role) return;
      const next = roleDrafts[person.userId];
      if (!next || next === person.role) return;
      if (!beginSaving(person.userId)) return;
      setError(null);
      setMessage(null);
      setRefreshWarning(null);
      try {
        await updatePersonRole(person.userId, next);
        try {
          await Promise.all([
            load({
              silent: true,
              replaceUserIds: new Set([person.userId]),
            }),
            refreshAssignees(),
          ]);
          setMessage(`Updated role for ${person.fullName}`);
          setRefreshWarning(null);
        } catch (err) {
          const feedback = mergeMutationAndRefresh({
            successMessage: `Updated role for ${person.fullName}`,
            refreshError:
              err instanceof Error ? err.message : "Failed to refresh",
          });
          setMessage(feedback.message);
          setRefreshWarning(feedback.refreshWarning);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update role");
      } finally {
        endSaving(person.userId);
      }
    },
    [
      beginSaving,
      endSaving,
      load,
      refreshAssignees,
      roleDrafts,
      setError,
      setMessage,
      setRefreshWarning,
    ],
  );

  return {
    people,
    roleDrafts,
    setRoleDrafts,
    searchInput,
    searchPending,
    peopleLoading,
    savingIds,
    onSearchInputChange,
    commitSearchNow,
    saveRole,
    load,
  };
}
