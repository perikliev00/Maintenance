import type { FormEvent } from "react";
import type { Person, Room, SectorRow } from "../api/client";

type Props = {
  label: (bg: string, en: string) => string;
  locale: "bg" | "en";
  sectors: SectorRow[];
  supervisors: Person[];
  filteredRooms: Room[];
  canManage: boolean;
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
  return (
    <section className="panel">
      <h2>{label("Сектори", "Sectors")}</h2>
      <div className="table-wrap">
        <table>
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
          <tbody>
            {sectors.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.code}</strong>
                </td>
                <td>
                  {locale === "bg" ? s.nameBg : s.nameEn}
                  <div className="muted small">
                    {locale === "bg" ? s.nameEn : s.nameBg}
                  </div>
                </td>
                <td>
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

      {canManage && (
        <form className="report-form" onSubmit={onSave}>
          <h3>
            {editingSectorId
              ? label("Редакция на сектор", "Edit sector")
              : label("Нов сектор", "New sector")}
          </h3>
          <label>
            {label("Код", "Code")}
            <input
              value={sectorCode}
              onChange={(e) => onSectorCodeChange(e.target.value)}
              required
              maxLength={32}
            />
          </label>
          <label>
            {label("Име BG", "Name BG")}
            <input
              value={sectorNameBg}
              onChange={(e) => onSectorNameBgChange(e.target.value)}
              required
            />
          </label>
          <label>
            {label("Име EN", "Name EN")}
            <input
              value={sectorNameEn}
              onChange={(e) => onSectorNameEnChange(e.target.value)}
              required
            />
          </label>
          <label>
            {label("Супервайзър", "Supervisor")}
            <select
              value={sectorSupervisorId}
              onChange={(e) => onSectorSupervisorIdChange(e.target.value)}
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
          <label className="check-row">
            <input
              type="checkbox"
              checked={sectorActive}
              onChange={(e) => onSectorActiveChange(e.target.checked)}
            />
            {label("Активен", "Active")}
          </label>

          <div>
            <strong>
              {label("Помещения", "Locations")} ({selectedLocationIds.length})
            </strong>
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
              {filteredRooms.map((r) => (
                <label key={r.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={selectedLocationIds.includes(r.id)}
                    onChange={() => onToggleLocation(r.id)}
                  />
                  {r.buildingCode} {r.number}
                  <span className="muted small">
                    {" "}
                    · ет. {r.floor}
                    {r.sector && r.sector.id !== editingSectorId
                      ? ` · ${r.sector.code}`
                      : ""}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="row-actions">
            <button type="submit" disabled={busy}>
              {busy ? label("Запис…", "Saving…") : label("Запази", "Save")}
            </button>
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
