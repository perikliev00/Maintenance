import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  applyDepartureRoomEffects,
  canPerformAction,
  createDailyPlanEntry,
  deleteDailyPlanEntry,
  fetchDailyPlan,
  fetchHousekeepers,
  fetchRooms,
  fetchShifts,
  importDailyPlan,
  todayHotelDate,
  type AuthUser,
  type DailyPlan,
  type DailyPlanCategory,
  type DailyPlanEntry,
  type Room,
  type ShiftRow,
} from "../api/client";
import { ScopeHint } from "../components/ScopeHint";

type Props = {
  user: AuthUser;
};

const CATEGORY_LABELS: Record<DailyPlanCategory, string> = {
  departure: "Заминаващи",
  arrival: "Пристигащи",
  priority: "Приоритетни",
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "ръчен",
  import: "импорт",
};

const TASK_STATUS_BG: Record<string, string> = {
  assigned: "възложена",
  in_progress: "в ход",
  awaiting_inspection: "чака инспекция",
  rework: "повторна работа",
  completed: "завършена",
  cancelled: "отказана",
};

const EXAMPLE_IMPORT = `{
  "hotelDate": "YYYY-MM-DD",
  "sourceLabel": "clock",
  "entries": [
    {
      "buildingCode": "A",
      "roomNumber": "102",
      "category": "departure",
      "notes": "Check-out 11:00",
      "externalId": "clock:dep:A:102:YYYY-MM-DD"
    }
  ]
}`;

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
              {entry.task.shift
                ? ` · ${entry.task.shift.code}`
                : ""}
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

export function PlanPage({ user }: Props) {
  const canManage = canPerformAction(user, "plan.manage");
  const [hotelDate, setHotelDate] = useState(todayHotelDate);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [housekeepers, setHousekeepers] = useState<
    Array<{ id: string; fullName: string; employeeNumber: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [applyingEffects, setApplyingEffects] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");

  const [locationId, setLocationId] = useState("");
  const [category, setCategory] = useState<DailyPlanCategory>("departure");
  const [assigneeId, setAssigneeId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [notes, setNotes] = useState("");

  const refresh = useCallback(async () => {
    const [planData, roomData, hkData, shiftData] = await Promise.all([
      fetchDailyPlan(hotelDate),
      fetchRooms(),
      fetchHousekeepers().catch(() => []),
      fetchShifts(false).catch(() => [] as ShiftRow[]),
    ]);
    setPlan(planData);
    setRooms(roomData);
    setHousekeepers(hkData);
    setShifts(shiftData.filter((s) => s.isActive));
    if (!locationId && roomData[0]) setLocationId(roomData[0].id);
  }, [hotelDate, locationId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await refresh();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load plan");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

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

  async function onApplyDepartureEffects() {
    setApplyingEffects(true);
    setError(null);
    setMessage(null);
    try {
      const result = await applyDepartureRoomEffects(hotelDate);
      setMessage(
        result.total === 0
          ? "Няма чакащи ефекти от напускания за тази дата"
          : `Ефекти от напускания: приложени ${result.applied}, защитени ${result.skipped}, чакат потвърждение ${result.deferred}`,
      );
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Неуспешно прилагане на ефекти от напускания",
      );
    } finally {
      setApplyingEffects(false);
    }
  }

  async function onImport(e: FormEvent) {
    e.preventDefault();
    setImporting(true);
    setError(null);
    setMessage(null);
    try {
      const parsed = JSON.parse(importText) as {
        hotelDate?: string;
        sourceLabel?: string;
        entries?: unknown;
      };
      if (!parsed || typeof parsed !== "object") {
        throw new Error("JSON трябва да е обект");
      }
      const payload = {
        hotelDate: parsed.hotelDate || hotelDate,
        sourceLabel: parsed.sourceLabel || "clock",
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      };
      const result = await importDailyPlan(payload as Parameters<typeof importDailyPlan>[0]);
      setPlan(result.plan);
      if (result.plan.date) setHotelDate(result.plan.date);
      const b = result.batch;
      setMessage(
        `Импорт ${b.status}: създадени ${b.createdCount}, пропуснати ${b.skippedCount}, грешки ${b.errorCount}`,
      );
      if (b.errorCount > 0 && Array.isArray(b.errors) && b.errors.length) {
        const sample = b.errors
          .slice(0, 3)
          .map((err) => `${err.room ?? `#${err.index}`}: ${err.reason}`)
          .join("; ");
        setError(`Грешки при импорт: ${sample}`);
      }
    } catch (err) {
      setError(
        err instanceof SyntaxError
          ? "Невалиден JSON"
          : err instanceof Error
            ? err.message
            : "Import failed",
      );
    } finally {
      setImporting(false);
    }
  }

  function onImportFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setImportText(text);
    };
    reader.readAsText(file);
  }

  return (
    <main className="content">
      <header className="page-header">
        <div>
          <h1>Дневен план (Clock)</h1>
          <p>
            Ръчен план и договорен JSON импорт — не жива PMS/Clock синхронизация
          </p>
          <ScopeHint user={user} />
        </div>
        <label className="inline-search">
          Дата
          <input
            type="date"
            value={hotelDate}
            onChange={(e) => setHotelDate(e.target.value)}
          />
        </label>
      </header>

      {error && <div className="error banner">{error}</div>}
      {message && <div className="ok banner">{message}</div>}

      {canManage && (
        <section className="panel">
          <h2>Ефекти от напускания</h2>
          <p className="muted small">
            Четенето на плана не променя стаите. Приложи deferred vacant/dirty
            само за помещения в твоя обхват. Стаи с доказан по-нов престой се
            защитават; неясни минали напускания остават за потвърждение.
          </p>
          <button
            type="button"
            disabled={applyingEffects || loading}
            onClick={() => void onApplyDepartureEffects()}
          >
            {applyingEffects
              ? "Прилагане…"
              : "Приложи ефекти от напускания"}
          </button>
        </section>
      )}

      {plan?.lastImport && (
        <p className="muted small">
          Последен импорт ({plan.lastImport.sourceLabel}):{" "}
          {plan.lastImport.status} · създадени {plan.lastImport.createdCount} /{" "}
          {plan.lastImport.totalCount} ·{" "}
          {new Date(plan.lastImport.createdAt).toLocaleString("bg-BG")}
        </p>
      )}

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

      {canManage && (
        <section className="panel">
          <h2>Импорт (JSON)</h2>
          <form className="report-form" onSubmit={onImport}>
            <label>
              Файл
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => onImportFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <label className="full-width">
              JSON
              <textarea
                rows={10}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={EXAMPLE_IMPORT.replace(/YYYY-MM-DD/g, hotelDate)}
                required
              />
            </label>
            <button type="submit" disabled={importing || !importText.trim()}>
              {importing ? "Импорт…" : "Импортирай"}
            </button>
          </form>
          <p className="muted small">
            Стаи по buildingCode + roomNumber. Повторен импорт с еднакъв
            externalId или вече съществуващ запис се пропуска. Ръчните записи не
            се презаписват.
          </p>
        </section>
      )}

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
    </main>
  );
}
