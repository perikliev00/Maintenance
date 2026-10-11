import type { Person } from "../../api/client";
import { t } from "./helpers";

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
      <label>
        {t(locale, "Статус", "Status")}
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
        >
          <option value="open">{t(locale, "Отворени", "Open")}</option>
          <option value="all">{t(locale, "Всички", "All")}</option>
          <option value="resolved">{t(locale, "Решени", "Resolved")}</option>
          <option value="assigned">assigned</option>
          <option value="in_progress">in_progress</option>
          <option value="waiting">waiting</option>
        </select>
      </label>
      <label>
        {t(locale, "Изпълнител", "Assignee")}
        <select
          value={assigneeFilter}
          onChange={(e) => onAssigneeFilterChange(e.target.value)}
        >
          <option value="all">{t(locale, "Всички", "All")}</option>
          <option value="mine">{t(locale, "Моите", "Mine")}</option>
          {people.map((p) => (
            <option key={p.employeeId} value={p.employeeId}>
              {p.fullName}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={slaOnly}
          onChange={(e) => onSlaOnlyChange(e.target.checked)}
        />
        SLA
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={blocksOnly}
          onChange={(e) => onBlocksOnlyChange(e.target.checked)}
        />
        {t(locale, "Блокиращи", "Blocking")}
      </label>
    </div>
  );
}
