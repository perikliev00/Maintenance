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
  return (
    <tr>
      <td>
        <strong>
          {entry.room.buildingCode} {entry.room.number}
        </strong>
        <div className="muted small">
          ет. {entry.room.floor} · {entry.room.cleaningStatus} ·{" "}
          {entry.room.occupancy}
        </div>
      </td>
      <td>
        {entry.task ? (
          <>
            <span>
              {TASK_STATUS_BG[entry.task.status] ?? entry.task.status}
            </span>
            <div className="muted small">
              {entry.task.priority}
              {entry.task.sector ? ` · ${entry.task.sector.code}` : ""}
              {entry.task.assignedEmployee
                ? ` · ${entry.task.assignedEmployee.fullName}`
                : ""}
              {entry.task.shift ? ` · ${entry.task.shift.code}` : ""}
            </div>
          </>
        ) : (
          <span className="muted">без задача</span>
        )}
      </td>
      <td>
        <span className="muted small">
          {SOURCE_LABELS[entry.source] ?? entry.source}
        </span>
      </td>
      <td>{entry.notes ?? "—"}</td>
      <td>
        {canManage && (
          <button
            type="button"
            className="ghost"
            disabled={removing}
            onClick={() => onRemove(entry.id)}
          >
            Премахни
          </button>
        )}
      </td>
    </tr>
  );
}

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
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>
          {title}{" "}
          <span className="muted">({entries.length})</span>
        </h2>
      </div>
      {entries.length === 0 ? (
        <p className="muted">Няма записи</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Стая</th>
                <th>Задача</th>
                <th>Източник</th>
                <th>Бележка</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  canManage={canManage}
                  onRemove={onRemove}
                  removing={removingId === entry.id}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

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

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!locationId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await createDailyPlanEntry({
        hotelDate,
        locationId,
        category,
        notes: notes.trim() || undefined,
        assignedEmployeeId: assigneeId || undefined,
        shiftId: shiftId || undefined,
      });
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
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add entry");
    } finally {
      setSaving(false);
    }
  }

  async function onRemove(id: string) {
    setRemovingId(id);
    setError(null);
    setMessage(null);
    try {
      await deleteDailyPlanEntry(id);
      setMessage("Записът е премахнат (стаята/задачата не се връщат назад)");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <>
      {canManage && (
        <section className="panel">
          <h2>Добави в плана</h2>
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
              {saving ? "Запис…" : "Добави"}
            </button>
          </form>
          <p className="muted small">
            Заминаване създава задача. На деня на checkout (или ръчно) стаята
            става свободна + мръсна; бъдещ план не променя occupancy. Приоритет /
            пристигане създават или свързват cleaning task.
          </p>
        </section>
      )}

      {children}

      {loading || !plan ? (
        <p className="muted">Зареждане на плана…</p>
      ) : (
        <div className="control-grid">
          <PlanSection
            title={CATEGORY_LABELS.departure}
            entries={plan.departures}
            canManage={canManage}
            onRemove={onRemove}
            removingId={removingId}
          />
          <PlanSection
            title={CATEGORY_LABELS.arrival}
            entries={plan.arrivals}
            canManage={canManage}
            onRemove={onRemove}
            removingId={removingId}
          />
          <PlanSection
            title={CATEGORY_LABELS.priority}
            entries={plan.priority}
            canManage={canManage}
            onRemove={onRemove}
            removingId={removingId}
          />
        </div>
      )}
    </>
  );
}
