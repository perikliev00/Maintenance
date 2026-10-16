/**
 * My Work cleaning task cards. Start/complete are disabled while `pendingSync`
 * so optimistic offline actions are not double-fired before the outbox drains.
 */
import type { CleaningTaskRow } from "../../api/client";
import { t, statusLabel } from "./labels";

/** Compact building-code + room number for a cleaning task card. */
function locationLabel(task: CleaningTaskRow): string {
  const b = task.location.floor.building.code;
  return `${b} ${task.location.number}`;
}

/**
 * Single My Work cleaning task card with start/complete actions.
 * Start/complete disabled while `pendingSync` so offline enqueues are not double-fired.
 */
export function TaskCard({
  task,
  locale,
  busy,
  pendingSync,
  onStart,
  onComplete,
}: {
  task: CleaningTaskRow;
  locale: "bg" | "en";
  busy: boolean;
  pendingSync: boolean;
  onStart: () => void;
  onComplete: (notes?: string) => void;
}) {
  // Running session drives the "current" style and complete button.
  const running = task.sessions.find((s) => s.status === "running");
  const lastReject = task.inspections.find((i) => i.result === "rejected");
  // Start only from assigned/rework when no session is running and outbox is clear.
  const canStart =
    (task.status === "assigned" || task.status === "rework") &&
    !running &&
    !pendingSync;
  const canComplete = Boolean(running) && !pendingSync;

  return (
    <article
      className={`mywork-card${task.status === "rework" ? " mywork-card-rework" : ""}${running ? " mywork-card-current" : ""}`}
    >
      <div className="mywork-card-top">
        <strong>{locationLabel(task)}</strong>
        {/* Pending-sync pill overrides the normal status while outbox drains. */}
        {pendingSync ? (
          <span className="pill status-awaiting_inspection">
            {t(locale, "Чака синхрон", "Pending sync")}
          </span>
        ) : (
          <span className={`pill status-${task.status}`}>
            {statusLabel(locale, task.status)}
          </span>
        )}
      </div>
      <p className="muted">
        {task.priority}
        {task.shift
          ? ` · ${locale === "bg" ? task.shift.nameBg : task.shift.nameEn} (${task.shift.startTime}–${task.shift.endTime})`
          : ""}
        {task.location.kind === "common_area"
          ? ` · ${t(locale, "обща част", "common area")}`
          : ""}
      </p>
      {/* Show reject findings when the task is back in rework. */}
      {task.status === "rework" && lastReject?.findings && (
        <p className="mywork-findings">
          {t(locale, "Забележки", "Findings")}: {lastReject.findings}
        </p>
      )}
      <div className="mywork-actions">
        {canStart && (
          <button
            type="button"
            className="mywork-btn primary"
            disabled={busy}
            onClick={onStart}
          >
            {t(locale, "Начало", "Start")}
          </button>
        )}
        {canComplete && (
          <button
            type="button"
            className="mywork-btn primary"
            disabled={busy}
            onClick={() => {
              // Optional notes via prompt; cancel aborts complete.
              const notes = window.prompt(
                t(locale, "Бележки (опционално)", "Notes (optional)"),
              );
              if (notes === null) return;
              onComplete(notes.trim() || undefined);
            }}
          >
            {t(locale, "Приключи", "Complete")}
          </button>
        )}
        {pendingSync && (
          <span className="muted">
            {t(locale, "Чака синхронизация…", "Waiting for sync…")}
          </span>
        )}
        {task.status === "awaiting_inspection" && !pendingSync && (
          <span className="muted">
            {t(locale, "Чака проверка", "Waiting for inspection")}
          </span>
        )}
      </div>
    </article>
  );
}

/**
 * Highlighted "current" running task section (start is a no-op — already running).
 */
export function CurrentTaskSection({
  locale,
  currentTask,
  busy,
  pendingSync,
  onComplete,
}: {
  locale: "bg" | "en";
  currentTask: CleaningTaskRow;
  busy: boolean;
  pendingSync: boolean;
  onComplete: (notes?: string) => void;
}) {
  return (
    <section className="mywork-section">
      <h2>{t(locale, "Текущо", "Current")}</h2>
      <TaskCard
        task={currentTask}
        locale={locale}
        busy={busy}
        pendingSync={pendingSync}
        // Already running — start handler is intentionally unused.
        onStart={() => undefined}
        onComplete={onComplete}
      />
    </section>
  );
}

/**
 * List of assigned cleaning tasks excluding the current running one.
 */
export function CleaningTasksSection({
  locale,
  activeTasks,
  currentTaskId,
  busyId,
  pendingSyncTaskIds,
  onStart,
  onComplete,
}: {
  locale: "bg" | "en";
  activeTasks: CleaningTaskRow[];
  currentTaskId: string | undefined;
  busyId: string | null;
  pendingSyncTaskIds: string[];
  onStart: (task: CleaningTaskRow) => void;
  onComplete: (task: CleaningTaskRow, notes?: string) => void;
}) {
  return (
    <section className="mywork-section">
      <h2>{t(locale, "Почистване", "Cleaning")}</h2>
      {activeTasks.length === 0 ? (
        <p className="muted">
          {t(locale, "Няма възложени задачи", "No assigned tasks")}
        </p>
      ) : (
        <div className="mywork-cards">
          {/* Exclude the current task — it lives in CurrentTaskSection. */}
          {activeTasks
            .filter((task) => task.id !== currentTaskId)
            .map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                locale={locale}
                busy={busyId === task.id}
                pendingSync={pendingSyncTaskIds.includes(task.id)}
                onStart={() => onStart(task)}
                onComplete={(notes) => onComplete(task, notes)}
              />
            ))}
        </div>
      )}
    </section>
  );
}
