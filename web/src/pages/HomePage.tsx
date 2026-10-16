/**
 * Reception-style home: open tickets list + quick issue report form.
 * Live-refreshes on ticket/location/cleaning events; resolve actions gated by role.
 */
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  canResolveIssues,
  fetchIssueOptions,
  fetchMaintenanceCategories,
  fetchRooms,
  fetchTickets,
  reportIssue,
  type AuthUser,
  type IssueOptionRow,
  type MaintenanceCategoryRow,
  type MaintenanceTicket,
  type Room,
} from "../api/client";
import { TicketLifecycleActions } from "../components/TicketLifecycleActions";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
type Props = {
  user: AuthUser;
};

/** Localize an ISO timestamp for the open-tickets list. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

/** Prefer bilingual category label; fall back to legacy key fields. */
function ticketCategoryLabel(ticket: MaintenanceTicket): string {
  return ticket.categoryLabelBg ?? ticket.category ?? ticket.categoryKey ?? "—";
}

/**
 * Reception home: open tickets + quick report form.
 * Seeds room/category/option selects on first successful refresh.
 */
export function HomePage({ user }: Props) {
  // Open ticket feed for the left panel.
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  // Report-form selects and catalog.
  const [rooms, setRooms] = useState<Room[]>([]);
  const [categories, setCategories] = useState<MaintenanceCategoryRow[]>([]);
  const [issueOptions, setIssueOptions] = useState<IssueOptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Busy id for TicketLifecycleActions on a single ticket.
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  // Quick-report form drafts.
  const [locationId, setLocationId] = useState("");
  const [pickMode, setPickMode] = useState<"option" | "custom">("option");
  const [issueOptionId, setIssueOptionId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("normal");
  const [blocksRoom, setBlocksRoom] = useState(true);
  // Permission gate for TicketLifecycleActions on each open ticket.
  const canResolve = canResolveIssues(user.role);

  /** Apply catalog option defaults (priority / blocksRoom) into the form. */
  const applyOption = useCallback((opt: IssueOptionRow) => {
    setIssueOptionId(opt.id);
    setTitle(opt.nameBg);
    if (opt.defaultPriority) setPriority(opt.defaultPriority);
    if (opt.defaultBlocksRoom !== null && opt.defaultBlocksRoom !== undefined) {
      setBlocksRoom(opt.defaultBlocksRoom);
    }
  }, []);

  /**
   * Parallel fetch of tickets, rooms, and catalog for the form.
   * Seeds empty selects once so the form is immediately usable.
   */
  const refresh = useCallback(async () => {
    const [ticketData, roomData, catData, optData] = await Promise.all([
      fetchTickets({ limit: 20, status: "open" }),
      fetchRooms(),
      fetchMaintenanceCategories(),
      fetchIssueOptions(),
    ]);
    setTickets(ticketData);
    setRooms(roomData);
    setCategories(catData);
    setIssueOptions(optData);
    // Seed selects once when empty so the form is immediately usable.
    if (!locationId && roomData[0]) {
      setLocationId(roomData[0].id);
    }
    if (!categoryId && catData[0]) {
      setCategoryId(catData[0].id);
    }
    if (!issueOptionId && optData[0]) {
      applyOption(optData[0]);
    }
  }, [locationId, categoryId, issueOptionId, applyOption]);

  // Skip live refresh while initial load or a local mutation is in flight.
  const liveAt = useLiveRefresh(refresh, {
    enabled: !loading,
    busy: submitting || resolvingId !== null,
    eventTypes: ["ticket.changed", "location.changed", "cleaning.changed"],
  });

  // Mount-only initial load (refresh identity is intentionally omitted).
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load home");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Online reportIssue from the quick form (catalog or custom).
   * Validates location and custom title before the network call.
   */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Validation gates before the network call.
    if (!locationId) return;
    if (pickMode === "custom" && !title.trim()) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      // Catalog path vs free-text custom with categoryId.
      if (pickMode === "option" && issueOptionId) {
        await reportIssue({
          locationId,
          issueOptionId,
          title: title.trim() || undefined,
          priority,
          blocksRoom,
        });
      } else {
        await reportIssue({
          locationId,
          title: title.trim(),
          categoryId,
          priority,
          blocksRoom,
        });
      }
      setTitle("");
      setMessage("Проблемът е добавен");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to report issue");
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <main className="content">
      <header className="page-header">
        <div>
          <h1>Home</h1>
          <p>Отворени проблеми и бързо докладване</p>
        </div>
      </header>
      {/* Error / success feedback. */}
      {error && <div className="error banner">{error}</div>}
      {message && <div className="ok banner">{message}</div>}
      {/* Loading gate vs two-column home grid. */}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="home-grid">
          {/* Open tickets feed with lifecycle actions. */}
          <section className="panel home-feed">
            <div className="panel-header">
              <h2>Последни проблеми</h2>
              <button type="button" className="ghost" onClick={() => refresh()}>
                Refresh
              </button>
              {/* Live stamp when soft refresh last succeeded. */}
              {liveAt && (
                <span className="muted live-stamp" title={liveAt}>
                  live
                </span>
              )}
            </div>
            {/* Empty vs ticket cards. */}
            {tickets.length === 0 ? (
              <p className="muted">Няма отворени проблеми.</p>
            ) : (
              <ul className="issue-feed">
                {tickets.map((ticket) => (
                  <li
                    key={ticket.id}
                    className={`issue-card priority-${ticket.priority}`}
                  >
                    <div className="issue-card-top">
                      <strong>
                        {ticket.location.floor.building.code} {ticket.location.number}
                      </strong>
                      <span className={`pill priority-${ticket.priority}`}>
                        {ticket.priority}
                      </span>
                      {/* Blocking-readiness pill when ticket blocks the room. */}
                      {ticket.blocksRoom && (
                        <span className="pill ready-not_ready">blocks room</span>
                      )}
                    </div>
                    <p className="issue-title">{ticket.title}</p>
                    <div className="issue-meta muted">
                      <span>
                        {ticket.reportedBy.fullName} ({ticket.reportedBy.employeeNumber})
                      </span>
                      <span>{formatWhen(ticket.openedAt)}</span>
                      <span>
                        {ticketCategoryLabel(ticket)} · {ticket.status}
                      </span>
                      {/* Assignee chip when present. */}
                      {ticket.assignee && (
                        <span>→ {ticket.assignee.fullName}</span>
                      )}
                    </div>
                    {/* Resolve/start/hold gated by canResolve. */}
                    <TicketLifecycleActions
                      ticket={ticket}
                      busy={resolvingId === ticket.id}
                      canResolve={canResolve}
                      onBusy={setResolvingId}
                      onDone={(result) => {
                        setMessage(result.message);
                        setError(null);
                        void refresh();
                      }}
                      onError={(msg) => setError(msg)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
          {/* Quick report form: catalog option or custom free text. */}
          <section className="panel home-form">
            <h2>Добави проблем</h2>
            <form className="report-form" onSubmit={handleSubmit}>
              <label>
                Стая
                <select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  required
                >
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.buildingCode} {room.number} (fl. {room.floor})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Тип сигнал
                <select
                  value={pickMode}
                  onChange={(e) =>
                    setPickMode(e.target.value as "option" | "custom")
                  }
                >
                  <option value="option">От каталог</option>
                  <option value="custom">Друго (свободен текст)</option>
                </select>
              </label>
              {/* Catalog option select vs custom title + category. */}
              {pickMode === "option" ? (
                <label>
                  Опция
                  <select
                    value={issueOptionId}
                    onChange={(e) => {
                      const opt = issueOptions.find((o) => o.id === e.target.value);
                      if (opt) applyOption(opt);
                    }}
                    required
                  >
                    {issueOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.nameBg}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label>
                    Описание / проблем
                    <textarea
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      rows={4}
                      required
                      placeholder="Кратко описание на повредата…"
                    />
                  </label>
                  <label>
                    Категория
                    <select
                      value={categoryId}
                      onChange={(e) => setCategoryId(e.target.value)}
                      required
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nameBg}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {/* Optional clarification only in catalog pick mode. */}
              {pickMode === "option" && (
                <label>
                  Уточнение (опционално)
                  <textarea
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    rows={2}
                    placeholder="Допълнителни детайли…"
                  />
                </label>
              )}
              <label>
                Приоритет
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  <option value="low">low</option>
                  <option value="normal">normal</option>
                  <option value="high">high</option>
                  <option value="urgent">urgent</option>
                </select>
              </label>
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={blocksRoom}
                  onChange={(e) => setBlocksRoom(e.target.checked)}
                />
                Блокира готовността на стаята
              </label>
              <button
                type="submit"
                disabled={
                  submitting ||
                  !locationId ||
                  (pickMode === "option" ? !issueOptionId : !title.trim())
                }
              >
                {submitting ? "Запис…" : "Добави проблем"}
              </button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
