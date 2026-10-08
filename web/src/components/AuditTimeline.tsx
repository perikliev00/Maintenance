import type { AuditEventRow } from "../api/client";
import { auditHeadline } from "../audit/labels";

type Props = {
  events: AuditEventRow[];
  emptyLabel?: string;
  loading?: boolean;
  accessDenied?: boolean;
  error?: string | null;
  locale?: "bg" | "en";
};

export function AuditTimeline({
  events,
  emptyLabel = "Няма записи.",
  loading,
  accessDenied,
  error,
  locale = "bg",
}: Props) {
  if (loading) {
    return <p className="muted">Зареждане…</p>;
  }
  if (accessDenied) {
    return <p className="muted">Нямате достъп до тази хронология.</p>;
  }
  if (error) {
    return <p className="muted">{error}</p>;
  }
  if (events.length === 0) {
    return <p className="muted">{emptyLabel}</p>;
  }

  return (
    <ul className="audit-timeline">
      {events.map((ev) => (
        <li key={ev.id} className="audit-timeline-item">
          <div className="audit-timeline-meta">
            <span className="muted">
              {new Date(ev.occurredAt).toLocaleString()}
            </span>
            {ev.actor && (
              <span className="audit-timeline-actor">{ev.actor.fullName}</span>
            )}
          </div>
          <div className="audit-timeline-summary">
            {auditHeadline(ev, locale)}
          </div>
          {ev.reason && (
            <div className="muted audit-timeline-reason">
              Причина: {ev.reason}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
