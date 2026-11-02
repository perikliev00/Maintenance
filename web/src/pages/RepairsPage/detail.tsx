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
  IssueReportForm,
  type IssuePriority,
} from "../../components/IssueReportForm";
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
          <IssueReportForm
            locale={locale}
            mode="catalog-only"
            optionId={issueOptionId}
            titlePreview={title || null}
            description={description}
            showDescription
            blocksRoom={blocksRoom}
            priority={priority}
            options={options}
            categories={categories}
            labels={{
              blocksRoom: t(locale, "Блокира стая", "Blocks room"),
            }}
            beforeFields={
              <label>
                {t(locale, "Стая", "Room")}
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
            }
            onOptionIdChange={(id) => onIssueOptionSelect(id)}
            onDescriptionChange={onDescriptionChange}
            onBlocksRoomChange={onBlocksRoomChange}
            onPriorityChange={(p: IssuePriority) => onPriorityChange(p)}
            confirmBlocksRoom={(next) => {
              if (!next) return true;
              return window.confirm(
                t(
                  locale,
                  "Стаята ще остане „не готова“ за настаняване, докато този проблем е отворен. Потвърждавате ли?",
                  "The room will stay not-ready for occupancy while this issue is open. Confirm?",
                ),
              );
            }}
            afterBlocks={
              blocksRoom ? (
                <p className="warn-inline" role="status">
                  {t(
                    locale,
                    "Стаята няма да е готова за настаняване, докато проблемът е отворен.",
                    "The room will not be ready for occupancy while this issue is open.",
                  )}
                </p>
              ) : null
            }
          />
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
