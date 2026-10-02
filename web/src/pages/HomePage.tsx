import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  canResolveIssues,
  fetchRooms,
  fetchTickets,
  reportIssue,
  resolveIssue,
  type AuthUser,
  type MaintenanceTicket,
  type Room,
} from "../api/client";

type Props = {
  user: AuthUser;
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

export function HomePage({ user }: Props) {
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const [locationId, setLocationId] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("plumbing");
  const [priority, setPriority] = useState("normal");
  const [blocksRoom, setBlocksRoom] = useState(true);

  const canResolve = canResolveIssues(user.role);

  const refresh = useCallback(async () => {
    const [ticketData, roomData] = await Promise.all([
      fetchTickets({ limit: 20, status: "open" }),
      fetchRooms(),
    ]);
    setTickets(ticketData);
    setRooms(roomData);
    if (!locationId && roomData[0]) {
      setLocationId(roomData[0].id);
    }
  }, [locationId]);

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
    // intentionally once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!locationId || !title.trim()) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      await reportIssue({
        locationId,
        title: title.trim(),
        category,
        priority,
        blocksRoom,
      });
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

      {error && <div className="error banner">{error}</div>}
      {message && <div className="ok banner">{message}</div>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="home-grid">
          <section className="panel home-feed">
            <div className="panel-header">
              <h2>Последни проблеми</h2>
              <button type="button" className="ghost" onClick={() => refresh()}>
                Refresh
              </button>
            </div>
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
                        {ticket.category} · {ticket.status}
                      </span>
                    </div>
                    {canResolve && (
                      <button
                        type="button"
                        className="subtle"
                        disabled={resolvingId === ticket.id}
                        onClick={async () => {
                          const notes = window.prompt(
                            "Описание на решението (опционално)",
                          );
                          if (notes === null) return;
                          setResolvingId(ticket.id);
                          setError(null);
                          setMessage(null);
                          try {
                            await resolveIssue(ticket.id, notes);
                            setMessage("Проблемът е решен");
                            await refresh();
                          } catch (err) {
                            setError(
                              err instanceof Error ? err.message : "Resolve failed",
                            );
                          } finally {
                            setResolvingId(null);
                          }
                        }}
                      >
                        Resolve
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

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
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="climate">climate</option>
                  <option value="electrical">electrical</option>
                  <option value="furniture">furniture</option>
                  <option value="plumbing">plumbing</option>
                  <option value="other">other</option>
                </select>
              </label>
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
              <button type="submit" disabled={submitting || !locationId}>
                {submitting ? "Запис…" : "Добави проблем"}
              </button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
