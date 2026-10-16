/**
 * Shift definitions table/form plus daily housekeeper roster editor.
 * Create/edit and roster UI are both gated by `canManage`.
 */
import type { FormEvent } from "react";
import type { Person, ShiftRosterEntry, ShiftRow } from "../api/client";

type Props = {
  label: (bg: string, en: string) => string;
  locale: "bg" | "en";
  shifts: ShiftRow[];
  housekeepers: Person[];
  /** When false, edit form and roster block are hidden. */
  canManage: boolean;
  busy: boolean;
  editingShiftId: string | null;
  shiftCode: string;
  shiftNameBg: string;
  shiftNameEn: string;
  shiftStart: string;
  shiftEnd: string;
  shiftSort: number;
  shiftActive: boolean;
  rosterDate: string;
  rosterEntries: ShiftRosterEntry[];
  rosterDraft: Record<string, string>;
  onShiftCodeChange: (value: string) => void;
  onShiftNameBgChange: (value: string) => void;
  onShiftNameEnChange: (value: string) => void;
  onShiftStartChange: (value: string) => void;
  onShiftEndChange: (value: string) => void;
  onShiftSortChange: (value: number) => void;
  onShiftActiveChange: (value: boolean) => void;
  onRosterDateChange: (value: string) => void;
  onRosterDraftChange: (employeeId: string, shiftId: string) => void;
  onStartEdit: (shift: ShiftRow) => void;
  onReset: () => void;
  onSave: (e: FormEvent) => void;
  onSaveRoster: () => void;
};

/**
 * Presentational shift definitions table/form plus daily housekeeper roster.
 * Create/edit and roster UI are both gated by `canManage`.
 */
export function ShiftPanel({
  label,
  locale,
  shifts,
  housekeepers,
  canManage,
  busy,
  editingShiftId,
  shiftCode,
  shiftNameBg,
  shiftNameEn,
  shiftStart,
  shiftEnd,
  shiftSort,
  shiftActive,
  rosterDate,
  rosterEntries,
  rosterDraft,
  onShiftCodeChange,
  onShiftNameBgChange,
  onShiftNameEnChange,
  onShiftStartChange,
  onShiftEndChange,
  onShiftSortChange,
  onShiftActiveChange,
  onRosterDateChange,
  onRosterDraftChange,
  onStartEdit,
  onReset,
  onSave,
  onSaveRoster,
}: Props) {
  // Render output.
  // Panel section.
  return (
    <section className="panel">
      {/* Section heading. */}
      <h2>{label("Смени", "Shifts")}</h2>
      {/* Read-only shift catalog for all viewers. */}
      <div className="table-wrap">
        {/* Data table. */}
        <table>
          {/* Table header. */}
          <thead>
            <tr>
              <th>{label("Код", "Code")}</th>
              <th>{label("Име", "Name")}</th>
              <th>{label("Начало", "Start")}</th>
              <th>{label("Край", "End")}</th>
              <th>{label("Ред", "Order")}</th>
              <th>{label("Статус", "Status")}</th>
              <th />
            </tr>
          </thead>
          {/* Table body rows. */}
          <tbody>
            {shifts.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.code}</strong>
                </td>
                {/* Localized display name (BG vs EN column). */}
                <td>{locale === "bg" ? s.nameBg : s.nameEn}</td>
                <td>{s.startTime}</td>
                <td>{s.endTime}</td>
                <td>{s.sortOrder}</td>
                <td>
                  {/* Active flag drives roster eligibility below. */}
                  {s.isActive
                    ? label("активна", "active")
                    : label("неактивна", "inactive")}
                </td>
                <td>
                  {/* Edit affordance — permission-gated. */}
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
            {shifts.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {label("Няма смени", "No shifts yet")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create / edit form — managers only. */}
      {/* Editable form. */}
      {canManage && (
        <form className="report-form" onSubmit={onSave}>
          {/* Section heading. */}
          <h3>
            {/* Title switches when an existing row is loaded into the form. */}
            {editingShiftId
              ? label("Редакция на смяна", "Edit shift")
              : label("Нова смяна", "New shift")}
          </h3>
          {/* Form field. */}
          <label>
            {label("Код", "Code")}
            {/* Text/checkbox input. */}
            <input
              value={shiftCode}
              onChange={(e) => onShiftCodeChange(e.target.value)}
              required
              maxLength={32}
            />
          </label>
          {/* Form field. */}
          <label>
            {label("Име BG", "Name BG")}
            {/* Text/checkbox input. */}
            <input
              value={shiftNameBg}
              onChange={(e) => onShiftNameBgChange(e.target.value)}
              required
            />
          </label>
          {/* Form field. */}
          <label>
            {label("Име EN", "Name EN")}
            {/* Text/checkbox input. */}
            <input
              value={shiftNameEn}
              onChange={(e) => onShiftNameEnChange(e.target.value)}
              required
            />
          </label>
          {/* Form field. */}
          <label>
            {label("Начало (HH:mm)", "Start (HH:mm)")}
            {/* Text/checkbox input. */}
            <input
              value={shiftStart}
              onChange={(e) => onShiftStartChange(e.target.value)}
              pattern="([01]\d|2[0-3]):[0-5]\d"
              required
            />
          </label>
          {/* Form field. */}
          <label>
            {label("Край (HH:mm)", "End (HH:mm)")}
            {/* Text/checkbox input. */}
            <input
              value={shiftEnd}
              onChange={(e) => onShiftEndChange(e.target.value)}
              pattern="([01]\d|2[0-3]):[0-5]\d"
              required
            />
          </label>
          {/* Form field. */}
          <label>
            {label("Ред", "Sort order")}
            {/* Text/checkbox input. */}
            <input
              type="number"
              min={0}
              value={shiftSort}
              /* Coerce empty/invalid input to 0. */
              onChange={(e) => onShiftSortChange(Number(e.target.value) || 0)}
            />
          </label>
          {/* Form field. */}
          <label className="check-row">
            {/* Text/checkbox input. */}
            <input
              type="checkbox"
              checked={shiftActive}
              onChange={(e) => onShiftActiveChange(e.target.checked)}
            />
            {label("Активна", "Active")}
          </label>
          <div className="row-actions">
            {/* Action control. */}
            <button type="submit" disabled={busy}>
              {/* Busy disables double-submit during save. */}
              {busy ? label("Запис…", "Saving…") : label("Запази", "Save")}
            </button>
            {/* Cancel clears edit mode back to "new shift". */}
            {/* Action control. */}
            {editingShiftId && (
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

      {/* Daily roster editor — same manage permission as shift CRUD. */}
      {canManage && (
        <div className="roster-block" style={{ marginTop: "1.5rem" }}>
          {/* Section heading. */}
          <h3>{label("Ростер за дата", "Roster for date")}</h3>
          {/* Form field. */}
          <label>
            {label("Хотелска дата", "Hotel date")}
            {/* Text/checkbox input. */}
            <input
              type="date"
              value={rosterDate}
              onChange={(e) => onRosterDateChange(e.target.value)}
            />
          </label>
          <div className="table-wrap">
            {/* Data table. */}
            <table>
              {/* Table header. */}
              <thead>
                <tr>
                  <th>{label("Служител", "Employee")}</th>
                  <th>{label("Смяна", "Shift")}</th>
                </tr>
              </thead>
              {/* Table body rows. */}
              <tbody>
                {housekeepers.map((hk) => (
                  <tr key={hk.id}>
                    <td>
                      {hk.fullName}{" "}
                      <span className="muted">({hk.employeeNumber})</span>
                    </td>
                    <td>
                      {/* Draft maps employeeId → shiftId (empty = unassigned). */}
                      <select
                        value={rosterDraft[hk.id] ?? ""}
                        onChange={(e) =>
                          onRosterDraftChange(hk.id, e.target.value)
                        }
                      >
                        <option value="">
                          {label("— няма —", "— none —")}
                        </option>
                        {/* Only active shifts are assignable in the roster. */}
                        {shifts
                          .filter((s) => s.isActive)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {locale === "bg" ? s.nameBg : s.nameEn} (
                              {s.startTime}–{s.endTime})
                            </option>
                          ))}
                      </select>
                    </td>
                  </tr>
                ))}
                {/* Empty housekeeper directory for this property. */}
                {housekeepers.length === 0 && (
                  <tr>
                    <td colSpan={2} className="muted">
                      {label("Няма камериери", "No housekeepers")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {/* Action control. */}
          <button type="button" disabled={busy} onClick={onSaveRoster}>
            {busy
              ? label("Запис…", "Saving…")
              : label("Запази ростер", "Save roster")}
          </button>
          {/* Server-confirmed entry count for the selected hotel date. */}
          {rosterEntries.length > 0 && (
            <p className="muted small">
              {label(
                `Текущи записи: ${rosterEntries.length}`,
                `Current entries: ${rosterEntries.length}`,
              )}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
