/**
 * Cleaning lifecycle UI helpers for the Locations board: mark dirty, create/
 * start/complete/inspect/reassign tasks, and overdue-session cancel.
 * Row action clicks stop propagation so they do not open the detail panel.
 */
import type { ReactNode } from "react";
import {
  cancelCleaningSession,
  completeCleaningSession,
  createCleaningTask,
  inspectCleaningTask,
  markCommonAreaDirty,
  markRoomDirty,
  startCleaningTask,
  todayHotelDate,
  type OverdueSession,
  type Room,
} from "../../api/client";

/**
 * Route mark-dirty to the room vs common-area API endpoint.
 * Common areas use a different mutation path than guest rooms.
 */
export async function markDirty(
  locationId: string,
  isCommon: boolean,
): Promise<Room> {
  // Common areas use a dedicated mutation path.
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

/**
 * Toolbar for picking the default assignee when creating tasks,
 * plus a manual refresh and optional live-stamp.
 * Reassignment uses a dedicated per-room modal — not this dropdown.
 */
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
        Assign housekeeper when creating
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
      {/* Shown when the last live event update timestamp is known. */}
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

/**
 * Banner listing overdue running sessions with a cancel action per session.
 * Empty list shows a muted placeholder instead of the list.
 */
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
      {/* Empty vs overdue session rows with cancel. */}
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
                    // Busy this session while cancel runs.
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

/**
 * Priority + due-at cell for the active cleaning task.
 * Shows an em dash when there is no active task.
 */
export function TaskPriorityDueCell({ task }: TaskInfoCellProps) {
  return (
    <td>
      {/* Active task priority/due vs empty placeholder. */}
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

/**
 * Rich task-info cell: status, assignee, rework findings, running/completed
 * session meta, last inspection, and reassign reason.
 */
export function TaskInfoCell({ task }: TaskInfoCellProps) {
  return (
    <td>
      {/* Active task details vs empty placeholder. */}
      {task ? (
        <div>
          <div>
            {task.status === "rework" ? "rework" : task.status}
            {task.assignee ? ` · ${task.assignee.fullName}` : ""}
          </div>
          {/* Rework findings callout when present. */}
          {task.status === "rework" && task.lastInspection?.findings && (
            <div className="muted warn-text">
              findings: {task.lastInspection.findings}
            </div>
          )}
          {/* Running session indicator. */}
          {task.runningSession && (
            <div className="muted">session running</div>
          )}
          {/* Last completed session meta. */}
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
          {/* Last inspection result meta. */}
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
          {/* Reassign reason when present. */}
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
  canMarkDirty: boolean;
  canCreateTask: boolean;
  canInspect: boolean;
  canReassign: boolean;
  canStartThis: boolean | "" | null | undefined;
  canCompleteThis: boolean | "" | null | undefined;
  isCommon: boolean;
  unitLabel: string;
  unitLabelCap: string;
  dueHours: number;
  assigneeId: string;
  reassignLabel: string;
  markDirtyLabel: string;
  createTaskLabel: string;
  runAction: (locationId: string, action: () => Promise<void>) => Promise<void>;
  setMessage: (message: string | null) => void;
  setError: (error: string | null) => void;
  onReassignClick: (location: Room) => void;
  reportIssueButton: ReactNode;
};

/**
 * Permission- and status-gated cleaning actions for one location row.
 * Each button checks its exact capability — no OR bleed across actions.
 */
export function LifecycleActions({
  location,
  busy,
  canMarkDirty,
  canCreateTask,
  canInspect,
  canReassign,
  canStartThis,
  canCompleteThis,
  isCommon,
  unitLabel,
  unitLabelCap,
  dueHours,
  assigneeId,
  reassignLabel,
  markDirtyLabel,
  createTaskLabel,
  runAction,
  setMessage,
  setError,
  onReassignClick,
  reportIssueButton,
}: LifecycleActionsProps) {
  const task = location.activeTask;

  return (
    // Stop row click from opening the detail panel when using actions.
    <div className="actions" onClick={(e) => e.stopPropagation()}>
      {canMarkDirty && location.cleaningStatus !== "dirty" && !task && (
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
          {markDirtyLabel}
        </button>
      )}
      {canCreateTask && !task && (
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
          {createTaskLabel}
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
      {canReassign &&
        task &&
        (task.status === "assigned" ||
          task.status === "rework" ||
          task.status === "awaiting_inspection") &&
        !task.runningSession && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onReassignClick(location)}
          >
            {reassignLabel}
          </button>
        )}
      {reportIssueButton}
    </div>
  );
}
