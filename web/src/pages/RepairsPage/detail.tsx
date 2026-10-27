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
import {
  isArchivedLocation,
  locLabel,
  priorityLabel,
  statusLabel,
  t,
} from "./helpers";

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
  /** Display-only catalog title applied when an option is selected. */
  title: string;
  description: string;
  onDescriptionChange: (value: string) => void;
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
  description,
  onDescriptionChange,
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
                  {locale === "en" ? o.nameEn : o.nameBg}
                </option>
              ))}
            </select>
          </label>
          {title ? (
            <p className="muted">
              {t(locale, "Заглавие", "Title")}: <strong>{title}</strong>
            </p>
          ) : null}
          <label>
            {t(locale, "Уточнение (опционално)", "Clarification (optional)")}
            <textarea
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              rows={2}
              placeholder={t(
                locale,
                "Допълнителни детайли…",
                "Additional details…",
              )}
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
              <option value="low">{priorityLabel(locale, "low")}</option>
              <option value="normal">{priorityLabel(locale, "normal")}</option>
              <option value="high">{priorityLabel(locale, "high")}</option>
              <option value="urgent">{priorityLabel(locale, "urgent")}</option>
            </select>
          </label>
          {/* Whether the new ticket should block room readiness. */}
          <label className="check">
            {/* Text/checkbox input. */}
            <input
              type="checkbox"
              checked={blocksRoom}
              onChange={(e) => {
                const next = e.target.checked;
                if (
                  next &&
                  !window.confirm(
                    t(
                      locale,
                      "Стаята ще остане „не готова“ за настаняване, докато този проблем е отворен. Потвърждавате ли?",
                      "The room will stay not-ready for occupancy while this issue is open. Confirm?",
                    ),
                  )
                ) {
                  return;
                }
                onBlocksRoomChange(next);
              }}
            />
            {t(locale, "Блокира стая", "Blocks room")}
          </label>
          {blocksRoom && (
            <p className="warn-inline" role="status">
              {t(
                locale,
                "Стаята няма да е готова за настаняване, докато проблемът е отворен.",
                "The room will not be ready for occupancy while this issue is open.",
              )}
            </p>
          )}
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
            {isArchivedLocation(selected)
              ? ` · ${t(locale, "архивирана локация", "archived location")}`
              : ""}
            {selected.blocksRoom
              ? ` · ${t(locale, "блокира стая", "blocks room")}`
              : ""}
            {selected.assignee?.fullName
              ? ` · ${t(locale, "изпълнител", "assignee")}: ${selected.assignee.fullName}`
              : ` · ${t(locale, "без изпълнител", "unassigned")}`}
          </p>
          <p>
            <span className={`pill status-${selected.status}`}>
              {statusLabel(locale, selected.status)}
            </span>{" "}
            <span className="muted">
              {priorityLabel(locale, selected.priority)}
            </span>
          </p>
          {/* List of items. */}
          <ul className="event-list">
            {events.map((ev) => (
              <li key={ev.id}>
                <strong>
                  {/* Show transition arrow only when fromStatus is present. */}
                  {ev.fromStatus
                    ? `${statusLabel(locale, ev.fromStatus)} → `
                    : ""}
                  {statusLabel(locale, ev.toStatus)}
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
