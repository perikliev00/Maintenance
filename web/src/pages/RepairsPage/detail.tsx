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
  return (
    <aside className="panel repairs-side">
      {canReport && (
        <form className="stack" onSubmit={onReport}>
          <h2>{t(locale, "Докладвай", "Report")}</h2>
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
          <label>
            {t(locale, "Опция", "Option")}
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
          <label>
            {t(locale, "Заглавие", "Title")}
            <input
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
            />
          </label>
          <label>
            {t(locale, "Приоритет", "Priority")}
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
          <label className="check">
            <input
              type="checkbox"
              checked={blocksRoom}
              onChange={(e) => onBlocksRoomChange(e.target.checked)}
            />
            {t(locale, "Блокира стая", "Blocks room")}
          </label>
          <button type="submit" disabled={submitting}>
            {t(locale, "Докладвай", "Report")}
          </button>
          {categories.length === 0 && (
            <p className="muted">
              {t(locale, "Няма категории", "No categories")}
            </p>
          )}
        </form>
      )}

      {selected && (
        <div className="stack" style={{ marginTop: "1.5rem" }}>
          <h2>{t(locale, "Хронология", "Timeline")}</h2>
          <p className="muted">
            {locLabel(selected)} · {selected.title}
          </p>
          <ul className="event-list">
            {events.map((ev) => (
              <li key={ev.id}>
                <strong>
                  {ev.fromStatus ? `${ev.fromStatus} → ` : ""}
                  {ev.toStatus}
                </strong>
                <span className="muted">
                  {" "}
                  · {ev.actor?.fullName ?? "—"} ·{" "}
                  {new Date(ev.occurredAt).toLocaleString()}
                </span>
                {ev.reason && <div>{ev.reason}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
