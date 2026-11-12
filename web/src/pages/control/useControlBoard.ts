/**
 * Control page composition. Each section hook owns its own data, drafts,
 * actions and refresh; this hook only owns what is genuinely shared:
 * permissions/load plan, page banners, per-section error slots, the initial
 * load gate, and live/manual refresh.
 *
 * Section ownership
 * - useControlPeople   roles list, role drafts, search, role saves
 * - useControlTickets  open/recent lists, assign picker + drafts, ticket busy
 * - useControlCleaning rooms/housekeepers pickers and task creation
 *
 * Which refresh touches which section
 * - initial load, live events, manual Refresh → all sections (`refreshAll`)
 * - committed role search                      → people only
 * - role save                                  → people + ticket assignees
 * - ticket action                              → ticket lists only
 * - task created                               → cleaning pickers only
 * A section without permission is skipped (no fetch, no error) and never
 * blocks the others; a failing section only fills its own error slot.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  assignableRolesFor,
  canPerformAction,
  type AuthUser,
} from "../../api/client";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import {
  bannerAfterLoad,
  controlLoadPlan,
  replaceSectionErrors,
  sectionErrorViews,
  type ControlSectionErrors,
  type SectionLoadResult,
} from "../controlPageState";
import type { ControlFeedback } from "./controlBoardTypes";
import { useControlCleaning } from "./useControlCleaning";
import { useControlPeople } from "./useControlPeople";
import { useControlTickets } from "./useControlTickets";

// Export function useControlBoard as part of this module's API.
export function useControlBoard(user: AuthUser) {
  // Memoize derived value to avoid recomputing every render.
  const allowedRoles = useMemo(
    () => assignableRolesFor(user.role),
    [user.role],
  );

  const canChangeRole = canPerformAction(user, "people.change_role");
  const canCreateCleaning = canPerformAction(user, "cleaning.create");
  const canAssign = canPerformAction(user, "tickets.assign");
  const canClose = canPerformAction(user, "tickets.close");
  const canResolve = canPerformAction(user, "tickets.resolve");
  const canWorkTickets = canAssign || canClose || canResolve;

  // Memoize derived value to avoid recomputing every render.
  const loadPlan = useMemo(
    () =>
      controlLoadPlan({
        canChangeRole,
        canCreateCleaning,
        canWorkTickets,
      }),
    [canChangeRole, canCreateCleaning, canWorkTickets],
  );

  const [initialLoading, setInitialLoading] = useState(true);
  const initialLoadingRef = useRef(true);
  initialLoadingRef.current = initialLoading;
  const mountedRef = useRef(true);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  // Memoize derived value to avoid recomputing every render.
  const feedback: ControlFeedback = useMemo(
    () => ({ setError, setMessage, setRefreshWarning }),
    [],
  );

  // Per-section error slots. A load replaces only the slots it covers.
  const [sectionErrors, setSectionErrors] = useState<ControlSectionErrors>({});
  const sectionErrorsRef = useRef<ControlSectionErrors>({});

  const reportLoad = useCallback((result: SectionLoadResult) => {
    if (result.status === "stale") return;
    const next = replaceSectionErrors(
      sectionErrorsRef.current,
      result.scope,
      result.errors,
    );
    sectionErrorsRef.current = next;
    setSectionErrors(next);
    const banner = bannerAfterLoad(next, initialLoadingRef.current);
    if (banner.action === "set") setError(banner.message);
    // Alternate branch when the previous guards did not match.
    else if (banner.action === "clear") setError(null);
  }, []);

  // Invoke useControlTickets hook for page/feature state and behavior.
  const tickets = useControlTickets({ plan: loadPlan, reportLoad });
  // Invoke useControlCleaning hook for page/feature state and behavior.
  const cleaning = useControlCleaning({
    plan: loadPlan,
    canCreate: canCreateCleaning,
    feedback,
    reportLoad,
  });
  // Invoke useControlPeople hook for page/feature state and behavior.
  const people = useControlPeople({
    enabled: loadPlan.people,
    initialLoading,
    feedback,
    reportLoad,
    refreshAssignees: tickets.loadAssignees,
  });

  const { load: loadPeople, commitSearchNow } = people;
  const { load: loadTickets } = tickets;
  const { load: loadCleaning } = cleaning;

  /** All sections in parallel; the first settled pass ends the initial load. */
  const refreshAll = useCallback(
    async (opts?: { silent?: boolean; peopleQuery?: string }) => {
      const results = await Promise.all([
        loadPeople({ silent: opts?.silent, query: opts?.peopleQuery }),
        loadTickets(),
        loadCleaning(),
      ]);
      const superseded = results.some((r) => r.status === "stale");
      if (initialLoadingRef.current && !superseded) {
        initialLoadingRef.current = false;
        setInitialLoading(false);
      }
    },
    [loadPeople, loadTickets, loadCleaning],
  );

  // Invoke useLiveRefresh hook for page/feature state and behavior.
  const liveAt = useLiveRefresh(
    () => {
      // Fire-and-forget async work without awaiting in this path.
      void refreshAll({ silent: true }).catch(() => undefined);
    },
    {
      enabled: !initialLoading,
      busy:
        people.savingIds.size > 0 ||
        tickets.busyIds.size > 0 ||
        cleaning.creatingTask,
      eventTypes: [
        "people.changed",
        "ticket.changed",
        "cleaning.changed",
        "location.changed",
        "settings.changed",
      ],
    },
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Fire-and-forget async work without awaiting in this path.
    void refreshAll().catch((err) => {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load control");
      setInitialLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onManualRefresh = useCallback(async () => {
    setError(null);
    setRefreshWarning(null);
    const { query, changed } = commitSearchNow();
    try {
      if (changed) {
        // People reload via the committed-query effect; refresh the rest here.
        await Promise.all([loadTickets(), loadCleaning()]);
        return;
      }
      await refreshAll({ peopleQuery: query });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh");
    }
  }, [commitSearchNow, loadCleaning, loadTickets, refreshAll]);

  const { peopleError, ticketsError, recentError, cleaningError } =
    sectionErrorViews(sectionErrors);

  return {
    user,
    allowedRoles,
    canChangeRole,
    canCreateCleaning,
    canAssign,
    canClose,
    canResolve,
    canWorkTickets,
    initialLoading,
    error,
    message,
    refreshWarning,
    liveAt,
    people: people.people,
    roleDrafts: people.roleDrafts,
    setRoleDrafts: people.setRoleDrafts,
    searchInput: people.searchInput,
    searchPending: people.searchPending,
    peopleLoading: people.peopleLoading,
    peopleError,
    onSearchInputChange: people.onSearchInputChange,
    saveRole: people.saveRole,
    savingIds: people.savingIds,
    rooms: cleaning.rooms,
    housekeepers: cleaning.housekeepers,
    taskRoomId: cleaning.taskRoomId,
    setTaskRoomId: cleaning.setTaskRoomId,
    taskAssignee: cleaning.taskAssignee,
    setTaskAssignee: cleaning.setTaskAssignee,
    taskPriority: cleaning.taskPriority,
    setTaskPriority: cleaning.setTaskPriority,
    creatingTask: cleaning.creatingTask,
    onCreateTask: cleaning.onCreateTask,
    cleaningError,
    tickets: tickets.tickets,
    resolvedTickets: tickets.resolvedTickets,
    ticketsError,
    recentError,
    technicians: tickets.technicians,
    assignDrafts: tickets.assignDrafts,
    setAssignDrafts: tickets.setAssignDrafts,
    busyIds: tickets.busyIds,
    beginBusy: tickets.beginBusy,
    endBusy: tickets.endBusy,
    refreshTickets: tickets.refreshLists,
    setError,
    setMessage,
    setRefreshWarning,
    onManualRefresh,
  };
}

export type ControlBoard = ReturnType<typeof useControlBoard>;
