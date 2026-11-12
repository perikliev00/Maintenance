/**
 * Read-only audit event list with loading / forbidden / error empty states.
 * `accessDenied` is separate from generic `error` so callers can show a soft
 * “no access” message without treating it as a hard failure.
 */
import type { AuditEventRow } from "../api/client";
import { auditHeadline } from "../audit/labels";
import { LoadingIndicator } from "./LoadingIndicator";

type Props = {
  events: AuditEventRow[];
  emptyLabel?: string;
  loading?: boolean;
  /** Permission denial for this timeline (distinct from fetch errors). */
  accessDenied?: boolean;
  error?: string | null;
  locale?: "bg" | "en";
};

/**
 * AuditTimeline React component / page.
 */
export function AuditTimeline({
  events,
  emptyLabel = "Няма записи.",
  loading,
  accessDenied,
  error,
  locale = "bg",
}: Props) {
  // Ordered empty states: loading → permission → error → empty list.
  if (loading) {
    return <LoadingIndicator label="Зареждане…" />;
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
    // Render JSX element.
    <ul className="audit-timeline">
            {events.map((ev) => (
        // Render JSX element.
        <li key={ev.id} className="audit-timeline-item">
                    <div className="audit-timeline-meta">
                        <span className="muted">
                            {new Date(ev.occurredAt).toLocaleString()}
                        </span>
                        {/* Actor is optional on system-generated events. */}
                        {ev.actor && (
              // Render JSX element.
              <span className="audit-timeline-actor">{ev.actor.fullName}</span>
            )}
                    </div>
                    <div className="audit-timeline-summary">
                        {auditHeadline(ev, locale)}
                    </div>
                    {/* Optional free-text reason from the mutating action. */}
                    {ev.reason && (
            // Render JSX element.
            <div className="muted audit-timeline-reason">
                            Причина: {ev.reason}
                        </div>
          )}
                </li>
      ))}
        </ul>
  );
}
