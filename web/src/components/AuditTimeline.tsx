/**
 * Read-only audit event list with loading / forbidden / error empty states.
 * `accessDenied` is separate from generic `error` so callers can show a soft
 * “no access” message without treating it as a hard failure.
 */
import type { AuditEventRow } from "../api/client";
// Import dependency used by this module.
import { auditHeadline } from "../audit/labels";
// Import dependency used by this module.
import { LoadingIndicator } from "./LoadingIndicator";

// Local type alias shaping data.
type Props = {
  // Field/property in this shape.
  events: AuditEventRow[];
  // Field/property in this shape.
  emptyLabel?: string;
  // Field/property in this shape.
  loading?: boolean;
  /** Permission denial for this timeline (distinct from fetch errors). */
  accessDenied?: boolean;
  // Field/property in this shape.
  error?: string | null;
  // Field/property in this shape.
  locale?: "bg" | "en";
};

/**
 * AuditTimeline React component / page.
 */
export function AuditTimeline({
  // List item in import/export/params.
  events,
  // Assign value for subsequent use.
  emptyLabel = "Няма записи.",
  // List item in import/export/params.
  loading,
  // List item in import/export/params.
  accessDenied,
  // List item in import/export/params.
  error,
  // Assign value for subsequent use.
  locale = "bg",
// Open multi-line construct.
}: Props) {
  // Ordered empty states: loading → permission → error → empty list.
  if (loading) {
    // Return computed result to caller.
    return <LoadingIndicator label="Зареждане…" />;
  }
  // Conditional branch for this case.
  if (accessDenied) {
    // Return computed result to caller.
    return <p className="muted">Нямате достъп до тази хронология.</p>;
  }
  // Conditional branch for this case.
  if (error) {
    // Return computed result to caller.
    return <p className="muted">{error}</p>;
  }
  // Conditional branch for this case.
  if (events.length === 0) {
    // Return computed result to caller.
    return <p className="muted">{emptyLabel}</p>;
  }

  // Return computed result to caller.
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
