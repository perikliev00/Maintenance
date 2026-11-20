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
  type Room,
} from "../../api/client";
import {
  boardT,
  priorityLabel,
  taskStatusLabel,
  type BoardLocale,
} from "./labels";
import {
  showOverdueEmpty,
  type OverdueState,
} from "./overdueState";

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
  locale: BoardLocale;
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
  locale,
  assigneeId,
  setAssigneeId,
  housekeepers,
  refresh,
  liveAt,
}: AssigneeToolbarProps) {
  return (
    <div className="toolbar">
      <label>
        {boardT(
          locale,
          "Изпълнител при създаване",
          "Assign housekeeper when creating",
        )}
        <select
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
        >
          <option value="">
            {boardT(locale, "Неназначен", "Unassigned")}
          </option>
          {housekeepers.map((hk) => (
            <option key={hk.id} value={hk.id}>
              {hk.fullName} ({hk.employeeNumber})
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="ghost" onClick={() => refresh()}>
        {boardT(locale, "Обнови", "Refresh")}
      </button>
      {/* Shown when the last live event update timestamp is known. */}
      {liveAt && (
        <span className="muted live-stamp" title={liveAt}>
          {boardT(locale, "на живо", "live")}
        </span>
      )}
    </div>
  );
}

type OverdueSessionsPanelProps = {
  locale: BoardLocale;
  overdueSessionMinutes: number;
  overdueState: OverdueState;
  unitLabel: string;
  unitLabelCap: string;
  busyIds: ReadonlySet<string>;
  beginBusy: (id: string) => boolean;
  endBusy: (id: string) => void;
  setError: (error: string | null) => void;
  setMessage: (message: string | null) => void;
  refresh: () => Promise<void>;
  onRetry: () => void;
};

/**
 * Banner listing overdue running sessions with a cancel action per session.
 * Distinguishes loading / empty success / error / stale prior data.
 */
export function OverdueSessionsPanel({
  locale,
  overdueSessionMinutes,
  overdueState,
  unitLabel,
  unitLabelCap,
  busyIds,
  beginBusy,
  endBusy,
  setError,
  setMessage,
  refresh,
  onRetry,
}: OverdueSessionsPanelProps) {
  const { status, sessions, stale, error } = overdueState;

  return (
    <section className="panel">
      <h2>
        {boardT(
          locale,
          `Просрочени сесии (> ${overdueSessionMinutes} мин)`,
          `Overdue sessions (> ${overdueSessionMinutes}m)`,
        )}
      </h2>
      {status === "loading" && sessions.length === 0 && (
        <p className="muted">
          {boardT(locale, "Проверка за просрочени…", "Checking overdue…")}
        </p>
      )}
      {error && (
        <div className="error banner" role="alert">
          <span>
            {stale
              ? boardT(
                  locale,
                  "Неуспешно обновяване на просрочените сесии. Показаните данни може да не са актуални.",
                  "Failed to refresh overdue sessions. Shown data may be outdated.",
                )
              : boardT(
                  locale,
                  "Неуспешна проверка за просрочени сесии.",
                  "Failed to check overdue sessions.",
                )}{" "}
            {error}
          </span>
          <button type="button" className="ghost" onClick={onRetry}>
            {boardT(locale, "Опитай отново", "Retry")}
          </button>
        </div>
      )}
      {showOverdueEmpty(overdueState) && (
        <p className="muted">
          {boardT(
            locale,
            "Няма просрочени активни сесии.",
            "No overdue running sessions.",
          )}
        </p>
      )}
      {sessions.length > 0 && (
        <ul className="overdue-list">
          {sessions.map((s) => (
            <li key={s.sessionId}>
              <span>
                {unitLabelCap} {s.room.number} · {s.employee.fullName} ·{" "}
                {s.elapsedMinutes} {boardT(locale, "мин", "min")}
              </span>
              <button
                type="button"
                disabled={busyIds.has(s.sessionId)}
                onClick={() => {
                  void (async () => {
                    if (!beginBusy(s.sessionId)) return;
                    setError(null);
                    setMessage(null);
                    try {
                      await cancelCleaningSession(s.sessionId);
                      setMessage(
                        boardT(
                          locale,
                          `Прекратена просрочена сесия за ${unitLabel} ${s.room.number}`,
                          `Cancelled overdue session for ${unitLabel} ${s.room.number}`,
                        ),
                      );
                      await refresh();
                    } catch (err) {
                      setError(
                        err instanceof Error
                          ? err.message
                          : boardT(
                              locale,
                              "Неуспешно прекратяване на сесия",
                              "Failed to cancel session",
                            ),
                      );
                    } finally {
                      endBusy(s.sessionId);
                    }
                  })();
                }}
              >
                {boardT(locale, "Прекрати", "Cancel")}
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
  locale: BoardLocale;
};

/**
 * Priority + due-at content for the active cleaning task (not a table cell).
 * Parent row owns the surrounding `<div className="ui-location-facts">` to avoid nested cells.
 */
export function TaskPriorityDueCell({ task, locale }: TaskInfoCellProps) {
  if (!task) {
    return <span className="muted">—</span>;
  }
  return (
    <div className="task-priority-due">
      <div>{priorityLabel(locale, task.priority)}</div>
      <div className="muted">
        {task.dueAt
          ? new Date(task.dueAt).toLocaleString()
          : boardT(locale, "без срок", "no due")}
      </div>
    </div>
  );
}

/**
 * Rich task-info cell: status, assignee, rework findings, running/completed
 * session meta, last inspection, and reassign reason.
 */
export function TaskInfoCell({ task, locale }: TaskInfoCellProps) {
  return (
    <div className="ui-location-facts">
      {task ? (
        <div>
          <div>
            {taskStatusLabel(locale, task.status)}
            {task.assignee ? ` · ${task.assignee.fullName}` : ""}
          </div>
          {task.status === "rework" && task.lastInspection?.findings && (
            <div className="muted warn-text">
              {boardT(locale, "констатации", "findings")}:{" "}
              {task.lastInspection.findings}
            </div>
          )}
          {task.runningSession && (
            <div className="muted">
              {boardT(locale, "сесия в ход", "session running")}
            </div>
          )}
          {task.lastCompletedSession && (
            <div className="muted">
              {boardT(locale, "завършено от", "completed by")}{" "}
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
              {task.lastInspection.result}{" "}
              {boardT(locale, "от", "by")}{" "}
              {task.lastInspection.inspector.fullName}
              {` · ${new Date(task.lastInspection.inspectedAt).toLocaleString()}`}
              {task.lastInspection.findings
                ? ` · ${task.lastInspection.findings}`
                : ""}
            </div>
          )}
          {task.reassignReason && (
            <div className="muted">
              {boardT(locale, "преназначаване", "reassign")}:{" "}
              {task.reassignReason}
            </div>
          )}
        </div>
      ) : (
        <span className="muted">—</span>
      )}
    </div>
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
  locale: BoardLocale;
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
  locale,
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
              setMessage(
                boardT(
                  locale,
                  `${unitLabelCap} ${location.number} е маркирана като мръсна`,
                  `${unitLabelCap} ${location.number} marked dirty`,
                ),
              );
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
              setMessage(
                boardT(
                  locale,
                  `Създадена задача за ${unitLabel} ${location.number}`,
                  `Task created for ${unitLabel} ${location.number}`,
                ),
              );
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
              setMessage(
                boardT(
                  locale,
                  `Започнато почистване на ${unitLabel} ${location.number}`,
                  `Started cleaning ${unitLabel} ${location.number}`,
                ),
              );
            })
          }
        >
          {boardT(locale, "Старт", "Start")}
        </button>
      )}
      {canCompleteThis && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const notes = window.prompt(
              boardT(
                locale,
                "Бележка при завършване (опционално)",
                "Note on complete (optional)",
              ),
            );
            if (notes === null) return;
            runAction(location.id, async () => {
              await completeCleaningSession(
                task!.runningSession!.id,
                notes,
                task!.version,
              );
              setMessage(
                boardT(
                  locale,
                  `${unitLabelCap} ${location.number} е подадена за проверка`,
                  `Submitted ${unitLabel} ${location.number} for inspection`,
                ),
              );
            });
          }}
        >
          {boardT(locale, "Завърши", "Complete")}
        </button>
      )}
      {canInspect && task?.status === "awaiting_inspection" && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const findings = window.prompt(
                boardT(
                  locale,
                  "Бележка при одобрение (опционално)",
                  "Note on approve (optional)",
                ),
              );
              if (findings === null) return;
              runAction(location.id, async () => {
                await inspectCleaningTask(
                  task.id,
                  "approved",
                  findings.trim() || undefined,
                  task.version,
                );
                setMessage(
                  boardT(
                    locale,
                    `Одобрена ${unitLabel} ${location.number}`,
                    `Approved ${unitLabel} ${location.number}`,
                  ),
                );
              });
            }}
          >
            {boardT(locale, "Одобри", "Approve")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const findings = window.prompt(
                boardT(
                  locale,
                  "Причина за отказ / констатации",
                  "Rejection reason / findings",
                ),
              );
              if (!findings?.trim()) {
                setError(
                  boardT(
                    locale,
                    "Изисква се причина за отказ",
                    "Rejection reason required",
                  ),
                );
                return;
              }
              runAction(location.id, async () => {
                await inspectCleaningTask(
                  task.id,
                  "rejected",
                  findings,
                  task.version,
                );
                setMessage(
                  boardT(
                    locale,
                    `Отхвърлена ${unitLabel} ${location.number}`,
                    `Rejected ${unitLabel} ${location.number}`,
                  ),
                );
              });
            }}
          >
            {boardT(locale, "Отхвърли", "Reject")}
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
