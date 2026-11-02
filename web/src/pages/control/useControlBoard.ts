import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  assignableRolesFor,
  canPerformAction,
  createCleaningTask,
  fetchHousekeepers,
  fetchPeople,
  fetchRooms,
  fetchTickets,
  todayHotelDate,
  updatePersonRole,
  type AuthUser,
  type MaintenanceTicket,
  type Person,
  type Role,
  type Room,
} from "../../api/client";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { executeMutationWithRefresh } from "../../saveRefresh";
import { addBusyId, removeBusyId } from "../locations/busyIds";
import { createDebouncedSearch } from "../team/debouncedSearch";
import {
  assignedEmployeeIdPayload,
  controlLoadPlan,
  defaultTaskAssigneeIfNeeded,
  formatRoleConflicts,
  mergeMutationAndRefresh,
  mergeRoleDraftsOnRefresh,
  sectionFromSettled,
  settleOptional,
  shouldApplyControlRefresh,
  techniciansFromPeople,
  type TaskAssigneeState,
} from "../controlPageState";

const SEARCH_DEBOUNCE_MS = 300;

type HousekeeperOption = {
  id: string;
  fullName: string;
  employeeNumber: string;
};

type SectionErrors = Partial<Record<string, string>>;

export function useControlBoard(user: AuthUser) {
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

  const loadPlan = useMemo(
    () =>
      controlLoadPlan({
        canChangeRole,
        canCreateCleaning,
        canWorkTickets,
      }),
    [canChangeRole, canCreateCleaning, canWorkTickets],
  );

  const [people, setPeople] = useState<Person[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, Role>>({});
  const roleDraftsRef = useRef<Record<string, Role>>({});
  const serverRolesRef = useRef<Record<string, Role>>({});
  const [searchInput, setSearchInput] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [searchPending, setSearchPending] = useState(false);
  roleDraftsRef.current = roleDrafts;

  const [assignees, setAssignees] = useState<Person[]>([]);
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [resolvedTickets, setResolvedTickets] = useState<MaintenanceTicket[]>(
    [],
  );
  const [rooms, setRooms] = useState<Room[]>([]);
  const [housekeepers, setHousekeepers] = useState<HousekeeperOption[]>([]);

  const [initialLoading, setInitialLoading] = useState(true);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [sectionErrors, setSectionErrors] = useState<SectionErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);

  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const savingIdsRef = useRef<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const busyIdsRef = useRef<Set<string>>(new Set());

  const [taskRoomId, setTaskRoomId] = useState("");
  const [taskAssignee, setTaskAssignee] = useState<TaskAssigneeState>({
    status: "uninitialized",
  });
  const [taskPriority, setTaskPriority] = useState("normal");
  const [creatingTask, setCreatingTask] = useState(false);
  const [assignDrafts, setAssignDrafts] = useState<Record<string, string>>({});

  const requestRevision = useRef(0);
  const mountedRef = useRef(true);
  const initialLoadingRef = useRef(true);
  const taskRoomIdRef = useRef(taskRoomId);
  taskRoomIdRef.current = taskRoomId;
  initialLoadingRef.current = initialLoading;

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
    [],
  );

  const refresh = useCallback(
    async (opts?: {
      silent?: boolean;
      peopleQuery?: string;
      replaceUserIds?: ReadonlySet<string>;
    }) => {
      const revision = ++requestRevision.current;
      const q =
        opts?.peopleQuery !== undefined
          ? opts.peopleQuery
          : committedQuery.trim();

      const markedPeopleLoading = !opts?.silent && loadPlan.people;
      if (markedPeopleLoading) setPeopleLoading(true);

      try {
        const [
          peopleSettled,
          assigneesSettled,
          openSettled,
          resolvedSettled,
          closedSettled,
          roomsSettled,
          hkSettled,
        ] = await Promise.all([
          settleOptional(
            loadPlan.people
              ? fetchPeople({ q: q || undefined, includeInactive: true })
              : null,
          ),
          settleOptional(
            loadPlan.assignees
              ? fetchPeople({ includeInactive: true })
              : null,
          ),
          settleOptional(
            loadPlan.openTickets
              ? fetchTickets({ limit: 20, status: "open" })
              : null,
          ),
          settleOptional(
            loadPlan.recentTickets
              ? fetchTickets({ limit: 20, status: "resolved" })
              : null,
          ),
          settleOptional(
            loadPlan.recentTickets
              ? fetchTickets({ limit: 20, status: "closed" })
              : null,
          ),
          settleOptional(loadPlan.rooms ? fetchRooms() : null),
          settleOptional(loadPlan.housekeepers ? fetchHousekeepers() : null),
        ]);

        if (!shouldApplyControlRefresh(revision, requestRevision.current)) {
          return;
        }
        if (!mountedRef.current) return;

        const nextErrors: SectionErrors = {};
        const peopleResult = sectionFromSettled(
          peopleSettled,
          loadPlan.people,
        );
        const assigneesResult = sectionFromSettled(
          assigneesSettled,
          loadPlan.assignees,
        );
        const openResult = sectionFromSettled(
          openSettled,
          loadPlan.openTickets,
        );
        const resolvedResult = sectionFromSettled(
          resolvedSettled,
          loadPlan.recentTickets,
        );
        const closedResult = sectionFromSettled(
          closedSettled,
          loadPlan.recentTickets,
        );
        const roomsResult = sectionFromSettled(roomsSettled, loadPlan.rooms);
        const hkResult = sectionFromSettled(
          hkSettled,
          loadPlan.housekeepers,
        );

        if (peopleResult.status === "ok") {
          applyPeopleSection(peopleResult.data, {
            replaceUserIds: opts?.replaceUserIds,
          });
        } else if (peopleResult.status === "error") {
          nextErrors.people = peopleResult.message;
        }

        if (assigneesResult.status === "ok") {
          setAssignees(assigneesResult.data);
        } else if (assigneesResult.status === "error") {
          nextErrors.assignees = assigneesResult.message;
        }

        if (openResult.status === "ok") {
          setTickets(openResult.data);
        } else if (openResult.status === "error") {
          nextErrors.openTickets = openResult.message;
        }

        if (
          resolvedResult.status === "ok" ||
          closedResult.status === "ok"
        ) {
          const recentById = new Map<string, MaintenanceTicket>();
          if (resolvedResult.status === "ok") {
            for (const t of resolvedResult.data) recentById.set(t.id, t);
          }
          if (closedResult.status === "ok") {
            for (const t of closedResult.data) recentById.set(t.id, t);
          }
          setResolvedTickets([...recentById.values()]);
        }
        if (resolvedResult.status === "error") {
          nextErrors.resolvedTickets = resolvedResult.message;
        }
        if (closedResult.status === "error") {
          nextErrors.closedTickets = closedResult.message;
        }

        if (roomsResult.status === "ok") {
          setRooms(roomsResult.data);
          if (!taskRoomIdRef.current && roomsResult.data[0]) {
            setTaskRoomId(roomsResult.data[0].id);
          }
        } else if (roomsResult.status === "error") {
          nextErrors.rooms = roomsResult.message;
        }

        if (hkResult.status === "ok") {
          setHousekeepers(hkResult.data);
          setTaskAssignee((prev) =>
            defaultTaskAssigneeIfNeeded(prev, hkResult.data[0]?.id),
          );
        } else if (hkResult.status === "error") {
          nextErrors.housekeepers = hkResult.message;
        }

        setSectionErrors(nextErrors);
        const firstError = Object.values(nextErrors)[0];
        if (firstError && initialLoadingRef.current) setError(firstError);
        else if (!firstError) setError(null);
      } finally {
        if (
          mountedRef.current &&
          revision === requestRevision.current
        ) {
          if (markedPeopleLoading) setPeopleLoading(false);
          if (initialLoadingRef.current) {
            initialLoadingRef.current = false;
            setInitialLoading(false);
          }
        }
      }
    },
    [applyPeopleSection, committedQuery, loadPlan],
  );

  const liveAt = useLiveRefresh(
    () => {
      void refresh({ silent: true }).catch(() => undefined);
    },
    {
      enabled: !initialLoading,
      busy: savingIds.size > 0 || busyIds.size > 0 || creatingTask,
      eventTypes: [
        "people.changed",
        "ticket.changed",
        "cleaning.changed",
        "location.changed",
        "settings.changed",
      ],
    },
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
      requestRevision.current++;
    };
  }, []);

  useEffect(() => {
    void refresh().catch((err) => {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load control");
      setInitialLoading(false);
      setPeopleLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (initialLoading) return;
    if (!loadPlan.people) return;
    void refresh({ silent: false }).catch((err) => {
      if (!mountedRef.current) return;
      setSectionErrors((prev) => ({
        ...prev,
        people: err instanceof Error ? err.message : "Failed to search people",
      }));
      setPeopleLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedQuery]);

  const onSearchInputChange = useCallback((raw: string) => {
    setSearchInput(raw);
    searchBridgeRef.current.onInput(raw);
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
          await refresh({
            silent: true,
            replaceUserIds: new Set([person.userId]),
          });
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
    [beginSaving, endSaving, refresh, roleDrafts],
  );

  const onCreateTask = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!taskRoomId || !canCreateCleaning) return;
      setCreatingTask(true);
      setError(null);
      setMessage(null);
      setRefreshWarning(null);
      try {
        const due = new Date();
        due.setHours(due.getHours() + 4);
        const result = await executeMutationWithRefresh(
          () =>
            createCleaningTask({
              locationId: taskRoomId,
              hotelDate: todayHotelDate(),
              priority: taskPriority,
              assignedEmployeeId: assignedEmployeeIdPayload(taskAssignee),
              dueAt: due.toISOString(),
            }),
          async () => {
            await refresh({ silent: true });
          },
        );
        if (!result.ok) {
          setError(result.error || "Failed to create task");
          return;
        }
        setMessage("Cleaning task created");
        if (result.outcome === "saved_refresh_failed") {
          setRefreshWarning(result.refreshError ?? "Failed to refresh");
        } else {
          setRefreshWarning(null);
        }
      } finally {
        setCreatingTask(false);
      }
    },
    [canCreateCleaning, refresh, taskAssignee, taskPriority, taskRoomId],
  );

  const onManualRefresh = useCallback(async () => {
    setError(null);
    setRefreshWarning(null);
    const q = searchBridgeRef.current.forceCommitFromInput();
    setSearchInput(searchBridgeRef.current.getInput());
    setSearchPending(false);
    if (q !== committedQuery) {
      setCommittedQuery(q);
      return;
    }
    try {
      await refresh({ peopleQuery: q });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh");
    }
  }, [committedQuery, refresh]);

  const peopleError = sectionErrors.people;
  const ticketsError =
    sectionErrors.openTickets ?? sectionErrors.assignees;
  const recentError =
    sectionErrors.resolvedTickets ?? sectionErrors.closedTickets;
  const cleaningError = sectionErrors.rooms ?? sectionErrors.housekeepers;

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
    people,
    roleDrafts,
    setRoleDrafts,
    searchInput,
    searchPending,
    peopleLoading,
    peopleError,
    onSearchInputChange,
    saveRole,
    savingIds,
    rooms,
    housekeepers,
    taskRoomId,
    setTaskRoomId,
    taskAssignee,
    setTaskAssignee,
    taskPriority,
    setTaskPriority,
    creatingTask,
    onCreateTask,
    cleaningError,
    tickets,
    resolvedTickets,
    ticketsError,
    recentError,
    technicians,
    assignDrafts,
    setAssignDrafts,
    busyIds,
    beginBusy,
    endBusy,
    refresh,
    setError,
    setMessage,
    setRefreshWarning,
    onManualRefresh,
  };
}

export type ControlBoard = ReturnType<typeof useControlBoard>;
