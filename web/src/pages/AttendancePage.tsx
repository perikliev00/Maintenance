/**
 * Attendance intervals list with CSV export and adjustment request/approve flow.
 * Request vs approve are separately gated (`attendance.request_adjustment` /
 * `attendance.approve_adjustment`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canPerformAction,
  downloadAttendanceCsv,
  fetchAttendanceIntervals,
  requestAttendanceAdjustment,
  reviewAttendanceAdjustment,
  todayHotelDate,
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

/** Current calendar month as YYYY-MM for the month-scope picker. */
function currentMonth(): string {
  return todayHotelDate().slice(0, 7);
}

/** Compact BG locale timestamp; em-dash when null (open interval). */
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

/** Worked minutes as H:MM; em-dash when null. */
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

/**
 * Attendance intervals list with CSV export and adjustment request/approve.
 * Request vs approve are separately gated.
 */
export function AttendancePage({ user }: Props) {
  // Scope + month drive the primary list query.
  const [scope, setScope] = useState<AttendanceScope>("month");
  const [month, setMonth] = useState(currentMonth);
  // Optional department and free-text name/number filters.
  const [department, setDepartment] = useState("");
  const [q, setQ] = useState("");
  const filterKey = JSON.stringify([scope, month, department, q]);
  const filterRef = useRef(filterKey);
  filterRef.current = filterKey;
  // Paginated intervals + total for the "shown X of Y" stamp.
  const [intervals, setIntervals] = useState<AttendanceInterval[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // Terminal clock skew vs server (seconds); banner when large.
  const [maxSkew, setMaxSkew] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Busy id for adjustment request or approve/reject rows.
  const [busyId, setBusyId] = useState<string | null>(null);

  // Adjustment modal state (null = closed).
  const [adjustFor, setAdjustFor] = useState<AttendanceInterval | null>(null);
  const [adjReason, setAdjReason] = useState("");
  const [adjEnd, setAdjEnd] = useState("");
  const [adjBreak, setAdjBreak] = useState("30");

  // Separate permission gates for request vs approve flows.
  const canRequest = canPerformAction(user, "attendance.request_adjustment");
  const canApprove = canPerformAction(user, "attendance.approve_adjustment");

  /** Fetch first page of intervals for the current filters. */
  const refresh = useCallback(async () => {
    setError(null);
    // Month is only sent when scope is "month"; other scopes use server defaults.
    const data = await fetchAttendanceIntervals({
      scope,
      month: scope === "month" ? month : undefined,
      department: department.trim() || undefined,
      q: q.trim() || undefined,
    });
    if (filterRef.current !== filterKey) return;
    setIntervals(data.intervals);
    setTotal(data.total);
    setNextCursor(data.nextCursor);
    setMaxSkew(data.maxClockSkewSeconds);
  }, [scope, month, department, q]);

  /** Append the next cursor page onto the current list. */
  const loadMore = useCallback(async () => {
    // Guard against double-clicks / missing cursor.
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
      if (filterRef.current !== filterKey) return;
      // Append rather than replace so prior rows stay visible.
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

  // Re-fetch when filters change; ignore late responses after unmount.
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

  // Department filter options derived from currently loaded rows.
  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const row of intervals) {
      if (row.employee.department) set.add(row.employee.department);
    }
    return Array.from(set).sort();
  }, [intervals]);

  /** Trigger CSV download; warn when the server truncated the export. */
  async function onExport() {
    try {
      const result = await downloadAttendanceCsv({
        scope,
        month: scope === "month" ? month : undefined,
        department: department.trim() || undefined,
        q: q.trim() || undefined,
      });
      // Truncation is surfaced as a banner so ops can narrow filters.
      if (result.truncated) {
        const totalLabel =
          result.total != null ? ` (общо ${result.total})` : "";
        setError(
          `CSV експортът е отрязан до тавана на сървъра${totalLabel}. Стеснете филтъра.`,
        );
      } else {
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    }
  }

  /**
   * Submit an adjustment request for the interval open in the modal.
   * Early-returns when the modal is closed or reason is empty.
   */
  async function submitAdjustment() {
    // Early return: modal closed or reason missing.
    if (!adjustFor || !adjReason.trim()) return;
    setBusyId(adjustFor.id);
    try {
      // Optional proposed end/break; omit when fields are empty.
      await requestAttendanceAdjustment({
        intervalId: adjustFor.id,
        reason: adjReason.trim(),
        proposedEndedAt: adjEnd ? new Date(adjEnd).toISOString() : undefined,
        proposedBreakMinutes: adjBreak ? Number(adjBreak) : undefined,
      });
      // Close modal and reload so pending adjustments appear.
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

  /**
   * Approve or reject a pending adjustment by id.
   * Reloads the list so status pills and pending buttons update.
   */
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

      {/* Warn when terminal clock skew vs server exceeds 30 minutes. */}
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
        {/* Month picker only relevant for month scope. */}
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
            {/* Always offer common departments even if absent from loaded rows. */}
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

      {/* Surface load/export/adjustment errors. */}
      {error && <div className="error banner">{error}</div>}

      {/* Loading vs empty vs interval table. */}
      {loading ? (
        <p className="muted">Зареждане…</p>
      ) : intervals.length === 0 ? (
        <p className="muted">Няма записи за избрания филтър.</p>
      ) : (
        <>
        {/* Pagination stamp: loaded rows vs server total. */}
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
                // First pending adjustment drives approve/reject buttons.
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
                      {/* Anomaly flag chips under the status pill. */}
                      {row.anomalyFlags.length > 0 && (
                        <div className="muted" style={{ fontSize: "0.8rem" }}>
                          {row.anomalyFlags.join(", ")}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="row-actions">
                        {/* Request gate — opens modal with prefilled end/break. */}
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
                        {/* Approve gate — only when a pending adjustment exists. */}
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
        {/* Cursor pagination — hide when no next page. */}
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

      {/* Adjustment request modal — closed when adjustFor is null. */}
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
