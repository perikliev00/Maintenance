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
  // Support the surrounding logic for this step.
  useCallback,
  // Support the surrounding logic for this step.
  useEffect,
  // Support the surrounding logic for this step.
  useMemo,
  // Support the surrounding logic for this step.
  useRef,
  // Support the surrounding logic for this step.
  useState,
// Support the surrounding logic for this step.
} from "react";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  assignableRolesFor,
  // Support the surrounding logic for this step.
  canPerformAction,
  // Declare type alias AuthUser.
  type AuthUser,
// Support the surrounding logic for this step.
} from "../../api/client";
// Import module dependency from ../../hooks/useLiveRefresh.
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  bannerAfterLoad,
  // Support the surrounding logic for this step.
  controlLoadPlan,
  // Support the surrounding logic for this step.
  replaceSectionErrors,
  // Support the surrounding logic for this step.
  sectionErrorViews,
  // Declare type alias ControlSectionErrors.
  type ControlSectionErrors,
  // Declare type alias SectionLoadResult.
  type SectionLoadResult,
// Support the surrounding logic for this step.
} from "../controlPageState";
// Import type-only dependency for typing without runtime cost.
import type { ControlFeedback } from "./controlBoardTypes";
// Import module dependency from ./useControlCleaning.
import { useControlCleaning } from "./useControlCleaning";
// Import module dependency from ./useControlPeople.
import { useControlPeople } from "./useControlPeople";
// Import module dependency from ./useControlTickets.
import { useControlTickets } from "./useControlTickets";

// Export function useControlBoard as part of this module's API.
export function useControlBoard(user: AuthUser) {
  // Memoize derived value to avoid recomputing every render.
  const allowedRoles = useMemo(
    // Support the surrounding logic for this step.
    () => assignableRolesFor(user.role),
    // Support the surrounding logic for this step.
    [user.role],
  );

  // Bind canChangeRole for use in the following logic.
  const canChangeRole = canPerformAction(user, "people.change_role");
  // Bind canCreateCleaning for use in the following logic.
  const canCreateCleaning = canPerformAction(user, "cleaning.create");
  // Bind canAssign for use in the following logic.
  const canAssign = canPerformAction(user, "tickets.assign");
  // Bind canClose for use in the following logic.
  const canClose = canPerformAction(user, "tickets.close");
  // Bind canResolve for use in the following logic.
  const canResolve = canPerformAction(user, "tickets.resolve");
  // Bind canWorkTickets for use in the following logic.
  const canWorkTickets = canAssign || canClose || canResolve;

  // Memoize derived value to avoid recomputing every render.
  const loadPlan = useMemo(
    // Support the surrounding logic for this step.
    () =>
      // Invoke controlLoadPlan to perform this step.
      controlLoadPlan({
        // Support the surrounding logic for this step.
        canChangeRole,
        // Support the surrounding logic for this step.
        canCreateCleaning,
        // Support the surrounding logic for this step.
        canWorkTickets,
      }),
    // Support the surrounding logic for this step.
    [canChangeRole, canCreateCleaning, canWorkTickets],
  );

  // React state slot for local UI/data that can change over time.
  const [initialLoading, setInitialLoading] = useState(true);
  // Hold a mutable ref that persists across renders without re-render.
  const initialLoadingRef = useRef(true);
  // Support the surrounding logic for this step.
  initialLoadingRef.current = initialLoading;
  // Hold a mutable ref that persists across renders without re-render.
  const mountedRef = useRef(true);

  // React state slot for local UI/data that can change over time.
  const [error, setError] = useState<string | null>(null);
  // React state slot for local UI/data that can change over time.
  const [message, setMessage] = useState<string | null>(null);
  // React state slot for local UI/data that can change over time.
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  // Memoize derived value to avoid recomputing every render.
  const feedback: ControlFeedback = useMemo(
    // Support the surrounding logic for this step.
    () => ({ setError, setMessage, setRefreshWarning }),
    // Support the surrounding logic for this step.
    [],
  );

  // Per-section error slots. A load replaces only the slots it covers.
  const [sectionErrors, setSectionErrors] = useState<ControlSectionErrors>({});
  // Bind sectionErrorsRef for use in the following logic.
  const sectionErrorsRef = useRef<ControlSectionErrors>({});

  // Memoize callback identity for stable child/effect deps.
  const reportLoad = useCallback((result: SectionLoadResult) => {
    // Conditional branch for the case described by this guard.
    if (result.status === "stale") return;
    // Bind next for use in the following logic.
    const next = replaceSectionErrors(
      // Support the surrounding logic for this step.
      sectionErrorsRef.current,
      // Support the surrounding logic for this step.
      result.scope,
      // Support the surrounding logic for this step.
      result.errors,
    );
    // Support the surrounding logic for this step.
    sectionErrorsRef.current = next;
    // Update React state so the UI reflects the new value.
    setSectionErrors(next);
    // Bind banner for use in the following logic.
    const banner = bannerAfterLoad(next, initialLoadingRef.current);
    // Conditional branch for the case described by this guard.
    if (banner.action === "set") setError(banner.message);
    // Alternate branch when the previous guards did not match.
    else if (banner.action === "clear") setError(null);
  // Support the surrounding logic for this step.
  }, []);

  // Invoke useControlTickets hook for page/feature state and behavior.
  const tickets = useControlTickets({ plan: loadPlan, reportLoad });
  // Invoke useControlCleaning hook for page/feature state and behavior.
  const cleaning = useControlCleaning({
    // Provide plan field used by this structure.
    plan: loadPlan,
    // Provide canCreate field used by this structure.
    canCreate: canCreateCleaning,
    // Support the surrounding logic for this step.
    feedback,
    // Support the surrounding logic for this step.
    reportLoad,
  });
  // Invoke useControlPeople hook for page/feature state and behavior.
  const people = useControlPeople({
    // Provide enabled field used by this structure.
    enabled: loadPlan.people,
    // Support the surrounding logic for this step.
    initialLoading,
    // Support the surrounding logic for this step.
    feedback,
    // Support the surrounding logic for this step.
    reportLoad,
    // Provide refreshAssignees field used by this structure.
    refreshAssignees: tickets.loadAssignees,
  });

  // Bind a local value for the following logic.
  const { load: loadPeople, commitSearchNow } = people;
  // Bind a local value for the following logic.
  const { load: loadTickets } = tickets;
  // Bind a local value for the following logic.
  const { load: loadCleaning } = cleaning;

  /** All sections in parallel; the first settled pass ends the initial load. */
  const refreshAll = useCallback(
    // Support the surrounding logic for this step.
    async (opts?: { silent?: boolean; peopleQuery?: string }) => {
      // Bind results for use in the following logic.
      const results = await Promise.all([
        // Invoke loadPeople to perform this step.
        loadPeople({ silent: opts?.silent, query: opts?.peopleQuery }),
        // Invoke loadTickets to perform this step.
        loadTickets(),
        // Invoke loadCleaning to perform this step.
        loadCleaning(),
      // Support the surrounding logic for this step.
      ]);
      // Bind superseded for use in the following logic.
      const superseded = results.some((r) => r.status === "stale");
      // Conditional branch for the case described by this guard.
      if (initialLoadingRef.current && !superseded) {
        // Support the surrounding logic for this step.
        initialLoadingRef.current = false;
        // Update React state so the UI reflects the new value.
        setInitialLoading(false);
      }
    },
    // Support the surrounding logic for this step.
    [loadPeople, loadTickets, loadCleaning],
  );

  // Invoke useLiveRefresh hook for page/feature state and behavior.
  const liveAt = useLiveRefresh(
    // Support the surrounding logic for this step.
    () => {
      // Fire-and-forget async work without awaiting in this path.
      void refreshAll({ silent: true }).catch(() => undefined);
    },
    {
      // Provide enabled field used by this structure.
      enabled: !initialLoading,
      // Provide busy field used by this structure.
      busy:
        // Support the surrounding logic for this step.
        people.savingIds.size > 0 ||
        // Support the surrounding logic for this step.
        tickets.busyIds.size > 0 ||
        // Support the surrounding logic for this step.
        cleaning.creatingTask,
      // Provide eventTypes field used by this structure.
      eventTypes: [
        // Support the surrounding logic for this step.
        "people.changed",
        // Support the surrounding logic for this step.
        "ticket.changed",
        // Support the surrounding logic for this step.
        "cleaning.changed",
        // Support the surrounding logic for this step.
        "location.changed",
        // Support the surrounding logic for this step.
        "settings.changed",
      ],
    },
  );

  // Run side effects after render when dependencies change.
  useEffect(() => {
    // Support the surrounding logic for this step.
    mountedRef.current = true;
    // Return early result or rendered output from this path.
    return () => {
      // Support the surrounding logic for this step.
      mountedRef.current = false;
    };
  // Support the surrounding logic for this step.
  }, []);

  // Run side effects after render when dependencies change.
  useEffect(() => {
    // Fire-and-forget async work without awaiting in this path.
    void refreshAll().catch((err) => {
      // Conditional branch for the case described by this guard.
      if (!mountedRef.current) return;
      // Update React state so the UI reflects the new value.
      setError(err instanceof Error ? err.message : "Failed to load control");
      // Update React state so the UI reflects the new value.
      setInitialLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Memoize callback identity for stable child/effect deps.
  const onManualRefresh = useCallback(async () => {
    // Update React state so the UI reflects the new value.
    setError(null);
    // Update React state so the UI reflects the new value.
    setRefreshWarning(null);
    // Bind a local value for the following logic.
    const { query, changed } = commitSearchNow();
    // Begin guarded block to catch runtime failures.
    try {
      // Conditional branch for the case described by this guard.
      if (changed) {
        // People reload via the committed-query effect; refresh the rest here.
        await Promise.all([loadTickets(), loadCleaning()]);
        // Return early result or rendered output from this path.
        return;
      }
      // Wait for an async operation before continuing.
      await refreshAll({ peopleQuery: query });
    // Support the surrounding logic for this step.
    } catch (err) {
      // Update React state so the UI reflects the new value.
      setError(err instanceof Error ? err.message : "Failed to refresh");
    }
  // Support the surrounding logic for this step.
  }, [commitSearchNow, loadCleaning, loadTickets, refreshAll]);

  // Bind a local value for the following logic.
  const { peopleError, ticketsError, recentError, cleaningError } =
    // Invoke sectionErrorViews to perform this step.
    sectionErrorViews(sectionErrors);

  // Return early result or rendered output from this path.
  return {
    // Support the surrounding logic for this step.
    user,
    // Support the surrounding logic for this step.
    allowedRoles,
    // Support the surrounding logic for this step.
    canChangeRole,
    // Support the surrounding logic for this step.
    canCreateCleaning,
    // Support the surrounding logic for this step.
    canAssign,
    // Support the surrounding logic for this step.
    canClose,
    // Support the surrounding logic for this step.
    canResolve,
    // Support the surrounding logic for this step.
    canWorkTickets,
    // Support the surrounding logic for this step.
    initialLoading,
    // Support the surrounding logic for this step.
    error,
    // Support the surrounding logic for this step.
    message,
    // Support the surrounding logic for this step.
    refreshWarning,
    // Support the surrounding logic for this step.
    liveAt,
    // Provide people field used by this structure.
    people: people.people,
    // Provide roleDrafts field used by this structure.
    roleDrafts: people.roleDrafts,
    // Provide setRoleDrafts field used by this structure.
    setRoleDrafts: people.setRoleDrafts,
    // Provide searchInput field used by this structure.
    searchInput: people.searchInput,
    // Provide searchPending field used by this structure.
    searchPending: people.searchPending,
    // Provide peopleLoading field used by this structure.
    peopleLoading: people.peopleLoading,
    // Support the surrounding logic for this step.
    peopleError,
    // Provide onSearchInputChange field used by this structure.
    onSearchInputChange: people.onSearchInputChange,
    // Provide saveRole field used by this structure.
    saveRole: people.saveRole,
    // Provide savingIds field used by this structure.
    savingIds: people.savingIds,
    // Provide rooms field used by this structure.
    rooms: cleaning.rooms,
    // Provide housekeepers field used by this structure.
    housekeepers: cleaning.housekeepers,
    // Provide taskRoomId field used by this structure.
    taskRoomId: cleaning.taskRoomId,
    // Provide setTaskRoomId field used by this structure.
    setTaskRoomId: cleaning.setTaskRoomId,
    // Provide taskAssignee field used by this structure.
    taskAssignee: cleaning.taskAssignee,
    // Provide setTaskAssignee field used by this structure.
    setTaskAssignee: cleaning.setTaskAssignee,
    // Provide taskPriority field used by this structure.
    taskPriority: cleaning.taskPriority,
    // Provide setTaskPriority field used by this structure.
    setTaskPriority: cleaning.setTaskPriority,
    // Provide creatingTask field used by this structure.
    creatingTask: cleaning.creatingTask,
    // Provide onCreateTask field used by this structure.
    onCreateTask: cleaning.onCreateTask,
    // Support the surrounding logic for this step.
    cleaningError,
    // Provide tickets field used by this structure.
    tickets: tickets.tickets,
    // Provide resolvedTickets field used by this structure.
    resolvedTickets: tickets.resolvedTickets,
    // Support the surrounding logic for this step.
    ticketsError,
    // Support the surrounding logic for this step.
    recentError,
    // Provide technicians field used by this structure.
    technicians: tickets.technicians,
    // Provide assignDrafts field used by this structure.
    assignDrafts: tickets.assignDrafts,
    // Provide setAssignDrafts field used by this structure.
    setAssignDrafts: tickets.setAssignDrafts,
    // Provide busyIds field used by this structure.
    busyIds: tickets.busyIds,
    // Provide beginBusy field used by this structure.
    beginBusy: tickets.beginBusy,
    // Provide endBusy field used by this structure.
    endBusy: tickets.endBusy,
    // Provide refreshTickets field used by this structure.
    refreshTickets: tickets.refreshLists,
    // Support the surrounding logic for this step.
    setError,
    // Support the surrounding logic for this step.
    setMessage,
    // Support the surrounding logic for this step.
    setRefreshWarning,
    // Support the surrounding logic for this step.
    onManualRefresh,
  };
}

// Export type definition for consumers of this module.
export type ControlBoard = ReturnType<typeof useControlBoard>;
