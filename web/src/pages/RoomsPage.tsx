import { useCallback, useEffect, useState } from "react";
import {
  canPerformAction,
  canResolveIssues,
  completeCleaningSession,
  createCleaningTask,
  fetchHousekeepers,
  fetchOverdueSessions,
  fetchRooms,
  inspectCleaningTask,
  isOwner,
  markRoomDirty,
  reassignCleaningTask,
  reportIssue,
  resolveIssue,
  startCleaningTask,
  todayHotelDate,
  type AuthUser,
  type OverdueSession,
  type Room,
} from "../api/client";

type Props = {
  user: AuthUser;
};

export function RoomsPage({ user }: Props) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [overdue, setOverdue] = useState<OverdueSession[]>([]);
  const [housekeepers, setHousekeepers] = useState<
    Array<{ id: string; fullName: string; employeeNumber: string }>
  >([]);
  const [assigneeId, setAssigneeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null);
  const [issueRoomId, setIssueRoomId] = useState<string | null>(null);
  const [issueTitle, setIssueTitle] = useState("");
  const [issueCategory, setIssueCategory] = useState("plumbing");
  const [issueBlocks, setIssueBlocks] = useState(true);

  const owner = isOwner(user.role);
  const canManage =
    owner ||
    canPerformAction(user, "cleaning.create") ||
    canPerformAction(user, "rooms.mark_dirty");
  const canWork =
    owner ||
    canPerformAction(user, "cleaning.start") ||
    canPerformAction(user, "cleaning.complete");
  const canInspect = owner || canPerformAction(user, "cleaning.inspect");
  const canReviewOverdue =
    owner || canPerformAction(user, "cleaning.review_overdue");
  const canResolve = owner || canResolveIssues(user.role);

  const refresh = useCallback(async () => {
    setError(null);
    const data = await fetchRooms();
    setRooms(data);
    if (canReviewOverdue) {
      try {
        setOverdue(await fetchOverdueSessions());
      } catch {
        setOverdue([]);
      }
    }
  }, [canReviewOverdue]);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await refresh();
        if (canManage) {
          const hk = await fetchHousekeepers();
          setHousekeepers(hk);
          if (hk[0]) setAssigneeId(hk[0].id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load rooms");
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh, canManage]);

  async function runAction(roomId: string, action: () => Promise<void>) {
    setBusyRoomId(roomId);
    setError(null);
    setMessage(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyRoomId(null);
    }
  }

  return (
    <>
      <main className="content">
        <header className="page-header">
          <div>
            <h1>Rooms</h1>
            <p>Readiness, cleaning workflow и blocking issues</p>
          </div>
        </header>

        {owner && (
          <div className="owner-banner">
            Собственик — пълен достъп до всички действия по стаите
          </div>
        )}
        {canManage && (
          <div className="toolbar">
            <label>
              Assign housekeeper when creating / reassigning
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
              >
                <option value="">Unassigned</option>
                {housekeepers.map((hk) => (
                  <option key={hk.id} value={hk.id}>
                    {hk.fullName} ({hk.employeeNumber})
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="ghost" onClick={() => refresh()}>
              Refresh
            </button>
          </div>
        )}

        {canReviewOverdue && (
          <section className="panel">
            <h2>Overdue sessions (&gt; 4h)</h2>
            {overdue.length === 0 ? (
              <p className="muted">No overdue running sessions.</p>
            ) : (
              <ul className="overdue-list">
                {overdue.map((s) => (
                  <li key={s.sessionId}>
                    Room {s.room.number} · {s.employee.fullName} ·{" "}
                    {s.elapsedMinutes} min
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {error && <div className="error banner">{error}</div>}
        {message && <div className="ok banner">{message}</div>}

        {issueRoomId && (
          <div className="modal-backdrop">
            <form
              className="modal"
              onSubmit={(e) => {
                e.preventDefault();
                const roomId = issueRoomId;
                runAction(roomId, async () => {
                  await reportIssue({
                    locationId: roomId,
                    title: issueTitle,
                    category: issueCategory,
                    blocksRoom: issueBlocks,
                    priority: "high",
                  });
                  setMessage("Issue reported");
                  setIssueRoomId(null);
                  setIssueTitle("");
                });
              }}
            >
              <h3>Report issue</h3>
              <label>
                Title
                <input
                  value={issueTitle}
                  onChange={(e) => setIssueTitle(e.target.value)}
                  required
                />
              </label>
              <label>
                Category
                <select
                  value={issueCategory}
                  onChange={(e) => setIssueCategory(e.target.value)}
                >
                  <option value="climate">climate</option>
                  <option value="electrical">electrical</option>
                  <option value="furniture">furniture</option>
                  <option value="plumbing">plumbing</option>
                  <option value="other">other</option>
                </select>
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={issueBlocks}
                  onChange={(e) => setIssueBlocks(e.target.checked)}
                />
                Blocks room readiness
              </label>
              <div className="modal-actions">
                <button type="button" className="ghost" onClick={() => setIssueRoomId(null)}>
                  Cancel
                </button>
                <button type="submit">Submit</button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <p className="muted">Loading rooms…</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Building</th>
                  <th>Floor</th>
                  <th>Occupancy</th>
                  <th>Cleaning</th>
                  <th>Priority / Due</th>
                  <th>Readiness</th>
                  <th>Issues</th>
                  <th>Task</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((room) => {
                  const busy = busyRoomId === room.id;
                  const task = room.activeTask;
                  const isMyRunning =
                    task?.runningSession?.employeeId === user.employeeId;
                  const canStartThis =
                    canWork &&
                    task &&
                    task.status === "assigned" &&
                    !task.runningSession &&
                    (owner ||
                      user.role === "supervisor" ||
                      !task.assignee ||
                      task.assignee.id === user.employeeId);
                  const canCompleteThis =
                    canWork &&
                    task?.runningSession &&
                    (owner || user.role === "supervisor" || isMyRunning);

                  return (
                    <tr key={room.id}>
                      <td>{room.number}</td>
                      <td>{room.buildingCode}</td>
                      <td>{room.floor}</td>
                      <td>{room.occupancy}</td>
                      <td>
                        <span className={`pill cleaning-${room.cleaningStatus}`}>
                          {room.cleaningStatus}
                        </span>
                      </td>
                      <td>
                        {task ? (
                          <div>
                            <div>{task.priority}</div>
                            <div className="muted">
                              {task.dueAt
                                ? new Date(task.dueAt).toLocaleString()
                                : "no due"}
                            </div>
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`pill ready-${room.readiness}`}>
                          {room.readiness}
                        </span>
                        {room.readinessReasons.length > 0 && (
                          <div className="reasons">
                            {room.readinessReasons.join(", ")}
                          </div>
                        )}
                      </td>
                      <td>
                        {room.blockingIssues.length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          room.blockingIssues.map((issue) => (
                            <div key={issue.id} className="issue-row">
                              <div>{issue.title}</div>
                              {canResolve && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => {
                                    const notes = window.prompt(
                                      "Описание на решението (опционално)",
                                    );
                                    if (notes === null) return;
                                    runAction(room.id, async () => {
                                      await resolveIssue(issue.id, notes);
                                      setMessage(`Resolved issue on ${room.number}`);
                                    });
                                  }}
                                >
                                  Resolve
                                </button>
                              )}
                            </div>
                          ))
                        )}
                      </td>
                      <td>
                        {task ? (
                          <div>
                            <div>
                              {task.status}
                              {task.assignee ? ` · ${task.assignee.fullName}` : ""}
                            </div>
                            {task.runningSession && (
                              <div className="muted">session running</div>
                            )}
                            {task.lastCompletedSession && (
                              <div className="muted">
                                completed by{" "}
                                {task.lastCompletedSession.employee.fullName}
                                {task.lastCompletedSession.finishedAt
                                  ? ` · ${new Date(task.lastCompletedSession.finishedAt).toLocaleString()}`
                                  : ""}
                                {task.lastCompletedSession.notes
                                  ? ` · ${task.lastCompletedSession.notes}`
                                  : ""}
                              </div>
                            )}
                            {task.lastInspection && (
                              <div className="muted">
                                {task.lastInspection.result} by{" "}
                                {task.lastInspection.inspector.fullName}
                                {` · ${new Date(task.lastInspection.inspectedAt).toLocaleString()}`}
                                {task.lastInspection.findings
                                  ? ` · ${task.lastInspection.findings}`
                                  : ""}
                              </div>
                            )}
                            {task.reassignReason && (
                              <div className="muted">reassign: {task.reassignReason}</div>
                            )}
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <div className="actions">
                        {canManage && room.cleaningStatus !== "dirty" && !task && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              runAction(room.id, async () => {
                                await markRoomDirty(room.id);
                                setMessage(`Room ${room.number} marked dirty`);
                              })
                            }
                          >
                            Mark dirty
                          </button>
                        )}
                        {canManage && !task && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              runAction(room.id, async () => {
                                const due = new Date();
                                due.setHours(due.getHours() + 4);
                                await createCleaningTask({
                                  locationId: room.id,
                                  hotelDate: todayHotelDate(),
                                  priority: "normal",
                                  assignedEmployeeId: assigneeId || undefined,
                                  dueAt: due.toISOString(),
                                });
                                setMessage(`Task created for room ${room.number}`);
                              })
                            }
                          >
                            Create task
                          </button>
                        )}
                        {canStartThis && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                runAction(room.id, async () => {
                                  await startCleaningTask(task!.id, task!.version);
                                  setMessage(`Started cleaning room ${room.number}`);
                                })
                              }
                            >
                              Start
                            </button>
                          )}
                        {canCompleteThis && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              const notes = window.prompt(
                                "Бележка при complete (опционално)",
                              );
                              if (notes === null) return;
                              runAction(room.id, async () => {
                                await completeCleaningSession(
                                  task!.runningSession!.id,
                                  notes,
                                );
                                setMessage(
                                  `Submitted room ${room.number} for inspection`,
                                );
                              });
                            }}
                          >
                            Complete
                          </button>
                        )}
                        {canInspect && task?.status === "awaiting_inspection" && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                const findings = window.prompt(
                                  "Бележка при approve (опционално)",
                                );
                                if (findings === null) return;
                                runAction(room.id, async () => {
                                  await inspectCleaningTask(
                                    task.id,
                                    "approved",
                                    findings.trim() || undefined,
                                  );
                                  setMessage(`Approved room ${room.number}`);
                                });
                              }}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                const findings =
                                  window.prompt("Rejection reason / findings");
                                if (!findings?.trim()) {
                                  setError("Rejection reason required");
                                  return;
                                }
                                runAction(room.id, async () => {
                                  await inspectCleaningTask(
                                    task.id,
                                    "rejected",
                                    findings,
                                  );
                                  setMessage(`Rejected room ${room.number}`);
                                });
                              }}
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {canManage &&
                          task &&
                          (task.status === "assigned" ||
                            task.status === "awaiting_inspection") &&
                          !task.runningSession &&
                          assigneeId && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                runAction(room.id, async () => {
                                  const reason =
                                    window.prompt("Reassign reason");
                                  if (!reason?.trim()) {
                                    throw new Error("Reassign reason required");
                                  }
                                  await reassignCleaningTask(
                                    task.id,
                                    assigneeId,
                                    reason,
                                    task.version,
                                  );
                                  setMessage(`Reassigned room ${room.number}`);
                                })
                              }
                            >
                              Reassign
                            </button>
                          )}
                        <button
                          type="button"
                          className="ghost"
                          disabled={busy}
                          onClick={() => {
                            setIssueRoomId(room.id);
                            setIssueTitle("");
                            setIssueBlocks(true);
                          }}
                        >
                          Report issue
                        </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
