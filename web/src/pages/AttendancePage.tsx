import { useCallback, useEffect, useMemo, useState } from "react";
import {
  canPerformAction,
  downloadAttendanceCsv,
  fetchAttendanceIntervals,
  requestAttendanceAdjustment,
  reviewAttendanceAdjustment,
  type AttendanceInterval,
  type AttendanceScope,
  type AuthUser,
} from "../api/client";

type Props = { user: AuthUser };

const SCOPES: Array<{ id: AttendanceScope; bg: string; en: string }> = [
  { id: "month", bg: "Месец", en: "Month" },
  { id: "today", bg: "Днес", en: "Today" },
  { id: "week", bg: "Тази седмица", en: "This week" },
  { id: "review", bg: "За преглед", en: "For review" },
];

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatTs(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("bg-BG", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatHours(minutes: number | null): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

const STATUS_LABEL: Record<string, string> = {
  open: "отворен",
  closed: "затворен",
  needs_review: "за преглед",
  adjusted: "коригиран",
};

export function AttendancePage({ user }: Props) {
  const [scope, setScope] = useState<AttendanceScope>("month");
  const [month, setMonth] = useState(currentMonth);
  const [department, setDepartment] = useState("");
  const [q, setQ] = useState("");
  const [intervals, setIntervals] = useState<AttendanceInterval[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [maxSkew, setMaxSkew] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [adjustFor, setAdjustFor] = useState<AttendanceInterval | null>(null);
  const [adjReason, setAdjReason] = useState("");
  const [adjEnd, setAdjEnd] = useState("");
  const [adjBreak, setAdjBreak] = useState("30");

  const canRequest = canPerformAction(user, "attendance.request_adjustment");
  const canApprove = canPerformAction(user, "attendance.approve_adjustment");

  const refresh = useCallback(async () => {
    setError(null);
    const data = await fetchAttendanceIntervals({
      scope,
      month: scope === "month" ? month : undefined,
      department: department.trim() || undefined,
      q: q.trim() || undefined,
    });
    setIntervals(data.intervals);
    setTotal(data.total);
    setNextCursor(data.nextCursor);
    setMaxSkew(data.maxClockSkewSeconds);
  }, [scope, month, department, q]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const data = await fetchAttendanceIntervals({
        scope,
        month: scope === "month" ? month : undefined,
        department: department.trim() || undefined,
        q: q.trim() || undefined,
        cursor: nextCursor,
      });
      setIntervals((prev) => [...prev, ...data.intervals]);
      setTotal(data.total);
      setNextCursor(data.nextCursor);
      setMaxSkew(data.maxClockSkewSeconds);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load more attendance",
      );
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, scope, month, department, q]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await refresh();
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load attendance",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const row of intervals) {
      if (row.employee.department) set.add(row.employee.department);
    }
    return Array.from(set).sort();
  }, [intervals]);

  async function onExport() {
    try {
      await downloadAttendanceCsv({
        scope,
        month: scope === "month" ? month : undefined,
        department: department.trim() || undefined,
        q: q.trim() || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  }

  async function submitAdjustment() {
    if (!adjustFor || !adjReason.trim()) return;
    setBusyId(adjustFor.id);
    try {
      await requestAttendanceAdjustment({
        intervalId: adjustFor.id,
        reason: adjReason.trim(),
        proposedEndedAt: adjEnd ? new Date(adjEnd).toISOString() : undefined,
        proposedBreakMinutes: adjBreak ? Number(adjBreak) : undefined,
      });
      setAdjustFor(null);
      setAdjReason("");
      setAdjEnd("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Adjustment failed");
    } finally {
      setBusyId(null);
    }
  }

  async function onReview(
    adjustmentId: string,
    decision: "approved" | "rejected",
  ) {
    setBusyId(adjustmentId);
    try {
      await reviewAttendanceAdjustment(adjustmentId, { decision });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="content">
      <header className="page-header">
        <div>
          <h1>Присъствие</h1>
          <p>Работно време, почивки и записи за преглед</p>
        </div>
        <button type="button" className="primary" onClick={() => void onExport()}>
          Експорт CSV
        </button>
      </header>

      {maxSkew != null && maxSkew >= 1800 && (
        <div className="banner warn" role="status">
          Разлика спрямо сървъра до {maxSkew} секунди — проверете часовника на
          терминала.
        </div>
      )}

      <div className="toolbar" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
        <div className="segmented" role="tablist" aria-label="Период">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={scope === s.id}
              className={scope === s.id ? "active" : ""}
              onClick={() => setScope(s.id)}
            >
              {s.bg}
            </button>
          ))}
        </div>
        {scope === "month" && (
          <label>
            Месец
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </label>
        )}
        <label>
          Отдел
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <option value="">Всички</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            {!departments.includes("Housekeeping") && (
              <option value="Housekeeping">Housekeeping</option>
            )}
            {!departments.includes("Maintenance") && (
              <option value="Maintenance">Maintenance</option>
            )}
          </select>
        </label>
        <label>
          Търсене
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Име / служебен номер…"
          />
        </label>
        <button type="button" className="ghost" onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      {error && <div className="error banner">{error}</div>}

      {loading ? (
        <p className="muted">Зареждане…</p>
      ) : intervals.length === 0 ? (
        <p className="muted">Няма записи за избрания филтър.</p>
      ) : (
        <>
        <p className="muted" style={{ marginBottom: "0.5rem" }}>
          Показани {intervals.length} от {total}
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Служител</th>
                <th>Дата</th>
                <th>Начало</th>
                <th>Почивки</th>
                <th>Край</th>
                <th>Часове</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {intervals.map((row) => {
                const pending = row.adjustments.find(
                  (a) => a.status === "pending",
                );
                return (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.employee.fullName}</strong>
                      <div className="muted">
                        {row.employee.employeeNumber}
                        {row.employee.department
                          ? ` · ${row.employee.department}`
                          : ""}
                      </div>
                    </td>
                    <td>{row.hotelDate}</td>
                    <td>{formatTs(row.startedAt)}</td>
                    <td>{row.breakMinutes} мин</td>
                    <td>{formatTs(row.endedAt)}</td>
                    <td>{formatHours(row.workedMinutes)}</td>
                    <td>
                      <span className={`pill status-${row.status}`}>
                        {STATUS_LABEL[row.status] ?? row.status}
                      </span>
                      {row.anomalyFlags.length > 0 && (
                        <div className="muted" style={{ fontSize: "0.8rem" }}>
                          {row.anomalyFlags.join(", ")}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        {canRequest && (
                          <button
                            type="button"
                            className="ghost"
                            disabled={busyId === row.id}
                            onClick={() => {
                              setAdjustFor(row);
                              setAdjReason("");
                              setAdjBreak(String(row.breakMinutes || 30));
                              setAdjEnd(
                                row.endedAt
                                  ? row.endedAt.slice(0, 16)
                                  : "",
                              );
                            }}
                          >
                            Корекция
                          </button>
                        )}
                        {canApprove && pending && (
                          <>
                            <button
                              type="button"
                              className="primary"
                              disabled={busyId === pending.id}
                              onClick={() =>
                                void onReview(pending.id, "approved")
                              }
                            >
                              Одобри
                            </button>
                            <button
                              type="button"
                              className="ghost"
                              disabled={busyId === pending.id}
                              onClick={() =>
                                void onReview(pending.id, "rejected")
                              }
                            >
                              Откажи
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {nextCursor && (
          <div style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              className="ghost"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? "Зареждане…" : "Зареди още"}
            </button>
          </div>
        )}
        </>
      )}

      {adjustFor && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-labelledby="adj-title">
            <h2 id="adj-title">Заявка за корекция</h2>
            <p className="muted">
              {adjustFor.employee.fullName} · {adjustFor.hotelDate}
            </p>
            <label>
              Причина
              <textarea
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                rows={3}
                required
              />
            </label>
            <label>
              Предложен край
              <input
                type="datetime-local"
                value={adjEnd}
                onChange={(e) => setAdjEnd(e.target.value)}
              />
            </label>
            <label>
              Почивки (мин)
              <input
                type="number"
                min={0}
                value={adjBreak}
                onChange={(e) => setAdjBreak(e.target.value)}
              />
            </label>
            <div className="row-actions">
              <button
                type="button"
                className="primary"
                disabled={!adjReason.trim() || busyId === adjustFor.id}
                onClick={() => void submitAdjustment()}
              >
                Изпрати
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => setAdjustFor(null)}
              >
                Отказ
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
