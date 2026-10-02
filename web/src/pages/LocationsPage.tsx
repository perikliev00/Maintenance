import { useCallback, useEffect, useState } from "react";
import {
  canPerformAction,
  canResolveIssues,
  cancelCleaningSession,
  completeCleaningSession,
  createCleaningTask,
  fetchCommonAreas,
  fetchHousekeepers,
  fetchOverdueSessions,
  fetchRooms,
  inspectCleaningTask,
  isOwner,
  markCommonAreaDirty,
  markRoomDirty,
  reassignCleaningTask,
  fetchIssueOptions,
  fetchMaintenanceCategories,
  fetchAuditEvents,
  reportIssue,
  type IssueOptionRow,
  type MaintenanceCategoryRow,
  type AuditEventRow,
  startCleaningTask,
  todayHotelDate,
  type AuthUser,
  type OverdueSession,
  type PublicSettings,
  type Room,
} from "../api/client";
import { TicketLifecycleActions } from "../components/TicketLifecycleActions";
import { ScopeHint } from "../components/ScopeHint";
import { AuditTimeline } from "../components/AuditTimeline";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

export type LocationKindFilter = "room" | "common_area";

type Props = {
  user: AuthUser;
  kind: LocationKindFilter;
  publicSettings?: PublicSettings | null;
};

export function LocationsPage({ user, kind, publicSettings }: Props) {
  const isCommon = kind === "common_area";
  const unitLabel = isCommon ? "зона" : "стая";
  const unitLabelCap = isCommon ? "Зона" : "Room";
  const pageTitle = isCommon ? "Общи части" : "Rooms";
  const pageSubtitle = isCommon
    ? "Почистване, инспекция и проблеми по общи части (без заетост)"
    : "Readiness, cleaning workflow и blocking issues";
  const showOverdueBanner =
    publicSettings?.flags.show_overdue_banner !== false;
  const dueHours = publicSettings?.operations.defaultTaskDueHours ?? 4;

  const [locations, setLocations] = useState<Room[]>([]);
  const [overdue, setOverdue] = useState<OverdueSession[]>([]);
  const [housekeepers, setHousekeepers] = useState<
    Array<{ id: string; fullName: string; employeeNumber: string }>
  >([]);
  const [assigneeId, setAssigneeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [issueLocationId, setIssueLocationId] = useState<string | null>(null);
  const [issueCategories, setIssueCategories] = useState<
    MaintenanceCategoryRow[]
  >([]);
  const [issueOptions, setIssueOptions] = useState<IssueOptionRow[]>([]);
  const [issuePickMode, setIssuePickMode] = useState<"option" | "custom">(
    "option",
  );
  const [issueOptionId, setIssueOptionId] = useState("");
  const [issueCategoryId, setIssueCategoryId] = useState("");
  const [issueTitle, setIssueTitle] = useState("");
  const [issueBlocks, setIssueBlocks] = useState(true);
  const [detailLocationId, setDetailLocationId] = useState<string | null>(null);
  const [detailEvents, setDetailEvents] = useState<AuditEventRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

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

  useEffect(() => {
    if (!detailLocationId) {
      setDetailEvents([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setDetailLoading(true);
        const rows = await fetchAuditEvents({
          locationId: detailLocationId,
          limit: 40,
        });
        if (!cancelled) setDetailEvents(rows);
      } catch {
        if (!cancelled) setDetailEvents([]);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailLocationId]);

  const detailLocation = detailLocationId
    ? locations.find((l) => l.id === detailLocationId) ?? null
    : null;

  const refresh = useCallback(async () => {
    setError(null);
    const data = isCommon ? await fetchCommonAreas() : await fetchRooms();
    setLocations(data);
    if (canReviewOverdue) {
      try {
        const sessions = await fetchOverdueSessions();
        const ids = new Set(data.map((l) => l.id));
        setOverdue(sessions.filter((s) => ids.has(s.room.id)));
      } catch {
        setOverdue([]);
      }
    }
  }, [canReviewOverdue, isCommon]);

  const liveAt = useLiveRefresh(refresh, {
    enabled: !loading,
    busy: busyId !== null,
    eventTypes: [
      "location.changed",
      "cleaning.changed",
      "ticket.changed",
      "settings.changed",
    ],
  });

  useEffect(() => {
    const ac = new AbortController();
    const { signal } = ac;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = isCommon
          ? await fetchCommonAreas({ signal })
          : await fetchRooms({ signal });
        if (signal.aborted) return;
        setLocations(data);
        if (canReviewOverdue) {
          try {
            const sessions = await fetchOverdueSessions({ signal });
            if (signal.aborted) return;
            const ids = new Set(data.map((l) => l.id));
            setOverdue(sessions.filter((s) => ids.has(s.room.id)));
          } catch (err) {
            if (signal.aborted) return;
            if (err instanceof DOMException && err.name === "AbortError") return;
            setOverdue([]);
          }
        }
        const [cats, opts] = await Promise.all([
          fetchMaintenanceCategories({ signal }),
          fetchIssueOptions({ signal }),
        ]);
        if (signal.aborted) return;
        setIssueCategories(cats);
        setIssueOptions(opts);
        if (opts[0]) {
          setIssueOptionId(opts[0].id);
          setIssueTitle(opts[0].nameBg);
          if (opts[0].defaultBlocksRoom != null) {
            setIssueBlocks(opts[0].defaultBlocksRoom);
          }
        }
        if (cats[0]) setIssueCategoryId(cats[0].id);
        if (canManage) {
          const hk = await fetchHousekeepers({ signal });
          if (signal.aborted) return;
          setHousekeepers(hk);
          if (hk[0]) setAssigneeId(hk[0].id);
        }
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof Error
            ? err.message
            : `Failed to load ${isCommon ? "common areas" : "rooms"}`,
        );
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();
    return () => {
      ac.abort();
    };
  }, [canManage, canReviewOverdue, isCommon]);

  async function runAction(locationId: string, action: () => Promise<void>) {
    setBusyId(locationId);
    setError(null);
    setMessage(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  async function markDirty(locationId: string) {
    if (isCommon) return markCommonAreaDirty(locationId);
    return markRoomDirty(locationId);
  }

  return (
    <main className="content">
      <header className="page-header">
        <div>
          <h1>{pageTitle}</h1>
          <p>{pageSubtitle}</p>
          <ScopeHint user={user} />
        </div>
      </header>

      {owner && (
        <div className="owner-banner">
          Собственик — пълен достъп до всички действия по{" "}
          {isCommon ? "общите части" : "стаите"}
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
          {liveAt && (
            <span className="muted live-stamp" title={liveAt}>
              live
            </span>
          )}
        </div>
      )}

      {canReviewOverdue && showOverdueBanner && (
        <section className="panel">
          <h2>
            Overdue sessions (&gt;{" "}
            {publicSettings?.operations.overdueSessionMinutes ?? 240}m)
          </h2>
          {overdue.length === 0 ? (
            <p className="muted">No overdue running sessions.</p>
          ) : (
            <ul className="overdue-list">
              {overdue.map((s) => (
                <li key={s.sessionId}>
                  <span>
                    {unitLabelCap} {s.room.number} · {s.employee.fullName} ·{" "}
                    {s.elapsedMinutes} min
                  </span>
                  <button
                    type="button"
                    disabled={busyId === s.sessionId}
                    onClick={() => {
                      void (async () => {
                        setBusyId(s.sessionId);
                        setError(null);
                        setMessage(null);
                        try {
                          await cancelCleaningSession(s.sessionId);
                          setMessage(
                            `Cancelled overdue session for ${unitLabel} ${s.room.number}`,
                          );
                          await refresh();
                        } catch (err) {
                          setError(
                            err instanceof Error
                              ? err.message
                              : "Failed to cancel session",
                          );
                        } finally {
                          setBusyId(null);
                        }
                      })();
                    }}
                  >
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {error && <div className="error banner">{error}</div>}
      {message && <div className="ok banner">{message}</div>}

      {issueLocationId && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              const locationId = issueLocationId;
              runAction(locationId, async () => {
                if (issuePickMode === "option" && issueOptionId) {
                  await reportIssue({
                    locationId,
                    issueOptionId,
                    title: issueTitle.trim() || undefined,
                    blocksRoom: issueBlocks,
                    priority: "high",
                  });
                } else {
                  await reportIssue({
                    locationId,
                    title: issueTitle.trim(),
                    categoryId: issueCategoryId,
                    blocksRoom: issueBlocks,
                    priority: "high",
                  });
                }
                setMessage("Issue reported");
                setIssueLocationId(null);
                setIssueTitle("");
              });
            }}
          >
            <h3>Report issue</h3>
            <label>
              Type
              <select
                value={issuePickMode}
                onChange={(e) =>
                  setIssuePickMode(e.target.value as "option" | "custom")
                }
              >
                <option value="option">From catalog</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            {issuePickMode === "option" ? (
              <label>
                Option
                <select
                  value={issueOptionId}
                  onChange={(e) => {
                    const opt = issueOptions.find((o) => o.id === e.target.value);
                    setIssueOptionId(e.target.value);
                    if (opt) {
                      setIssueTitle(opt.nameBg);
                      if (opt.defaultBlocksRoom != null) {
                        setIssueBlocks(opt.defaultBlocksRoom);
                      }
                    }
                  }}
                  required
                >
                  {issueOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nameBg}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
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
                    value={issueCategoryId}
                    onChange={(e) => setIssueCategoryId(e.target.value)}
                    required
                  >
                    {issueCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nameBg}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={issueBlocks}
                onChange={(e) => setIssueBlocks(e.target.checked)}
              />
              Blocks {unitLabel} readiness
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setIssueLocationId(null)}
              >
                Cancel
              </button>
              <button type="submit">Submit</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <p className="muted">
          Loading {isCommon ? "common areas" : "rooms"}…
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{unitLabelCap}</th>
                <th>Building</th>
                <th>Floor</th>
                <th>Sector</th>
                {!isCommon && <th>Occupancy</th>}
                <th>Cleaning</th>
                <th>Priority / Due</th>
                <th>Readiness</th>
                <th>Issues</th>
                <th>Task</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((loc) => {
                const busy = busyId === loc.id;
                const task = loc.activeTask;
                const isMyRunning =
                  task?.runningSession?.employeeId === user.employeeId;
                const canStartThis =
                  canWork &&
                  task &&
                  (task.status === "assigned" || task.status === "rework") &&
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
                  <tr
                    key={loc.id}
                    className={`location-row-clickable${
                      detailLocationId === loc.id ? " location-row-selected" : ""
                    }`}
                    onClick={() => setDetailLocationId(loc.id)}
                  >
                    <td>{loc.number}</td>
                    <td>{loc.buildingCode}</td>
                    <td>{loc.floor}</td>
                    <td>
                      {loc.sector ? (
                        <span title={loc.sector.nameBg}>{loc.sector.code}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    {!isCommon && <td>{loc.occupancy}</td>}
                    <td>
                      <span className={`pill cleaning-${loc.cleaningStatus}`}>
                        {loc.cleaningStatus}
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
                      <span className={`pill ready-${loc.readiness}`}>
                        {loc.readiness}
                      </span>
                      {loc.readinessReasons.length > 0 && (
                        <div className="reasons">
                          {loc.readinessReasons.join(", ")}
                        </div>
                      )}
                    </td>
                    <td>
                      {loc.blockingIssues.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        loc.blockingIssues.map((issue) => (
                          <div
                            key={issue.id}
                            className="issue-row"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div>
                              {issue.title} · {issue.status}
                            </div>
                            <TicketLifecycleActions
                              ticket={issue}
                              busy={busy}
                              canResolve={canResolve}
                              onBusy={(id) => {
                                if (id) setBusyId(loc.id);
                                else setBusyId(null);
                              }}
                              onDone={(msg) => {
                                setMessage(msg);
                                void refresh();
                              }}
                              onError={(msg) => setError(msg)}
                            />
                          </div>
                        ))
                      )}
                    </td>
                    <td>
                      {task ? (
                        <div>
                          <div>
                            {task.status === "rework"
                              ? "rework"
                              : task.status}
                            {task.assignee ? ` · ${task.assignee.fullName}` : ""}
                          </div>
                          {task.status === "rework" &&
                            task.lastInspection?.findings && (
                              <div className="muted warn-text">
                                findings: {task.lastInspection.findings}
                              </div>
                            )}
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
                            <div className="muted">
                              reassign: {task.reassignReason}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <div
                        className="actions"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {canManage &&
                          loc.cleaningStatus !== "dirty" &&
                          !task && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                runAction(loc.id, async () => {
                                  await markDirty(loc.id);
                                  setMessage(
                                    `${unitLabelCap} ${loc.number} marked dirty`,
                                  );
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
                              runAction(loc.id, async () => {
                                const due = new Date();
                                due.setHours(due.getHours() + dueHours);
                                await createCleaningTask({
                                  locationId: loc.id,
                                  hotelDate: todayHotelDate(),
                                  priority: "normal",
                                  assignedEmployeeId: assigneeId || undefined,
                                  dueAt: due.toISOString(),
                                });
                                setMessage(
                                  `Task created for ${unitLabel} ${loc.number}`,
                                );
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
                              runAction(loc.id, async () => {
                                await startCleaningTask(
                                  task!.id,
                                  task!.version,
                                );
                                setMessage(
                                  `Started cleaning ${unitLabel} ${loc.number}`,
                                );
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
                              runAction(loc.id, async () => {
                                await completeCleaningSession(
                                  task!.runningSession!.id,
                                  notes,
                                );
                                setMessage(
                                  `Submitted ${unitLabel} ${loc.number} for inspection`,
                                );
                              });
                            }}
                          >
                            Complete
                          </button>
                        )}
                        {canInspect &&
                          task?.status === "awaiting_inspection" && (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  const findings = window.prompt(
                                    "Бележка при approve (опционално)",
                                  );
                                  if (findings === null) return;
                                  runAction(loc.id, async () => {
                                    await inspectCleaningTask(
                                      task.id,
                                      "approved",
                                      findings.trim() || undefined,
                                    );
                                    setMessage(
                                      `Approved ${unitLabel} ${loc.number}`,
                                    );
                                  });
                                }}
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  const findings = window.prompt(
                                    "Rejection reason / findings",
                                  );
                                  if (!findings?.trim()) {
                                    setError("Rejection reason required");
                                    return;
                                  }
                                  runAction(loc.id, async () => {
                                    await inspectCleaningTask(
                                      task.id,
                                      "rejected",
                                      findings,
                                    );
                                    setMessage(
                                      `Rejected ${unitLabel} ${loc.number}`,
                                    );
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
                            task.status === "rework" ||
                            task.status === "awaiting_inspection") &&
                          !task.runningSession &&
                          assigneeId && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                runAction(loc.id, async () => {
                                  const reason =
                                    window.prompt("Reassign reason");
                                  if (!reason?.trim()) {
                                    throw new Error(
                                      "Reassign reason required",
                                    );
                                  }
                                  await reassignCleaningTask(
                                    task.id,
                                    assigneeId,
                                    reason,
                                    task.version,
                                  );
                                  setMessage(
                                    `Reassigned ${unitLabel} ${loc.number}`,
                                  );
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
                            setIssueLocationId(loc.id);
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

      {detailLocation && (
        <div
          className="location-detail-backdrop"
          onClick={() => setDetailLocationId(null)}
        >
          <aside
            className="location-detail-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <div>
                <h3>
                  {unitLabelCap} {detailLocation.number}
                </h3>
                <div className="muted">
                  {detailLocation.buildingCode} · ет. {detailLocation.floor}
                  {detailLocation.sector
                    ? ` · ${detailLocation.sector.code}`
                    : ""}
                </div>
              </div>
              <button
                type="button"
                className="ghost"
                onClick={() => setDetailLocationId(null)}
              >
                ✕
              </button>
            </header>
            <div>
              <span className={`pill cleaning-${detailLocation.cleaningStatus}`}>
                {detailLocation.cleaningStatus}
              </span>{" "}
              <span className={`pill ready-${detailLocation.readiness}`}>
                {detailLocation.readiness}
              </span>
            </div>
            <section>
              <h4>Хронология</h4>
              <AuditTimeline
                events={detailEvents}
                loading={detailLoading}
                emptyLabel="Няма одит записи за това помещение."
              />
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}
