/** Status / assignee / SLA / blocks filters for the ticket list query. */
import type { Person } from "../../api/client";
// Import module dependency from ./helpers.
import { statusLabel, t } from "./helpers";

// Declare type alias FiltersProps.
type FiltersProps = {
  // Provide locale field used by this structure.
  locale: "bg" | "en";
  // Provide statusFilter field used by this structure.
  statusFilter: string;
  // Provide onStatusFilterChange field used by this structure.
  onStatusFilterChange: (value: string) => void;
  // Provide assigneeFilter field used by this structure.
  assigneeFilter: string;
  // Provide onAssigneeFilterChange field used by this structure.
  onAssigneeFilterChange: (value: string) => void;
  // Provide slaOnly field used by this structure.
  slaOnly: boolean;
  // Provide onSlaOnlyChange field used by this structure.
  onSlaOnlyChange: (value: boolean) => void;
  // Provide blocksOnly field used by this structure.
  blocksOnly: boolean;
  // Provide onBlocksOnlyChange field used by this structure.
  onBlocksOnlyChange: (value: boolean) => void;
  // Provide people field used by this structure.
  people: Person[];
};

/**
 * Controlled filter row for the Repairs ticket list query
 * (status, assignee, SLA-only, blocking-only).
 */
export function Filters({
  // Support the surrounding logic for this step.
  locale,
  // Support the surrounding logic for this step.
  statusFilter,
  // Support the surrounding logic for this step.
  onStatusFilterChange,
  // Support the surrounding logic for this step.
  assigneeFilter,
  // Support the surrounding logic for this step.
  onAssigneeFilterChange,
  // Support the surrounding logic for this step.
  slaOnly,
  // Support the surrounding logic for this step.
  onSlaOnlyChange,
  // Support the surrounding logic for this step.
  blocksOnly,
  // Support the surrounding logic for this step.
  onBlocksOnlyChange,
  // Support the surrounding logic for this step.
  people,
// Support the surrounding logic for this step.
}: FiltersProps) {
  // Return the JSX/UI tree for this render path.
  return (
    // Render a <div> element for layout or semantics.
    <div className="toolbar filters-row">
      {/* Status bucket / exact status for the tickets query. */}
      <label>
        {t(locale, "Статус", "Status")}
        <select
          // Pass value prop/value into the element or config.
          value={statusFilter}
          // Pass onChange prop/value into the element or config.
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
          // Pass value prop/value into the element or config.
          value={assigneeFilter}
          // Pass onChange prop/value into the element or config.
          onChange={(e) => onAssigneeFilterChange(e.target.value)}
        >
          <option value="all">{t(locale, "Всички", "All")}</option>
          {/* "mine" is resolved to the current user on the parent page. */}
          <option value="mine">{t(locale, "Моите", "Mine")}</option>
          {people.map((p) => (
            // Render a <option> element for layout or semantics.
            <option key={p.employeeId} value={p.employeeId}>
              // Support the surrounding logic for this step.
              {p.fullName}
            </option>
          // Support the surrounding logic for this step.
          ))}
        </select>
      </label>
      {/* Restrict list to tickets with an active SLA breach/risk. */}
      <label className="check">
        <input
          // Declare a type alias.
          type="checkbox"
          // Pass checked prop/value into the element or config.
          checked={slaOnly}
          // Pass onChange prop/value into the element or config.
          onChange={(e) => onSlaOnlyChange(e.target.checked)}
        />
        {t(locale, "Просрочен SLA", "SLA breached")}
      </label>
      {/* Restrict list to tickets that block room readiness. */}
      <label className="check">
        <input
          // Declare a type alias.
          type="checkbox"
          // Pass checked prop/value into the element or config.
          checked={blocksOnly}
          // Pass onChange prop/value into the element or config.
          onChange={(e) => onBlocksOnlyChange(e.target.checked)}
        />
        {t(locale, "Блокиращи стая", "Blocking room")}
      </label>
    </div>
  );
}
