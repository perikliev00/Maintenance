import type { ReactNode } from "react";
import {
  cancelCleaningSession,
  completeCleaningSession,
  createCleaningTask,
  inspectCleaningTask,
  markCommonAreaDirty,
  markRoomDirty,
  reassignCleaningTask,
  startCleaningTask,
  todayHotelDate,
  type OverdueSession,
  type Room,
} from "../../api/client";

export async function markDirty(
  locationId: string,
  isCommon: boolean,
): Promise<Room> {
  if (isCommon) return markCommonAreaDirty(locationId);
  return markRoomDirty(locationId);
}

type AssigneeToolbarProps = {
  assigneeId: string;
  setAssigneeId: (id: string) => void;
  housekeepers: Array<{ id: string; fullName: string; employeeNumber: string }>;
  refresh: () => Promise<void>;
  liveAt: string | null;
};

export function AssigneeToolbar({
  assigneeId,
  setAssigneeId,
  housekeepers,
  refresh,
  liveAt,
}: AssigneeToolbarProps) {
  return (
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
  );
}

type OverdueSessionsPanelProps = {
  overdueSessionMinutes: number;
  overdue: OverdueSession[];
  unitLabel: string;
  unitLabelCap: string;
  busyId: string | null;
  setBusyId: (id: string | null) => void;
  setError: (error: string | null) => void;
  setMessage: (message: string | null) => void;
  refresh: () => Promise<void>;
};

export function OverdueSessionsPanel({
  overdueSessionMinutes,
  overdue,
  unitLabel,
  unitLabelCap,
  busyId,
  setBusyId,
  setError,
  setMessage,
  refresh,
}: OverdueSessionsPanelProps) {
  return (
    <section className="panel">
      <h2>Overdue sessions (&gt; {overdueSessionMinutes}m)</h2>
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
  );
}

type TaskInfoCellProps = {
  task: NonNullable<Room["activeTask"]> | null | undefined;
};

export function TaskPriorityDueCell({ task }: TaskInfoCellProps) {
  return (
    <td>
      {task ? (
        <div>
          <div>{task.priority}</div>
          <div className="muted">
            {task.dueAt ? new Date(task.dueAt).toLocaleString() : "no due"}
          </div>
        </div>
      ) : (
        <span className="muted">—</span>
      )}
    </td>
  );
}

export function TaskInfoCell({ task }: TaskInfoCellProps) {
  return (
    <td>
      {task ? (
        <div>
          <div>
            {task.status === "rework" ? "rework" : task.status}
            {task.assignee ? ` · ${task.assignee.fullName}` : ""}
          </div>
          {task.status === "rework" && task.lastInspection?.findings && (
            <div className="muted warn-text">
              findings: {task.lastInspection.findings}
            </div>
          )}
          {task.runningSession && (
            <div className="muted">session running</div>
          )}
          {task.lastCompletedSession && (
            <div className="muted">
              completed by {task.lastCompletedSession.employee.fullName}
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
  );
}

type LifecycleActionsProps = {
  location: Room;
  busy: boolean;
  canManage: boolean;
  canInspect: boolean;
  canStartThis: boolean | "" | null | undefined;
  canCompleteThis: boolean | "" | null | undefined;
  isCommon: boolean;
  unitLabel: string;
  unitLabelCap: string;
  dueHours: number;
  assigneeId: string;
  runAction: (locationId: string, action: () => Promise<void>) => Promise<void>;
  setMessage: (message: string | null) => void;
  setError: (error: string | null) => void;
  reportIssueButton: ReactNode;
};

export function LifecycleActions({
  location,
  busy,
  canManage,
  canInspect,
  canStartThis,
  canCompleteThis,
  isCommon,
  unitLabel,
  unitLabelCap,
  dueHours,
  assigneeId,
  runAction,
  setMessage,
  setError,
  reportIssueButton,
}: LifecycleActionsProps) {
  const task = location.activeTask;

  return (
    <div className="actions" onClick={(e) => e.stopPropagation()}>
      {canManage && location.cleaningStatus !== "dirty" && !task && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            runAction(location.id, async () => {
              await markDirty(location.id, isCommon);
              setMessage(`${unitLabelCap} ${location.number} marked dirty`);
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
            runAction(location.id, async () => {
              const due = new Date();
              due.setHours(due.getHours() + dueHours);
              await createCleaningTask({
                locationId: location.id,
                hotelDate: todayHotelDate(),
                priority: "normal",
                assignedEmployeeId: assigneeId || undefined,
                dueAt: due.toISOString(),
              });
              setMessage(`Task created for ${unitLabel} ${location.number}`);
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
            runAction(location.id, async () => {
              await startCleaningTask(task!.id, task!.version);
              setMessage(`Started cleaning ${unitLabel} ${location.number}`);
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
            const notes = window.prompt("Бележка при complete (опционално)");
            if (notes === null) return;
            runAction(location.id, async () => {
              await completeCleaningSession(
                task!.runningSession!.id,
                notes,
                task!.version,
              );
              setMessage(
                `Submitted ${unitLabel} ${location.number} for inspection`,
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
              runAction(location.id, async () => {
                await inspectCleaningTask(
                  task.id,
                  "approved",
                  findings.trim() || undefined,
                  task.version,
                );
                setMessage(`Approved ${unitLabel} ${location.number}`);
              });
            }}
          >
            Approve
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const findings = window.prompt("Rejection reason / findings");
              if (!findings?.trim()) {
                setError("Rejection reason required");
                return;
              }
              runAction(location.id, async () => {
                await inspectCleaningTask(
                  task.id,
                  "rejected",
                  findings,
                  task.version,
                );
                setMessage(`Rejected ${unitLabel} ${location.number}`);
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
              runAction(location.id, async () => {
                const reason = window.prompt("Reassign reason");
                if (!reason?.trim()) {
                  throw new Error("Reassign reason required");
                }
                await reassignCleaningTask(
                  task.id,
                  assigneeId,
                  reason,
                  task.version,
                );
                setMessage(`Reassigned ${unitLabel} ${location.number}`);
              })
            }
          >
            Reassign
          </button>
        )}
      {reportIssueButton}
    </div>
  );
}
