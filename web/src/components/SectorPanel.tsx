/**
 * Presentational sector list + create/edit form.
 * Create/edit UI is gated by `canManage`; supervisor scope locks the supervisor select
 * so assignees cannot reassign sectors outside their scope.
 */
import type { FormEvent } from "react";
import type { Person, Room, SectorRow } from "../api/client";

type Props = {
  label: (bg: string, en: string) => string;
  locale: "bg" | "en";
  sectors: SectorRow[];
  supervisors: Person[];
  filteredRooms: Room[];
  /** When false, edit buttons and the form are hidden. */
  canManage: boolean;
  /** When true, primary supervisor cannot be changed in the form. */
  isSupervisorScope: boolean;
  busy: boolean;
  editingSectorId: string | null;
  sectorCode: string;
  sectorNameBg: string;
  sectorNameEn: string;
  sectorSupervisorId: string;
  sectorActive: boolean;
  selectedLocationIds: string[];
  locationFilter: string;
  onSectorCodeChange: (value: string) => void;
  onSectorNameBgChange: (value: string) => void;
  onSectorNameEnChange: (value: string) => void;
  onSectorSupervisorIdChange: (value: string) => void;
  onSectorActiveChange: (value: boolean) => void;
  onLocationFilterChange: (value: string) => void;
  onToggleLocation: (id: string) => void;
  onStartEdit: (sector: SectorRow) => void;
  onReset: () => void;
  onSave: (e: FormEvent) => void;
};

/**
 * Presentational sector list + create/edit form.
 * Create/edit UI is gated by `canManage`; supervisor scope locks the supervisor select.
 */
export function SectorPanel({
  label,
  locale,
  sectors,
  supervisors,
  filteredRooms,
  canManage,
  isSupervisorScope,
  busy,
  editingSectorId,
  sectorCode,
  sectorNameBg,
  sectorNameEn,
  sectorSupervisorId,
  sectorActive,
  selectedLocationIds,
  locationFilter,
  onSectorCodeChange,
  onSectorNameBgChange,
  onSectorNameEnChange,
  onSectorSupervisorIdChange,
  onSectorActiveChange,
  onLocationFilterChange,
  onToggleLocation,
  onStartEdit,
  onReset,
  onSave,
}: Props) {
  // Render output.
  // Panel section.
  return (
    <section className="panel">
      {/* Section heading. */}
      <h2>{label("Сектори", "Sectors")}</h2>
      {/* Sector catalog table (visible to all with panel access). */}
      <div className="table-wrap">
        {/* Data table. */}
        <table>
          {/* Table header. */}
          <thead>
            <tr>
              <th>{label("Код", "Code")}</th>
              <th>{label("Име", "Name")}</th>
              <th>{label("Супервайзър", "Supervisor")}</th>
              <th>{label("Помещения", "Locations")}</th>
              <th>{label("Статус", "Status")}</th>
              <th />
            </tr>
          </thead>
          {/* Table body rows. */}
          <tbody>
            {sectors.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.code}</strong>
                </td>
                <td>
                  {/* Primary name follows locale; secondary is the other language. */}
                  {locale === "bg" ? s.nameBg : s.nameEn}
                  <div className="muted small">
                    {locale === "bg" ? s.nameEn : s.nameBg}
                  </div>
                </td>
                <td>
                  {/* Dash when no primary supervisor is assigned. */}
                  {s.primarySupervisor
                    ? `${s.primarySupervisor.fullName} (${s.primarySupervisor.employeeNumber})`
                    : "—"}
                </td>
                <td>{s.locationCount}</td>
                <td>
                  {s.isActive
                    ? label("активен", "active")
                    : label("неактивен", "inactive")}
                </td>
                <td>
                  {/* Edit only when the parent grants manage permission. */}
                  {/* Action control. */}
                  {canManage && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => onStartEdit(s)}
                    >
                      {label("Редакция", "Edit")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {/* Empty catalog placeholder. */}
            {sectors.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {label("Няма сектори", "No sectors yet")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create/edit form — hidden without canManage. */}
      {/* Editable form. */}
      {canManage && (
        <form className="report-form" onSubmit={onSave}>
          {/* Section heading. */}
          <h3>
            {/* Create vs edit heading from editingSectorId. */}
            {editingSectorId
              ? label("Редакция на сектор", "Edit sector")
              : label("Нов сектор", "New sector")}
          </h3>
          {/* Form field. */}
          <label>
            {label("Код", "Code")}
            {/* Text/checkbox input. */}
            <input
              value={sectorCode}
              onChange={(e) => onSectorCodeChange(e.target.value)}
              required
              maxLength={32}
            />
          </label>
          {/* Form field. */}
          <label>
            {label("Име BG", "Name BG")}
            {/* Text/checkbox input. */}
            <input
              value={sectorNameBg}
              onChange={(e) => onSectorNameBgChange(e.target.value)}
              required
            />
          </label>
          {/* Form field. */}
          <label>
            {label("Име EN", "Name EN")}
            {/* Text/checkbox input. */}
            <input
              value={sectorNameEn}
              onChange={(e) => onSectorNameEnChange(e.target.value)}
              required
            />
          </label>
          {/* Form field. */}
          <label>
            {label("Супервайзър", "Supervisor")}
            {/* Select input. */}
            <select
              value={sectorSupervisorId}
              onChange={(e) => onSectorSupervisorIdChange(e.target.value)}
              // Supervisors cannot reassign sectors outside their scope.
              disabled={isSupervisorScope}
            >
              <option value="">—</option>
              {supervisors.map((p) => (
                <option key={p.employeeId} value={p.employeeId}>
                  {p.fullName} ({p.employeeNumber})
                </option>
              ))}
            </select>
          </label>
          {/* Form field. */}
          <label className="check-row">
            {/* Text/checkbox input. */}
            <input
              type="checkbox"
              checked={sectorActive}
              onChange={(e) => onSectorActiveChange(e.target.checked)}
            />
            {label("Активен", "Active")}
          </label>

          {/* Multi-select location membership with client-side filter. */}
          <div>
            <strong>
              {label("Помещения", "Locations")} ({selectedLocationIds.length})
            </strong>
            {/* Text/checkbox input. */}
            <input
              type="search"
              placeholder={label("Филтър…", "Filter…")}
              value={locationFilter}
              onChange={(e) => onLocationFilterChange(e.target.value)}
              style={{ marginTop: 8, marginBottom: 8 }}
            />
            <div
              className="table-wrap"
              style={{ maxHeight: 220, overflow: "auto" }}
            >
              {/* Form field. */}
              {filteredRooms.map((r) => (
                <label key={r.id} className="check-row">
                  {/* Text/checkbox input. */}
                  <input
                    type="checkbox"
                    checked={selectedLocationIds.includes(r.id)}
                    onChange={() => onToggleLocation(r.id)}
                  />
                  {r.buildingCode} {r.number}
                  <span className="muted small">
                    {" "}
                    · ет. {r.floor}
                    {/* Hint when room already belongs to a different sector. */}
                    {r.sector && r.sector.id !== editingSectorId
                      ? ` · ${r.sector.code}`
                      : ""}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="row-actions">
            {/* Action control. */}
            <button type="submit" disabled={busy}>
              {/* Busy label while the parent mutation is in flight. */}
              {busy ? label("Запис…", "Saving…") : label("Запази", "Save")}
            </button>
            {/* Cancel only shown while editing an existing sector. */}
            {/* Action control. */}
            {editingSectorId && (
              <button
                type="button"
                className="ghost"
                onClick={onReset}
                disabled={busy}
              >
                {label("Отмени", "Cancel")}
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
