/**
 * Manual daily-plan entry create/list/delete, grouped by category.
 * Add form is shown only when `canManage`; `children` slot preserves page order
 * between the form and the entry tables.
 */
import { FormEvent, type ReactNode, useState } from "react";
import {
  createDailyPlanEntry,
  deleteDailyPlanEntry,
  type DailyPlan,
  type DailyPlanCategory,
  type DailyPlanEntry,
  type Room,
  type ShiftRow,
} from "../../api/client";
import { LoadingIndicator } from "../../components/LoadingIndicator";
import { CATEGORY_LABELS, SOURCE_LABELS, TASK_STATUS_BG } from "./constants";

type HousekeeperOption = {
  id: string;
  fullName: string;
  employeeNumber: string;
};

type Props = {
  canManage: boolean;
  hotelDate: string;
  plan: DailyPlan | null;
  rooms: Room[];
  housekeepers: HousekeeperOption[];
  shifts: ShiftRow[];
  loading: boolean;
  locationId: string;
  setLocationId: (value: string) => void;
  refresh: () => Promise<void>;
  setError: (value: string | null) => void;
  setMessage: (value: string | null) => void;
  /** Rendered between the add form and the entry lists (preserves page order). */
  children?: ReactNode;
};

/** One plan-entry table row with optional manage-gated remove. */
function EntryRow({
  entry,
  canManage,
  onRemove,
  removing,
}: {
  entry: DailyPlanEntry;
  canManage: boolean;
  onRemove: (id: string) => void;
  removing: boolean;
}) {
  // Early / value return.
  return (
    <li className="ui-plan-entry">
      <div className="ui-action-strip"><strong className="ui-plan-room">{entry.room.buildingCode} {entry.room.number}</strong><span className="badge">{SOURCE_LABELS[entry.source] ?? entry.source}</span></div>
      <p className="muted">ет. {entry.room.floor} · {entry.room.cleaningStatus} · {entry.room.occupancy}</p>
      {entry.task ? <div className="ui-plan-task"><span className={`pill status-${entry.task.status}`}>{TASK_STATUS_BG[entry.task.status] ?? entry.task.status}</span><p>{entry.task.priority}{entry.task.sector ? ` · ${entry.task.sector.code}` : ""}{entry.task.assignedEmployee ? ` · ${entry.task.assignedEmployee.fullName}` : ""}{entry.task.shift ? ` · ${entry.task.shift.code}` : ""}</p></div> : <p className="muted">без задача</p>}
      <p>{entry.notes ?? "—"}</p>
      {canManage && <button type="button" className="ghost" disabled={removing} onClick={() => onRemove(entry.id)}>Премахни</button>}
    </li>
  );
}

/** Category panel wrapping a list of EntryRow tables. */
function PlanSection({
  title,
  entries,
  canManage,
  onRemove,
  removingId,
}: {
  title: string;
  entries: DailyPlanEntry[];
  canManage: boolean;
  onRemove: (id: string) => void;
  removingId: string | null;
}) {
  // Early / value return.
  return (
    <section className="ui-plan-lane">
      <div className="ui-plan-lane-heading"><h2>{title}</h2><span className="badge">{entries.length}</span></div>
      {entries.length === 0 ? <p className="ui-empty muted">Няма записи</p> : <ul className="ui-plan-entry-list">{entries.map((entry) => <EntryRow key={entry.id} entry={entry} canManage={canManage} onRemove={onRemove} removing={removingId === entry.id} />)}</ul>}
    </section>
  );
}

/**
 * Manual daily-plan entry create/list/delete UI, grouped by category.
 * Add form only when `canManage`; `children` slot sits between form and tables.
 */
export function PlanCrud({
  canManage,
  hotelDate,
  plan,
  rooms,
  housekeepers,
  shifts,
  loading,
  locationId,
  setLocationId,
  refresh,
  setError,
  setMessage,
  children,
}: Props) {
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [category, setCategory] = useState<DailyPlanCategory>("departure");
  const [assigneeId, setAssigneeId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [notes, setNotes] = useState("");

  /** Create a plan entry and surface the linked task effect in the banner. */
  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!locationId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    // Try block for fallible work.
    try {
      const result = await createDailyPlanEntry({
        hotelDate,
        locationId,
        category,
        notes: notes.trim() || undefined,
        assignedEmployeeId: assigneeId || undefined,
        shiftId: shiftId || undefined,
      });
      // effects.task tells whether a cleaning task was created/bumped/linked.
      const taskEffect = String(result.effects?.task ?? "");
      setMessage(
        taskEffect === "created"
          ? "Добавено — създадена задача за почистване"
          : taskEffect === "bumped"
            ? "Добавено — приоритетът на задачата е повишен"
            : taskEffect === "linked"
              ? "Добавено — свързано със съществуваща задача"
              : "Добавено в дневния план",
      );
      setNotes("");
      // Await async step.
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add entry");
    } finally {
      setSaving(false);
    }
  }

  /** Delete a plan entry (does not reverse room/task side effects). */
  async function onRemove(id: string) {
    setRemovingId(id);
    setError(null);
    setMessage(null);
    // Try block for fallible work.
    try {
      // Await async step.
      await deleteDailyPlanEntry(id);
      setMessage("Записът е премахнат (стаята/задачата не се връщат назад)");
      // Await async step.
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setRemovingId(null);
    }
  }

  // Early / value return.
  return (
    <>
      {loading || !plan ? (
        <LoadingIndicator label="Зареждане на плана…" />
      ) : (
        <div className="ui-service-timeline">
          <PlanSection
            title={CATEGORY_LABELS.departure}
            entries={plan.departures}
            // Permission / capability gate.
            canManage={canManage}
            onRemove={onRemove}
            removingId={removingId}
          />
          <PlanSection
            title={CATEGORY_LABELS.arrival}
            entries={plan.arrivals}
            // Permission / capability gate.
            canManage={canManage}
            onRemove={onRemove}
            removingId={removingId}
          />
          <PlanSection
            title={CATEGORY_LABELS.priority}
            entries={plan.priority}
            // Permission / capability gate.
            canManage={canManage}
            onRemove={onRemove}
            removingId={removingId}
          />
        </div>
      )}
      {/* Add form — manage-gated. */}
      {canManage && (
        <details className="ui-surface ui-plan-composer">
          <summary>Добави в плана</summary>
          <h2>Нов запис за {hotelDate}</h2>
          <form className="report-form" onSubmit={onAdd}>
            <label>
              Стая
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
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
              Категория
              <select
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as DailyPlanCategory)
                }
              >
                {(Object.keys(CATEGORY_LABELS) as DailyPlanCategory[]).map(
                  (key) => (
                    <option key={key} value={key}>
                      {CATEGORY_LABELS[key]}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              Камериер (опц.)
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
              >
                <option value="">—</option>
                {housekeepers.map((hk) => (
                  <option key={hk.id} value={hk.id}>
                    {hk.fullName} ({hk.employeeNumber})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Смяна (опц.)
              <select
                value={shiftId}
                onChange={(e) => setShiftId(e.target.value)}
              >
                <option value="">—</option>
                {shifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nameBg} ({s.startTime}–{s.endTime})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Бележка
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="VIP, ранен check-out…"
                maxLength={500}
              />
            </label>
            <button type="submit" disabled={saving || !locationId}>
              {/* Render branch: saving ? "Запис…" : "Добави" */}
              {saving ? "Запис…" : "Добави"}
            </button>
          </form>
          <p className="muted small">
            Заминаване създава задача. На деня на checkout (или ръчно) стаята
            става свободна + мръсна; бъдещ план не променя occupancy. Приоритет /
            пристигане създават или свързват cleaning task.
          </p>
        </details>
      )}

      {children}

    </>
  );
}
