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
import { LoadingIndicator } from "../components/LoadingIndicator";
import { FormModal } from "../components/FormModal";
import { SectionNav, Surface, Workspace, WorkspaceIntro } from "../ui";

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
    <Workspace className="ui-attendance-workspace">
      <WorkspaceIntro eyebrow="ВРЕМЕ И ПРИСЪСТВИЕ" title="Присъствие" description="Проследете работните интервали и прегледайте записите, които изискват решение." actions={<button type="button" onClick={() => void onExport()}>Експорт CSV</button>} />
      {maxSkew != null && maxSkew >= 1800 && <div className="banner warn" role="status">Разлика спрямо сървъра до {maxSkew} секунди — проверете часовника на терминала.</div>}
      {error && <div className="error banner" role="alert">{error}</div>}
      <div className="ui-section-layout">
        <aside className="ui-context-panel">
          <SectionNav<AttendanceScope> label="Период" items={SCOPES.map((item) => ({id: item.id, label: item.bg}))} value={scope} onChange={setScope} />
          {scope === "month" && <label>Месец<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>}
          <label>Отдел<select value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">Всички</option>{departments.map((item) => <option key={item} value={item}>{item}</option>)}
            {!departments.includes("Housekeeping") && <option value="Housekeeping">Housekeeping</option>}
            {!departments.includes("Maintenance") && <option value="Maintenance">Maintenance</option>}
          </select></label>
          <label>Търсене<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Име / служебен номер…" /></label>
          <button type="button" className="ghost" onClick={() => void refresh()}>Refresh</button>
        </aside>
        <div className="ui-section-content">
          <Surface title="Работни интервали" actions={<span className="muted" aria-live="polite">Показани {intervals.length} от {total}</span>}>
            {loading ? <LoadingIndicator label="Зареждане…" /> : intervals.length === 0 ? <p className="ui-empty-state">Няма записи за избрания филтър.</p> : <div className="ui-time-ledger">
              {intervals.map((row) => {
                const pending = row.adjustments.find((adjustment) => adjustment.status === "pending");
                return <article className="ui-ledger-entry" key={row.id} aria-label={`${row.employee.fullName} ${row.hotelDate}`}>
                  <header className="ui-ledger-heading"><div><p className="ui-eyebrow">{row.hotelDate}</p><h3>{row.employee.fullName}</h3><p className="muted">{row.employee.employeeNumber}{row.employee.department ? ` · ${row.employee.department}` : ""}</p></div><div className="ui-time-total"><strong>{formatHours(row.workedMinutes)}</strong><span>отработени часове</span></div></header>
                  <dl className="ui-record-facts"><div><dt>Начало</dt><dd>{formatTs(row.startedAt)}</dd></div><div><dt>Почивки</dt><dd>{row.breakMinutes} мин</dd></div><div><dt>Край</dt><dd>{formatTs(row.endedAt)}</dd></div><div><dt>Статус</dt><dd><span className={`pill status-${row.status}`}>{STATUS_LABEL[row.status] ?? row.status}</span></dd></div></dl>
                  {row.anomalyFlags.length > 0 && <p className="warn-inline">{row.anomalyFlags.join(", ")}</p>}
                  {pending && <div className="ui-pending-review"><strong>Заявена корекция</strong><p>{pending.reason}</p><p className="muted">{pending.requestedBy.fullName}{pending.proposedEndedAt ? ` · предложен край: ${formatTs(pending.proposedEndedAt)}` : ""}{pending.proposedBreakMinutes != null ? ` · почивки: ${pending.proposedBreakMinutes} мин` : ""}</p></div>}
                  <footer className="ui-record-actions">
                    {canRequest && <button type="button" className="ghost" disabled={busyId === row.id} onClick={() => { setAdjustFor(row); setAdjReason(""); setAdjBreak(String(row.breakMinutes || 30)); setAdjEnd(row.endedAt ? row.endedAt.slice(0, 16) : ""); }}>Корекция</button>}
                    {canApprove && pending && <><button type="button" disabled={busyId === pending.id} onClick={() => void onReview(pending.id, "approved")}>Одобри</button><button type="button" className="ghost" disabled={busyId === pending.id} onClick={() => void onReview(pending.id, "rejected")}>Откажи</button></>}
                  </footer>
                </article>;
              })}
            </div>}
            {nextCursor && <div className="ui-pagination"><button type="button" className="ghost" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? <LoadingIndicator variant="inline" delayMs={0} label="Зареждане…" /> : "Зареди още"}</button></div>}
          </Surface>
        </div>
      </div>
      {adjustFor && <FormModal title="Заявка за корекция" busy={busyId === adjustFor.id} error={error} submitLabel="Изпрати" submitDisabled={!adjReason.trim()} cancelLabel="Отказ" onClose={() => setAdjustFor(null)} onSubmit={(event) => { event.preventDefault(); void submitAdjustment(); }}>
        <p className="muted">{adjustFor.employee.fullName} · {adjustFor.hotelDate}</p>
        <label>Причина<textarea value={adjReason} onChange={(e) => setAdjReason(e.target.value)} rows={3} required /></label>
        <label>Предложен край<input type="datetime-local" value={adjEnd} onChange={(e) => setAdjEnd(e.target.value)} /></label>
        <label>Почивки (мин)<input type="number" min={0} value={adjBreak} onChange={(e) => setAdjBreak(e.target.value)} /></label>
      </FormModal>}
    </Workspace>
  );
}
