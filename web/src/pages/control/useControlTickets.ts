/**
 * Control ticket section: open + recent (resolved/closed) lists, the
 * technician assign picker, assign drafts, and per-ticket busy ids.
 *
 * Refresh scopes (each has its own stale-response guard, so one never drops
 * the other's response):
 * - `loadLists`      open / resolved / closed ticket lists
 * - `loadAssignees`  technician picker feed (independent of the Roles search)
 * - `load`           both (initial load, live events, manual Refresh)
 * Ticket actions refresh `loadLists` only; a role change refreshes
 * `loadAssignees`. Missing ticket permission skips fetches without affecting
 * People or Cleaning.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  fetchPeople,
  // Support the surrounding logic for this step.
  fetchTickets,
  // Declare type alias MaintenanceTicket.
  type MaintenanceTicket,
  // Declare type alias Person.
  type Person,
// Support the surrounding logic for this step.
} from "../../api/client";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  mergeRecentTickets,
  // Support the surrounding logic for this step.
  sectionFromSettled,
  // Support the surrounding logic for this step.
  settleOptional,
  // Support the surrounding logic for this step.
  shouldApplyControlRefresh,
  // Support the surrounding logic for this step.
  techniciansFromPeople,
  // Declare type alias ControlSectionErrors.
  type ControlSectionErrors,
  // Declare type alias SectionLoadResult.
  type SectionLoadResult,
// Support the surrounding logic for this step.
} from "../controlPageState";
// Import module dependency from ../locations/busyIds.
import { addBusyId, removeBusyId } from "../locations/busyIds";
// Import type-only dependency for typing without runtime cost.
import type { ReportLoad } from "./controlBoardTypes";

// Bind LIST_LIMIT for use in the following logic.
const LIST_LIMIT = 20;

// Initialize an array used by subsequent logic.
const LISTS_SCOPE = ["openTickets", "resolvedTickets", "closedTickets"] as const;
// Initialize an array used by subsequent logic.
const ASSIGNEES_SCOPE = ["assignees"] as const;

// Declare type alias Options.
type Options = {
  /** `controlLoadPlan` slots for this section. */
  plan: { assignees: boolean; openTickets: boolean; recentTickets: boolean };
  // Provide reportLoad field used by this structure.
  reportLoad: ReportLoad;
};

// Export function useControlTickets as part of this module's API.
export function useControlTickets({ plan, reportLoad }: Options) {
  // React state slot for local UI/data that can change over time.
  const [assignees, setAssignees] = useState<Person[]>([]);
  // React state slot for local UI/data that can change over time.
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  // React state slot for local UI/data that can change over time.
  const [resolvedTickets, setResolvedTickets] = useState<MaintenanceTicket[]>(
    // Support the surrounding logic for this step.
    [],
  );
  // React state slot for local UI/data that can change over time.
  const [assignDrafts, setAssignDrafts] = useState<Record<string, string>>({});
  // React state slot for local UI/data that can change over time.
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(
    // Support the surrounding logic for this step.
    () => new Set(),
  );
  // Create a Set/Map for efficient membership or keyed lookup.
  const busyIdsRef = useRef<Set<string>>(new Set());
  // Hold a mutable ref that persists across renders without re-render.
  const listsRevisionRef = useRef(0);
  // Hold a mutable ref that persists across renders without re-render.
  const assigneesRevisionRef = useRef(0);

  // Memoize derived value to avoid recomputing every render.
  const technicians = useMemo(
    // Support the surrounding logic for this step.
    () => techniciansFromPeople(assignees),
    // Support the surrounding logic for this step.
    [assignees],
  );

  // Memoize callback identity for stable child/effect deps.
  const beginBusy = useCallback((id: string) => {
    // Conditional branch for the case described by this guard.
    if (busyIdsRef.current.has(id)) return false;
    // Support the surrounding logic for this step.
    busyIdsRef.current = addBusyId(busyIdsRef.current, id);
    // Update React state so the UI reflects the new value.
    setBusyIds(busyIdsRef.current);
    // Return early result or rendered output from this path.
    return true;
  // Support the surrounding logic for this step.
  }, []);

  // Memoize callback identity for stable child/effect deps.
  const endBusy = useCallback((id: string) => {
    // Support the surrounding logic for this step.
    busyIdsRef.current = removeBusyId(busyIdsRef.current, id);
    // Update React state so the UI reflects the new value.
    setBusyIds(busyIdsRef.current);
  // Support the surrounding logic for this step.
  }, []);

  // Run side effects after render when dependencies change.
  useEffect(
    // Support the surrounding logic for this step.
    () => () => {
      // Unmount: late responses become stale.
      listsRevisionRef.current++;
      // Support the surrounding logic for this step.
      assigneesRevisionRef.current++;
    },
    // Support the surrounding logic for this step.
    [],
  );

  // Memoize callback identity for stable child/effect deps.
  const loadAssignees = useCallback(async (): Promise<SectionLoadResult> => {
    // Bind revision for use in the following logic.
    const revision = ++assigneesRevisionRef.current;
    // Conditional branch for the case described by this guard.
    if (!plan.assignees) return { status: "done", scope: [], errors: {} };

    // Bind settled for use in the following logic.
    const settled = await settleOptional(
      // Invoke fetchPeople to perform this step.
      fetchPeople({ includeInactive: true }),
    );
    // Conditional branch for the case described by this guard.
    if (!shouldApplyControlRefresh(revision, assigneesRevisionRef.current)) {
      // Return early result or rendered output from this path.
      return { status: "stale" };
    }

    // Initialize an object holding related fields.
    const errors: ControlSectionErrors = {};
    // Bind result for use in the following logic.
    const result = sectionFromSettled(settled, true);
    // Conditional branch for the case described by this guard.
    if (result.status === "ok") setAssignees(result.data);
    // Alternate branch when the previous guards did not match.
    else if (result.status === "error") errors.assignees = result.message;

    // Initialize an object holding related fields.
    const done: SectionLoadResult = {
      // Provide status field used by this structure.
      status: "done",
      // Provide scope field used by this structure.
      scope: ASSIGNEES_SCOPE,
      // Support the surrounding logic for this step.
      errors,
    };
    // Invoke reportLoad to perform this step.
    reportLoad(done);
    // Return early result or rendered output from this path.
    return done;
  // Support the surrounding logic for this step.
  }, [plan.assignees, reportLoad]);

  // Memoize callback identity for stable child/effect deps.
  const loadLists = useCallback(async (): Promise<SectionLoadResult> => {
    // Bind revision for use in the following logic.
    const revision = ++listsRevisionRef.current;
    // Conditional branch for the case described by this guard.
    if (!plan.openTickets && !plan.recentTickets) {
      // Return early result or rendered output from this path.
      return { status: "done", scope: [], errors: {} };
    }

    // Bind a local value for the following logic.
    const [openSettled, resolvedSettled, closedSettled] = await Promise.all([
      // Invoke settleOptional to perform this step.
      settleOptional(
        // Support the surrounding logic for this step.
        plan.openTickets
          // Support the surrounding logic for this step.
          ? fetchTickets({ limit: LIST_LIMIT, status: "open" })
          // Support the surrounding logic for this step.
          : null,
      ),
      // Invoke settleOptional to perform this step.
      settleOptional(
        // Support the surrounding logic for this step.
        plan.recentTickets
          // Support the surrounding logic for this step.
          ? fetchTickets({ limit: LIST_LIMIT, status: "resolved" })
          // Support the surrounding logic for this step.
          : null,
      ),
      // Invoke settleOptional to perform this step.
      settleOptional(
        // Support the surrounding logic for this step.
        plan.recentTickets
          // Support the surrounding logic for this step.
          ? fetchTickets({ limit: LIST_LIMIT, status: "closed" })
          // Support the surrounding logic for this step.
          : null,
      ),
    // Support the surrounding logic for this step.
    ]);
    // Conditional branch for the case described by this guard.
    if (!shouldApplyControlRefresh(revision, listsRevisionRef.current)) {
      // Return early result or rendered output from this path.
      return { status: "stale" };
    }

    // Initialize an object holding related fields.
    const errors: ControlSectionErrors = {};
    // Bind open for use in the following logic.
    const open = sectionFromSettled(openSettled, plan.openTickets);
    // Bind resolved for use in the following logic.
    const resolved = sectionFromSettled(resolvedSettled, plan.recentTickets);
    // Bind closed for use in the following logic.
    const closed = sectionFromSettled(closedSettled, plan.recentTickets);

    // Conditional branch for the case described by this guard.
    if (open.status === "ok") setTickets(open.data);
    // Alternate branch when the previous guards did not match.
    else if (open.status === "error") errors.openTickets = open.message;

    // Bind recent for use in the following logic.
    const recent = mergeRecentTickets(
      // Support the surrounding logic for this step.
      resolved.status === "ok" ? resolved.data : undefined,
      // Support the surrounding logic for this step.
      closed.status === "ok" ? closed.data : undefined,
    );
    // Conditional branch for the case described by this guard.
    if (recent) setResolvedTickets(recent);
    // Conditional branch for the case described by this guard.
    if (resolved.status === "error") errors.resolvedTickets = resolved.message;
    // Conditional branch for the case described by this guard.
    if (closed.status === "error") errors.closedTickets = closed.message;

    // Initialize an object holding related fields.
    const done: SectionLoadResult = {
      // Provide status field used by this structure.
      status: "done",
      // Provide scope field used by this structure.
      scope: LISTS_SCOPE,
      // Support the surrounding logic for this step.
      errors,
    };
    // Invoke reportLoad to perform this step.
    reportLoad(done);
    // Return early result or rendered output from this path.
    return done;
  // Support the surrounding logic for this step.
  }, [plan.openTickets, plan.recentTickets, reportLoad]);

  /** Full section refresh; `stale` if either feed was superseded. */
  const load = useCallback(async (): Promise<SectionLoadResult> => {
    // Bind a local value for the following logic.
    const [assigneesResult, listsResult] = await Promise.all([
      // Invoke loadAssignees to perform this step.
      loadAssignees(),
      // Invoke loadLists to perform this step.
      loadLists(),
    // Support the surrounding logic for this step.
    ]);
    // Conditional branch for the case described by this guard.
    if (assigneesResult.status === "stale" || listsResult.status === "stale") {
      // Return early result or rendered output from this path.
      return { status: "stale" };
    }
    // Return early result or rendered output from this path.
    return {
      // Provide status field used by this structure.
      status: "done",
      // Provide scope field used by this structure.
      scope: [...assigneesResult.scope, ...listsResult.scope],
      // Provide errors field used by this structure.
      errors: { ...assigneesResult.errors, ...listsResult.errors },
    };
  // Support the surrounding logic for this step.
  }, [loadAssignees, loadLists]);

  /** Refresh after a ticket action: lists only. */
  const refreshLists = useCallback(async () => {
    // Wait for an async operation before continuing.
    await loadLists();
  // Support the surrounding logic for this step.
  }, [loadLists]);

  // Return early result or rendered output from this path.
  return {
    // Support the surrounding logic for this step.
    tickets,
    // Support the surrounding logic for this step.
    resolvedTickets,
    // Support the surrounding logic for this step.
    technicians,
    // Support the surrounding logic for this step.
    assignDrafts,
    // Support the surrounding logic for this step.
    setAssignDrafts,
    // Support the surrounding logic for this step.
    busyIds,
    // Support the surrounding logic for this step.
    beginBusy,
    // Support the surrounding logic for this step.
    endBusy,
    // Support the surrounding logic for this step.
    load,
    // Support the surrounding logic for this step.
    loadAssignees,
    // Support the surrounding logic for this step.
    refreshLists,
  };
}
