/**
 * Repairs side panel: optional report form (`canReport`) plus selected ticket
 * summary and event timeline.
 */
import type { FormEvent } from "react";
import type {
  IssueOptionRow,
  MaintenanceCategoryRow,
  MaintenanceTicket,
  Room,
} from "../../api/client";
import { locLabel, t } from "./helpers";

export type TicketEventRow = {
  id: string;
  toStatus: string;
  fromStatus?: string | null;
  reason?: string | null;
  occurredAt: string;
  actor?: { fullName: string };
};

type DetailProps = {
  locale: "bg" | "en";
  canReport: boolean;
  locationId: string;
  onLocationIdChange: (value: string) => void;
  issueOptionId: string;
  title: string;
  onTitleChange: (value: string) => void;
  priority: string;
  onPriorityChange: (value: string) => void;
  blocksRoom: boolean;
  onBlocksRoomChange: (value: boolean) => void;
  submitting: boolean;
  rooms: Room[];
  options: IssueOptionRow[];
  categories: MaintenanceCategoryRow[];
  selected: MaintenanceTicket | null;
  events: TicketEventRow[];
  onReport: (e: FormEvent) => void;
  onIssueOptionSelect: (optionId: string) => void;
};

/**
 * Repairs side panel: optional report form (`canReport`) plus selected ticket
 * summary and event timeline.
 */
export function Detail({
  locale,
  canReport,
  locationId,
  onLocationIdChange,
  issueOptionId,
  title,
  onTitleChange,
  priority,
  onPriorityChange,
  blocksRoom,
  onBlocksRoomChange,
  submitting,
  rooms,
  options,
  categories,
  selected,
  events,
  onReport,
  onIssueOptionSelect,
}: DetailProps) {
  // Render output.
  // Side panel.
  return (
    <aside className="panel repairs-side">
      {/* Report form — hidden without report permission. */}
      {/* Editable form. */}
      {canReport && (
        <form className="stack" onSubmit={onReport}>
          {/* Section heading. */}
          <h2>{t(locale, "Докладвай", "Report")}</h2>
          {/* Room picker — locations already loaded by the parent page. */}
          <label>
            {t(locale, "Стая", "Room")}
            {/* Select input. */}
            <select
              value={locationId}
              onChange={(e) => onLocationIdChange(e.target.value)}
            >
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.buildingCode} {r.number}
                </option>
              ))}
            </select>
          </label>
          {/* Catalog option — parent may fill title/priority defaults. */}
          <label>
            {t(locale, "Опция", "Option")}
            {/* Select input. */}
            <select
              value={issueOptionId}
              onChange={(e) => onIssueOptionSelect(e.target.value)}
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nameBg}
                </option>
              ))}
            </select>
          </label>
          {/* Form field. */}
          <label>
            {t(locale, "Заглавие", "Title")}
            {/* Text/checkbox input. */}
            <input
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
            />
          </label>
          {/* Form field. */}
          <label>
            {t(locale, "Приоритет", "Priority")}
            {/* Select input. */}
            <select
              value={priority}
              onChange={(e) => onPriorityChange(e.target.value)}
            >
              <option value="low">low</option>
              <option value="normal">normal</option>
              <option value="high">high</option>
              <option value="urgent">urgent</option>
            </select>
          </label>
          {/* Whether the new ticket should block room readiness. */}
          <label className="check">
            {/* Text/checkbox input. */}
            <input
              type="checkbox"
              checked={blocksRoom}
              onChange={(e) => onBlocksRoomChange(e.target.checked)}
            />
            {t(locale, "Блокира стая", "Blocks room")}
          </label>
          {/* Submit disabled while the parent mutation/outbox write is in flight. */}
          <button type="submit" disabled={submitting}>
            {t(locale, "Докладвай", "Report")}
          </button>
          {/* Soft warning when the issue catalog has no categories yet. */}
          {categories.length === 0 && (
            <p className="muted">
              {t(locale, "Няма категории", "No categories")}
            </p>
          )}
        </form>
      )}

      {/* Timeline for the ticket currently selected in the list. */}
      {selected && (
        <div className="stack" style={{ marginTop: "1.5rem" }}>
          {/* Section heading. */}
          <h2>{t(locale, "Хронология", "Timeline")}</h2>
          <p className="muted">
            {locLabel(selected)} · {selected.title}
          </p>
          {/* List of items. */}
          <ul className="event-list">
            {events.map((ev) => (
              <li key={ev.id}>
                <strong>
                  {/* Show transition arrow only when fromStatus is present. */}
                  {ev.fromStatus ? `${ev.fromStatus} → ` : ""}
                  {ev.toStatus}
                </strong>
                <span className="muted">
                  {" "}
                  · {ev.actor?.fullName ?? "—"} ·{" "}
                  {new Date(ev.occurredAt).toLocaleString()}
                </span>
                {/* Optional free-text reason from the lifecycle action. */}
                {ev.reason && <div>{ev.reason}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
