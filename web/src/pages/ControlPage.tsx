import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ROLE_LABELS,
  assignableRolesFor,
  assignIssue,
  canAssignIssues,
  canCloseIssues,
  canResolveIssues,
  closeIssue,
  createCleaningTask,
  fetchHousekeepers,
  fetchPeople,
  fetchRooms,
  fetchTickets,
  reopenIssue,
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

type Props = {
  user: AuthUser;
};

export function ControlPage({ user }: Props) {
  const allowedRoles = useMemo(
    () => assignableRolesFor(user.role),
    [user.role],
  );

  const [people, setPeople] = useState<Person[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, Role>>({});
  const [q, setQ] = useState("");
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [resolvedTickets, setResolvedTickets] = useState<MaintenanceTicket[]>(
    [],
  );
  const [rooms, setRooms] = useState<Room[]>([]);
  const [housekeepers, setHousekeepers] = useState<
    Array<{ id: string; fullName: string; employeeNumber: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const [taskRoomId, setTaskRoomId] = useState("");
  const [taskAssigneeId, setTaskAssigneeId] = useState("");
  const [taskPriority, setTaskPriority] = useState("normal");
  const [creatingTask, setCreatingTask] = useState(false);
  const [assignDrafts, setAssignDrafts] = useState<Record<string, string>>({});

  const canAssign = canAssignIssues(user.role);
  const canClose = canCloseIssues(user.role);
  const canResolve = canResolveIssues(user.role);

  const technicians = useMemo(
    () =>
      people.filter(
        (p) => p.role === "technician" || p.role === "supervisor",
      ),
    [people],
  );

  const refresh = useCallback(async () => {
    const [peopleData, ticketData, resolvedData, roomData, hkData] =
      await Promise.all([
        fetchPeople({ q: q.trim() || undefined, includeInactive: true }),
        fetchTickets({ limit: 20, status: "open" }),
        fetchTickets({ limit: 20, status: "resolved" }),
        fetchRooms(),
        fetchHousekeepers(),
      ]);
    setPeople(peopleData);
    setRoleDrafts(
      Object.fromEntries(
        peopleData
          .filter((p) => p.userId && p.role)
          .map((p) => [p.userId!, p.role!]),
      ) as Record<string, Role>,
    );
    setTickets(ticketData);
    setResolvedTickets(resolvedData);
    setRooms(roomData);
    setHousekeepers(hkData);
    if (!taskRoomId && roomData[0]) setTaskRoomId(roomData[0].id);
    if (!taskAssigneeId && hkData[0]) setTaskAssigneeId(hkData[0].id);
  }, [q, taskRoomId, taskAssigneeId]);

  const liveAt = useLiveRefresh(refresh, {
    enabled: !loading,
    busy:
      savingId !== null ||
      resolvingId !== null ||
      creatingTask,
    eventTypes: [
      "people.changed",
      "ticket.changed",
      "cleaning.changed",
      "location.changed",
      "settings.changed",
    ],
  });

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load control");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function saveRole(person: Person) {
    if (!person.userId || !person.role) return;
    const next = roleDrafts[person.userId];
    if (!next || next === person.role) return;
    setSavingId(person.userId);
    setError(null);
    setMessage(null);
    try {
      await updatePersonRole(person.userId, next);
      setMessage(`Updated role for ${person.fullName}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setSavingId(null);
    }
  }

  async function onCreateTask(e: FormEvent) {
    e.preventDefault();
    if (!taskRoomId) return;
    setCreatingTask(true);
    setError(null);
    setMessage(null);
    try {
      const due = new Date();
      due.setHours(due.getHours() + 4);
      await createCleaningTask({
        locationId: taskRoomId,
        hotelDate: todayHotelDate(),
        priority: taskPriority,
        assignedEmployeeId: taskAssigneeId || undefined,
        dueAt: due.toISOString(),
      });
      setMessage("Cleaning task created");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setCreatingTask(false);
    }
  }

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
          Роля собственик — пълен контрол: всички роли, всички панели, всички действия
        </div>
      )}
      {error && <div className="error banner">{error}</div>}
      {message && <div className="ok banner">{message}</div>}

      {loading ? (
        <p className="muted">Loading control…</p>
      ) : (
        <div className="control-grid">
          <section className="panel">
            <div className="panel-header">
              <h2>Роли</h2>
              <label className="inline-search">
                Search
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Name, email…"
                />
              </label>
            </div>
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
                      roleDrafts[person.userId!] ?? (person.role as Role);
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
                      (person.role === "owner" || person.role === "admin");

                    return (
                      <tr key={person.userId}>
                        <td>{person.fullName}</td>
                        <td>{person.employeeNumber}</td>
                        <td>{person.email}</td>
                        <td>
                          <select
                            value={draft}
                            disabled={locked}
                            onChange={(e) =>
                              setRoleDrafts((prev) => ({
                                ...prev,
                                [person.userId!]: e.target.value as Role,
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
                              savingId === person.userId ||
                              draft === person.role
                            }
                            onClick={() => saveRole(person)}
                          >
                            {savingId === person.userId ? "Saving…" : "Save"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <h2>Създай задача за почистване</h2>
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
                  value={taskAssigneeId}
                  onChange={(e) => setTaskAssigneeId(e.target.value)}
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
              <button type="submit" disabled={creatingTask || !taskRoomId}>
                {creatingTask ? "Creating…" : "Create task"}
              </button>
            </form>
          </section>

          <section className="panel control-issues">
            <div className="panel-header">
              <h2>Отворени проблеми</h2>
              <button type="button" className="ghost" onClick={() => refresh()}>
                Refresh
              </button>
              {liveAt && (
                <span className="muted live-stamp" title={liveAt}>
                  live
                </span>
              )}
            </div>
            {tickets.length === 0 ? (
              <p className="muted">Няма отворени проблеми.</p>
            ) : (
              <ul className="issue-feed">
                {tickets.map((ticket) => (
                  <li
                    key={ticket.id}
                    className={`issue-card priority-${ticket.priority}`}
                  >
                    <div className="issue-card-top">
                      <strong>
                        {ticket.location.floor.building.code}{" "}
                        {ticket.location.number}
                      </strong>
                      <span className={`pill priority-${ticket.priority}`}>
                        {ticket.priority}
                      </span>
                      <span className="pill">{ticket.status}</span>
                    </div>
                    <p className="issue-title">{ticket.title}</p>
                    <div className="issue-meta muted">
                      <span>{ticket.reportedBy.fullName}</span>
                      <span>{new Date(ticket.openedAt).toLocaleString()}</span>
                      {ticket.assignee && (
                        <span>→ {ticket.assignee.fullName}</span>
                      )}
                    </div>
                    {canAssign &&
                      (ticket.status === "new" ||
                        ticket.status === "assigned") && (
                        <div
                          className="actions"
                          style={{ marginTop: "0.5rem", gap: "0.35rem" }}
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
                              resolvingId === ticket.id ||
                              !(
                                assignDrafts[ticket.id] ??
                                ticket.assignee?.id ??
                                technicians[0]?.id
                              )
                            }
                            onClick={async () => {
                              const assigneeId =
                                assignDrafts[ticket.id] ??
                                ticket.assignee?.id ??
                                technicians[0]?.id;
                              if (!assigneeId) return;
                              setResolvingId(ticket.id);
                              setError(null);
                              try {
                                await assignIssue(ticket.id, assigneeId);
                                setMessage("Тикетът е възложен");
                                await refresh();
                              } catch (err) {
                                setError(
                                  err instanceof Error
                                    ? err.message
                                    : "Assign failed",
                                );
                              } finally {
                                setResolvingId(null);
                              }
                            }}
                          >
                            Assign
                          </button>
                        </div>
                      )}
                    <TicketLifecycleActions
                      ticket={ticket}
                      busy={resolvingId === ticket.id}
                      canResolve={canResolve}
                      onBusy={setResolvingId}
                      onDone={(result) => {
                        setMessage(result.message);
                        setError(null);
                        void refresh();
                      }}
                      onError={(msg) => setError(msg)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel control-issues">
            <div className="panel-header">
              <h2>Наскоро резолвнати</h2>
            </div>
            {resolvedTickets.length === 0 ? (
              <p className="muted">Няма резолвнати проблеми.</p>
            ) : (
              <ul className="issue-feed">
                {resolvedTickets.map((ticket) => (
                  <li
                    key={ticket.id}
                    className={`issue-card priority-${ticket.priority}`}
                  >
                    <div className="issue-card-top">
                      <strong>
                        {ticket.location.floor.building.code}{" "}
                        {ticket.location.number}
                      </strong>
                      <span className="pill ready-ready">{ticket.status}</span>
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
                          ? new Date(ticket.resolvedAt).toLocaleString()
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
                          disabled={resolvingId === ticket.id}
                          onClick={async () => {
                            setResolvingId(ticket.id);
                            setError(null);
                            try {
                              await closeIssue(ticket.id);
                              setMessage("Тикетът е затворен");
                              await refresh();
                            } catch (err) {
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : "Close failed",
                              );
                            } finally {
                              setResolvingId(null);
                            }
                          }}
                        >
                          Close
                        </button>
                      )}
                      <button
                        type="button"
                        className="subtle"
                        disabled={resolvingId === ticket.id}
                        onClick={async () => {
                          const reason = window.prompt(
                            "Причина за повторно отваряне (опционално)",
                          );
                          if (reason === null) return;
                          setResolvingId(ticket.id);
                          setError(null);
                          setMessage(null);
                          try {
                            await reopenIssue(ticket.id, reason);
                            setMessage("Issue reopened");
                            await refresh();
                          } catch (err) {
                            setError(
                              err instanceof Error
                                ? err.message
                                : "Reopen failed",
                            );
                          } finally {
                            setResolvingId(null);
                          }
                        }}
                      >
                        Reopen
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
