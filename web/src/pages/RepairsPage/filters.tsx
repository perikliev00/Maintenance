/** Status / assignee / SLA / blocks filters for the ticket list query. */
import type { Person } from "../../api/client";
import { statusLabel, t } from "./helpers";

type FiltersProps = {
  locale: "bg" | "en";
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  assigneeFilter: string;
  onAssigneeFilterChange: (value: string) => void;
  slaOnly: boolean;
  onSlaOnlyChange: (value: boolean) => void;
  blocksOnly: boolean;
  onBlocksOnlyChange: (value: boolean) => void;
  people: Person[];
};

/**
 * Controlled filter row for the Repairs ticket list query
 * (status, assignee, SLA-only, blocking-only).
 */
export function Filters({
  locale,
  statusFilter,
  onStatusFilterChange,
  assigneeFilter,
  onAssigneeFilterChange,
  slaOnly,
  onSlaOnlyChange,
  blocksOnly,
  onBlocksOnlyChange,
  people,
}: FiltersProps) {
  return (
    <div className="toolbar filters-row">
      {/* Status bucket / exact status for the tickets query. */}
      <label>
        {t(locale, "Статус", "Status")}
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
        >
          {/* "open" is a server-side bucket; raw statuses are exact matches. */}
          <option value="open">{t(locale, "Отворени", "Open")}</option>
          <option value="all">{t(locale, "Всички", "All")}</option>
          <option value="resolved">{t(locale, "Решени", "Resolved")}</option>
          <option value="assigned">{statusLabel(locale, "assigned")}</option>
          <option value="in_progress">
            {statusLabel(locale, "in_progress")}
          </option>
          <option value="waiting">{statusLabel(locale, "waiting")}</option>
        </select>
      </label>
      {/* Assignee filter: all / mine / concrete employee. */}
      <label>
        {t(locale, "Изпълнител", "Assignee")}
        <select
          value={assigneeFilter}
          onChange={(e) => onAssigneeFilterChange(e.target.value)}
        >
          <option value="all">{t(locale, "Всички", "All")}</option>
          {/* "mine" is resolved to the current user on the parent page. */}
          <option value="mine">{t(locale, "Моите", "Mine")}</option>
          {people.map((p) => (
            <option key={p.employeeId} value={p.employeeId}>
              {p.fullName}
            </option>
          ))}
        </select>
      </label>
      {/* Restrict list to tickets with an active SLA breach/risk. */}
      <label className="check">
        <input
          type="checkbox"
          checked={slaOnly}
          onChange={(e) => onSlaOnlyChange(e.target.checked)}
        />
        {t(locale, "Просрочен SLA", "SLA breached")}
      </label>
      {/* Restrict list to tickets that block room readiness. */}
      <label className="check">
        <input
          type="checkbox"
          checked={blocksOnly}
          onChange={(e) => onBlocksOnlyChange(e.target.checked)}
        />
        {t(locale, "Блокиращи стая", "Blocking room")}
      </label>
    </div>
  );
}
