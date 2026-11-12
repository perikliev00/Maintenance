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
import {
  fetchPeople,
  fetchTickets,
  type MaintenanceTicket,
  type Person,
} from "../../api/client";
import {
  mergeRecentTickets,
  sectionFromSettled,
  settleOptional,
  shouldApplyControlRefresh,
  techniciansFromPeople,
  type ControlSectionErrors,
  type SectionLoadResult,
} from "../controlPageState";
import { addBusyId, removeBusyId } from "../locations/busyIds";
import type { ReportLoad } from "./controlBoardTypes";

const LIST_LIMIT = 20;

const LISTS_SCOPE = ["openTickets", "resolvedTickets", "closedTickets"] as const;
const ASSIGNEES_SCOPE = ["assignees"] as const;

type Options = {
  /** `controlLoadPlan` slots for this section. */
  plan: { assignees: boolean; openTickets: boolean; recentTickets: boolean };
  reportLoad: ReportLoad;
};

// Export function useControlTickets as part of this module's API.
export function useControlTickets({ plan, reportLoad }: Options) {
  const [assignees, setAssignees] = useState<Person[]>([]);
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [resolvedTickets, setResolvedTickets] = useState<MaintenanceTicket[]>(
    [],
  );
  const [assignDrafts, setAssignDrafts] = useState<Record<string, string>>({});
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const busyIdsRef = useRef<Set<string>>(new Set());
  const listsRevisionRef = useRef(0);
  const assigneesRevisionRef = useRef(0);

  // Memoize derived value to avoid recomputing every render.
  const technicians = useMemo(
    () => techniciansFromPeople(assignees),
    [assignees],
  );

  const beginBusy = useCallback((id: string) => {
    if (busyIdsRef.current.has(id)) return false;
    busyIdsRef.current = addBusyId(busyIdsRef.current, id);
    setBusyIds(busyIdsRef.current);
    return true;
  }, []);

  const endBusy = useCallback((id: string) => {
    busyIdsRef.current = removeBusyId(busyIdsRef.current, id);
    setBusyIds(busyIdsRef.current);
  }, []);

  useEffect(
    () => () => {
      // Unmount: late responses become stale.
      listsRevisionRef.current++;
      assigneesRevisionRef.current++;
    },
    [],
  );

  const loadAssignees = useCallback(async (): Promise<SectionLoadResult> => {
    const revision = ++assigneesRevisionRef.current;
    if (!plan.assignees) return { status: "done", scope: [], errors: {} };

    const settled = await settleOptional(
      fetchPeople({ includeInactive: true }),
    );
    if (!shouldApplyControlRefresh(revision, assigneesRevisionRef.current)) {
      return { status: "stale" };
    }

    const errors: ControlSectionErrors = {};
    const result = sectionFromSettled(settled, true);
    if (result.status === "ok") setAssignees(result.data);
    // Alternate branch when the previous guards did not match.
    else if (result.status === "error") errors.assignees = result.message;

    const done: SectionLoadResult = {
      status: "done",
      scope: ASSIGNEES_SCOPE,
      errors,
    };
    reportLoad(done);
    return done;
  }, [plan.assignees, reportLoad]);

  const loadLists = useCallback(async (): Promise<SectionLoadResult> => {
    const revision = ++listsRevisionRef.current;
    if (!plan.openTickets && !plan.recentTickets) {
      return { status: "done", scope: [], errors: {} };
    }

    const [openSettled, resolvedSettled, closedSettled] = await Promise.all([
      settleOptional(
        plan.openTickets
          ? fetchTickets({ limit: LIST_LIMIT, status: "open" })
          : null,
      ),
      settleOptional(
        plan.recentTickets
          ? fetchTickets({ limit: LIST_LIMIT, status: "resolved" })
          : null,
      ),
      settleOptional(
        plan.recentTickets
          ? fetchTickets({ limit: LIST_LIMIT, status: "closed" })
          : null,
      ),
    ]);
    if (!shouldApplyControlRefresh(revision, listsRevisionRef.current)) {
      return { status: "stale" };
    }

    const errors: ControlSectionErrors = {};
    const open = sectionFromSettled(openSettled, plan.openTickets);
    const resolved = sectionFromSettled(resolvedSettled, plan.recentTickets);
    const closed = sectionFromSettled(closedSettled, plan.recentTickets);

    if (open.status === "ok") setTickets(open.data);
    // Alternate branch when the previous guards did not match.
    else if (open.status === "error") errors.openTickets = open.message;

    const recent = mergeRecentTickets(
      resolved.status === "ok" ? resolved.data : undefined,
      closed.status === "ok" ? closed.data : undefined,
    );
    if (recent) setResolvedTickets(recent);
    if (resolved.status === "error") errors.resolvedTickets = resolved.message;
    if (closed.status === "error") errors.closedTickets = closed.message;

    const done: SectionLoadResult = {
      status: "done",
      scope: LISTS_SCOPE,
      errors,
    };
    reportLoad(done);
    return done;
  }, [plan.openTickets, plan.recentTickets, reportLoad]);

  /** Full section refresh; `stale` if either feed was superseded. */
  const load = useCallback(async (): Promise<SectionLoadResult> => {
    const [assigneesResult, listsResult] = await Promise.all([
      loadAssignees(),
      loadLists(),
    ]);
    if (assigneesResult.status === "stale" || listsResult.status === "stale") {
      return { status: "stale" };
    }
    return {
      status: "done",
      scope: [...assigneesResult.scope, ...listsResult.scope],
      errors: { ...assigneesResult.errors, ...listsResult.errors },
    };
  }, [loadAssignees, loadLists]);

  /** Refresh after a ticket action: lists only. */
  const refreshLists = useCallback(async () => {
    await loadLists();
  }, [loadLists]);

  return {
    tickets,
    resolvedTickets,
    technicians,
    assignDrafts,
    setAssignDrafts,
    busyIds,
    beginBusy,
    endBusy,
    load,
    loadAssignees,
    refreshLists,
  };
}
