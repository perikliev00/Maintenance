/**
 * Manager control desk: role edits, create cleaning tasks, and ticket
 * assign/close/reopen/lifecycle. Role changes are limited by `assignableRolesFor`.
 */
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ROLE_LABELS,
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
} from "../api/client";
import { TicketLifecycleActions } from "../components/TicketLifecycleActions";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import {
  assignTicketQueued,
  closeTicketQueued,
  reopenTicketQueued,
} from "../offline";
import { addBusyId, removeBusyId } from "./locations/busyIds";
import { createDebouncedSearch } from "./team/debouncedSearch";
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
  taskAssigneeSelectValue,
  techniciansFromPeople,
  type TaskAssigneeState,
} from "./controlPageState";

type Props = {
  user: AuthUser;
};

const SEARCH_DEBOUNCE_MS = 300;

type HousekeeperOption = {
  id: string;
  fullName: string;
  employeeNumber: string;
};

type SectionErrors = Partial<Record<string, string>>;

/**
 * Manager control desk: role edits, create cleaning tasks, and ticket
 * assign/close/reopen/lifecycle. Role changes are limited by `assignableRolesFor`.
 */
export function ControlPage({ user }: Props) {
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

  /**
   * Load permitted sections independently. Stale generations are ignored.
   * `peopleQuery` overrides the committed search for flush-on-refresh.
   */
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
    // Initial boot only — subsequent loads go through committedQuery / manual refresh.
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

  async function saveRole(person: Person) {
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
  }

  async function onCreateTask(e: FormEvent) {
    e.preventDefault();
    if (!taskRoomId || !canCreateCleaning) return;
    setCreatingTask(true);
    setError(null);
    setMessage(null);
    setRefreshWarning(null);
    try {
      const due = new Date();
      due.setHours(due.getHours() + 4);
      await createCleaningTask({
        locationId: taskRoomId,
        hotelDate: todayHotelDate(),
        priority: taskPriority,
        assignedEmployeeId: assignedEmployeeIdPayload(taskAssignee),
        dueAt: due.toISOString(),
      });
      try {
        await refresh({ silent: true });
        setMessage("Cleaning task created");
        setRefreshWarning(null);
      } catch (err) {
        const feedback = mergeMutationAndRefresh({
          successMessage: "Cleaning task created",
          refreshError:
            err instanceof Error ? err.message : "Failed to refresh",
        });
        setMessage(feedback.message);
        setRefreshWarning(feedback.refreshWarning);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setCreatingTask(false);
    }
  }

  async function onManualRefresh() {
    setError(null);
    setRefreshWarning(null);
    const q = searchBridgeRef.current.forceCommitFromInput();
    setSearchInput(searchBridgeRef.current.getInput());
    setSearchPending(false);
    // Avoid a duplicate fetch when the committed query also changes.
    if (q !== committedQuery) {
      setCommittedQuery(q);
      return;
    }
    try {
      await refresh({ peopleQuery: q });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh");
    }
  }

  async function runTicketMutation(
    ticketId: string,
    action: () => Promise<{ queued: boolean }>,
    successMessage: string,
    queuedMessage: string,
  ) {
    if (!beginBusy(ticketId)) return;
    setError(null);
    setRefreshWarning(null);
    try {
      const result = await action();
      const okMessage = result.queued ? queuedMessage : successMessage;
      if (result.queued) {
        setMessage(okMessage);
        return;
      }
      try {
        await refresh({ silent: true });
        setMessage(okMessage);
        setRefreshWarning(null);
      } catch (err) {
        const feedback = mergeMutationAndRefresh({
          successMessage: okMessage,
          refreshError:
            err instanceof Error ? err.message : "Failed to refresh",
        });
        setMessage(feedback.message);
        setRefreshWarning(feedback.refreshWarning);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      endBusy(ticketId);
    }
  }

  const peopleError = sectionErrors.people;
  const ticketsError =
    sectionErrors.openTickets ?? sectionErrors.assignees;
  const recentError =
    sectionErrors.resolvedTickets ?? sectionErrors.closedTickets;
  const cleaningError = sectionErrors.rooms ?? sectionErrors.housekeepers;

  return (
    <main className="content">
      <header className="page-header">
        <div>
          <h1>Control</h1>
          <p>Роли, задачи за почистване и отворени проблеми</p>
        </div>
      </header>

      {user.role === "owner" && (
        <div className="owner-banner">
          Роля собственик — пълен контрол: всички роли, всички панели, всички
          действия
        </div>
      )}
      {error && <div className="error banner">{error}</div>}
      {message && <div className="ok banner">{message}</div>}
      {refreshWarning && (
        <div className="error banner" role="status">
          {refreshWarning}
        </div>
      )}

      {initialLoading ? (
        <p className="muted">Loading control…</p>
      ) : (
        <div className="control-grid">
          {canChangeRole && (
            <section className="panel">
              <div className="panel-header">
                <h2>Роли</h2>
                <label className="inline-search">
                  Search
                  <input
                    value={searchInput}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setSearchInput(raw);
                      searchBridgeRef.current.onInput(raw);
                    }}
                    placeholder="Name, email…"
                  />
                </label>
                {(searchPending || peopleLoading) && (
                  <span className="muted">Searching…</span>
                )}
              </div>
              {peopleError && (
                <p className="error">{peopleError}</p>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Number</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {people
                      .filter((p) => p.userId && p.role)
                      .map((person) => {
                        const draft =
                          roleDrafts[person.userId!] ??
                          (person.role as Role);
                        const options =
                          user.role === "owner"
                            ? allowedRoles
                            : Array.from(
                                new Set([
                                  ...allowedRoles,
                                  person.role as Role,
                                ]),
                              ).filter(
                                (r) =>
                                  allowedRoles.includes(r) ||
                                  r === person.role,
                              );
                        const locked =
                          user.role === "manager" &&
                          (person.role === "owner" ||
                            person.role === "admin");
                        const saving = savingIds.has(person.userId!);

                        return (
                          <tr key={person.userId}>
                            <td>{person.fullName}</td>
                            <td>{person.employeeNumber}</td>
                            <td>{person.email}</td>
                            <td>
                              <select
                                value={draft}
                                disabled={locked || saving}
                                onChange={(e) =>
                                  setRoleDrafts((prev) => ({
                                    ...prev,
                                    [person.userId!]: e.target
                                      .value as Role,
                                  }))
                                }
                              >
                                {options.map((r) => (
                                  <option key={r} value={r}>
                                    {ROLE_LABELS[r]} ({r})
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <button
                                type="button"
                                disabled={
                                  locked ||
                                  saving ||
                                  draft === person.role
                                }
                                onClick={() => void saveRole(person)}
                              >
                                {saving ? "Saving…" : "Save"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {canCreateCleaning && (
            <section className="panel">
              <h2>Създай задача за почистване</h2>
              {cleaningError && <p className="error">{cleaningError}</p>}
              <form className="report-form" onSubmit={onCreateTask}>
                <label>
                  Стая
                  <select
                    value={taskRoomId}
                    onChange={(e) => setTaskRoomId(e.target.value)}
                    required
                  >
                    {rooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.buildingCode} {room.number}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Камериер
                  <select
                    value={taskAssigneeSelectValue(taskAssignee)}
                    onChange={(e) =>
                      setTaskAssignee({
                        status: "chosen",
                        employeeId: e.target.value,
                      })
                    }
                  >
                    <option value="">Unassigned</option>
                    {housekeepers.map((hk) => (
                      <option key={hk.id} value={hk.id}>
                        {hk.fullName} ({hk.employeeNumber})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Приоритет
                  <select
                    value={taskPriority}
                    onChange={(e) => setTaskPriority(e.target.value)}
                  >
                    <option value="low">low</option>
                    <option value="normal">normal</option>
                    <option value="high">high</option>
                    <option value="urgent">urgent</option>
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={creatingTask || !taskRoomId}
                >
                  {creatingTask ? "Creating…" : "Create task"}
                </button>
              </form>
            </section>
          )}

          {canWorkTickets && (
            <section className="panel control-issues">
              <div className="panel-header">
                <h2>Отворени проблеми</h2>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void onManualRefresh()}
                >
                  Refresh
                </button>
                {liveAt && (
                  <span className="muted live-stamp" title={liveAt}>
                    live
                  </span>
                )}
              </div>
              {ticketsError && <p className="error">{ticketsError}</p>}
              {tickets.length === 0 ? (
                <p className="muted">Няма отворени проблеми.</p>
              ) : (
                <ul className="issue-feed">
                  {tickets.map((ticket) => {
                    const ticketBusy = busyIds.has(ticket.id);
                    return (
                      <li
                        key={ticket.id}
                        className={`issue-card priority-${ticket.priority}`}
                      >
                        <div className="issue-card-top">
                          <strong>
                            {ticket.location.floor.building.code}{" "}
                            {ticket.location.number}
                          </strong>
                          <span
                            className={`pill priority-${ticket.priority}`}
                          >
                            {ticket.priority}
                          </span>
                          <span className="pill">{ticket.status}</span>
                        </div>
                        <p className="issue-title">{ticket.title}</p>
                        <div className="issue-meta muted">
                          <span>{ticket.reportedBy.fullName}</span>
                          <span>
                            {new Date(ticket.openedAt).toLocaleString()}
                          </span>
                          {ticket.assignee && (
                            <span>→ {ticket.assignee.fullName}</span>
                          )}
                        </div>
                        {canAssign &&
                          (ticket.status === "new" ||
                            ticket.status === "assigned") && (
                            <div
                              className="actions"
                              style={{
                                marginTop: "0.5rem",
                                gap: "0.35rem",
                              }}
                            >
                              <select
                                value={
                                  assignDrafts[ticket.id] ??
                                  ticket.assignee?.id ??
                                  technicians[0]?.id ??
                                  ""
                                }
                                onChange={(e) =>
                                  setAssignDrafts((prev) => ({
                                    ...prev,
                                    [ticket.id]: e.target.value,
                                  }))
                                }
                              >
                                {technicians.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.fullName}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="subtle"
                                disabled={
                                  ticketBusy ||
                                  !(
                                    assignDrafts[ticket.id] ??
                                    ticket.assignee?.id ??
                                    technicians[0]?.id
                                  )
                                }
                                onClick={() => {
                                  const assigneeId =
                                    assignDrafts[ticket.id] ??
                                    ticket.assignee?.id ??
                                    technicians[0]?.id;
                                  if (!assigneeId) return;
                                  void runTicketMutation(
                                    ticket.id,
                                    () =>
                                      assignTicketQueued(
                                        ticket.id,
                                        assigneeId,
                                      ),
                                    "Тикетът е възложен",
                                    "Назначаване в опашката",
                                  );
                                }}
                              >
                                Assign
                              </button>
                            </div>
                          )}
                        <TicketLifecycleActions
                          ticket={ticket}
                          busy={ticketBusy}
                          canResolve={canResolve}
                          onBusy={(id) => {
                            if (id) return beginBusy(ticket.id);
                            endBusy(ticket.id);
                            return true;
                          }}
                          onDone={(result) => {
                            setMessage(result.message);
                            setError(null);
                            void refresh({ silent: true }).catch((err) => {
                              setRefreshWarning(
                                err instanceof Error
                                  ? err.message
                                  : "Failed to refresh",
                              );
                            });
                          }}
                          onError={(msg) => setError(msg)}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {canWorkTickets && (
            <section className="panel control-issues">
              <div className="panel-header">
                <h2>Наскоро резолвнати</h2>
              </div>
              {recentError && <p className="error">{recentError}</p>}
              {resolvedTickets.length === 0 ? (
                <p className="muted">Няма резолвнати проблеми.</p>
              ) : (
                <ul className="issue-feed">
                  {resolvedTickets.map((ticket) => {
                    const ticketBusy = busyIds.has(ticket.id);
                    return (
                      <li
                        key={ticket.id}
                        className={`issue-card priority-${ticket.priority}`}
                      >
                        <div className="issue-card-top">
                          <strong>
                            {ticket.location.floor.building.code}{" "}
                            {ticket.location.number}
                          </strong>
                          <span className="pill ready-ready">
                            {ticket.status}
                          </span>
                        </div>
                        <p className="issue-title">{ticket.title}</p>
                        <div className="issue-meta muted">
                          <span>
                            {ticket.resolvedBy
                              ? ticket.resolvedBy.fullName
                              : "—"}
                          </span>
                          <span>
                            {ticket.resolvedAt
                              ? new Date(
                                  ticket.resolvedAt,
                                ).toLocaleString()
                              : "—"}
                          </span>
                        </div>
                        {ticket.resolutionNotes && (
                          <p className="muted">{ticket.resolutionNotes}</p>
                        )}
                        <div
                          className="actions"
                          style={{ marginTop: "0.5rem", gap: "0.35rem" }}
                        >
                          {canClose && ticket.status === "resolved" && (
                            <button
                              type="button"
                              className="subtle"
                              disabled={ticketBusy}
                              onClick={() =>
                                void runTicketMutation(
                                  ticket.id,
                                  () => closeTicketQueued(ticket.id),
                                  "Тикетът е затворен",
                                  "Затваряне в опашката",
                                )
                              }
                            >
                              Close
                            </button>
                          )}
                          {canResolve && (
                            <button
                              type="button"
                              className="subtle"
                              disabled={ticketBusy}
                              onClick={() => {
                                const reason = window.prompt(
                                  "Причина за повторно отваряне (опционално)",
                                );
                                if (reason === null) return;
                                void runTicketMutation(
                                  ticket.id,
                                  () =>
                                    reopenTicketQueued(ticket.id, reason),
                                  "Issue reopened",
                                  "Повторно отваряне в опашката",
                                );
                              }}
                            >
                              Reopen
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </main>
  );
}
