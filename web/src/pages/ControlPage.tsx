/**
 * Manager control desk: role edits, create cleaning tasks, and ticket
 * assign/close/reopen/lifecycle. Role changes are limited by `assignableRolesFor`.
 */
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

/**
 * Manager control desk: role edits, create cleaning tasks, and ticket
 * assign/close/reopen/lifecycle. Role changes are limited by `assignableRolesFor`.
 */
export function ControlPage({ user }: Props) {
  // Roles this actor is allowed to assign to others.
  const allowedRoles = useMemo(
    () => assignableRolesFor(user.role),
    [user.role],
  );

  // Directory + draft role map keyed by userId.
  const [people, setPeople] = useState<Person[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, Role>>({});
  // People search query (also triggers reload).
  const [q, setQ] = useState("");
  // Open vs recently resolved ticket feeds.
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [resolvedTickets, setResolvedTickets] = useState<MaintenanceTicket[]>(
    [],
  );
  // Cleaning-task form options.
  const [rooms, setRooms] = useState<Room[]>([]);
  const [housekeepers, setHousekeepers] = useState<
    Array<{ id: string; fullName: string; employeeNumber: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Per-row busy flags for role save vs ticket mutations.
  const [savingId, setSavingId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Create-cleaning-task form drafts.
  const [taskRoomId, setTaskRoomId] = useState("");
  const [taskAssigneeId, setTaskAssigneeId] = useState("");
  const [taskPriority, setTaskPriority] = useState("normal");
  const [creatingTask, setCreatingTask] = useState(false);
  // Per-ticket assignee select drafts (open issues).
  const [assignDrafts, setAssignDrafts] = useState<Record<string, string>>({});

  // Ticket action gates derived from role helpers.
  const canAssign = canAssignIssues(user.role);
  const canClose = canCloseIssues(user.role);
  const canResolve = canResolveIssues(user.role);

  // Assignee choices for ticket assign drafts (technicians + supervisors).
  const technicians = useMemo(
    () =>
      people.filter(
        (p) => p.role === "technician" || p.role === "supervisor",
      ),
    [people],
  );

  /**
   * Load people, open/resolved tickets, rooms, and housekeepers in parallel.
   * Seeds role drafts and default task form ids when empty.
   */
  const refresh = useCallback(async () => {
    // Parallel fetch: directory, ticket feeds, rooms, housekeepers.
    const [peopleData, ticketData, resolvedData, roomData, hkData] =
      await Promise.all([
        fetchPeople({ q: q.trim() || undefined, includeInactive: true }),
        fetchTickets({ limit: 20, status: "open" }),
        fetchTickets({ limit: 20, status: "resolved" }),
        fetchRooms(),
        fetchHousekeepers(),
      ]);
    // Replace people list and rebuild editable role drafts for accounts with roles.
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
    // Default first room / housekeeper into the create-task form once.
    if (!taskRoomId && roomData[0]) setTaskRoomId(roomData[0].id);
    if (!taskAssigneeId && hkData[0]) setTaskAssigneeId(hkData[0].id);
  }, [q, taskRoomId, taskAssigneeId]);

  // Soft live refresh while idle (not loading / not mid-mutation).
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

  // Initial load + reload when people search query changes.
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

  /**
   * Persist a role draft for one person when it differs from the current role.
   * No-ops when missing userId/role or draft unchanged.
   */
  async function saveRole(person: Person) {
    // Early return: person must have a linked user account and role.
    if (!person.userId || !person.role) return;
    const next = roleDrafts[person.userId];
    // Early return: nothing to save or draft matches current.
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

  /**
   * Create a cleaning task for the selected room with optional assignee.
   * Due time defaults to now + 4 hours on the current hotel date.
   */
  async function onCreateTask(e: FormEvent) {
    e.preventDefault();
    // Early return: room is required.
    if (!taskRoomId) return;
    setCreatingTask(true);
    setError(null);
    setMessage(null);
    try {
      // Default due window: four hours from now.
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

      {/* Owner gets a full-control banner. */}
      {user.role === "owner" && (
        <div className="owner-banner">
          Роля собственик — пълен контрол: всички роли, всички панели, всички действия
        </div>
      )}
      {/* Error / success feedback banners. */}
      {error && <div className="error banner">{error}</div>}
      {message && <div className="ok banner">{message}</div>}

      {/* Loading gate vs main control grid. */}
      {loading ? (
        <p className="muted">Loading control…</p>
      ) : (
        <div className="control-grid">
          {/* People roles panel with search. */}
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
                  {/* Only people with linked user accounts and roles. */}
                  {people
                    .filter((p) => p.userId && p.role)
                    .map((person) => {
                    // Draft role for this row (falls back to current).
                    const draft =
                      roleDrafts[person.userId!] ?? (person.role as Role);
                    // Owner sees full assignable set; others keep current role in options.
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
                    // Managers cannot edit owner/admin accounts.
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
                          {/* Save disabled when locked, busy, or draft unchanged. */}
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

          // Create cleaning task form.
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

          // Open tickets: assign + lifecycle actions.
          <section className="panel control-issues">
            <div className="panel-header">
              <h2>Отворени проблеми</h2>
              <button type="button" className="ghost" onClick={() => refresh()}>
                Refresh
              </button>
              // Live stamp when soft refresh last succeeded.
              {liveAt && (
                <span className="muted live-stamp" title={liveAt}>
                  live
                </span>
              )}
            </div>
            // Empty vs open-ticket feed.
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
                      {/* Show current assignee when present. */}
                      {ticket.assignee && (
                        <span>→ {ticket.assignee.fullName}</span>
                      )}
                    </div>
                    {/* Assign UI only for new/assigned when actor can assign. */}
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
                              // Resolve assignee from draft, current, or first tech.
                              const assigneeId =
                                assignDrafts[ticket.id] ??
                                ticket.assignee?.id ??
                                technicians[0]?.id;
                              // Early return: no assignee available.
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
                    {/* Shared resolve/start/hold lifecycle controls. */}
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

          // Recently resolved: close or reopen.
          <section className="panel control-issues">
            <div className="panel-header">
              <h2>Наскоро резолвнати</h2>
            </div>
            // Empty vs resolved-ticket feed.
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
                    {/* Optional resolution notes. */}
                    {ticket.resolutionNotes && (
                      <p className="muted">{ticket.resolutionNotes}</p>
                    )}
                    <div
                      className="actions"
                      style={{ marginTop: "0.5rem", gap: "0.35rem" }}
                    >
                      {/* Close gate: canClose + still resolved. */}
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
                      {/* Reopen always available; cancel prompt aborts. */}
                      <button
                        type="button"
                        className="subtle"
                        disabled={resolvingId === ticket.id}
                        onClick={async () => {
                          // Optional reason; null means user cancelled the prompt.
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
