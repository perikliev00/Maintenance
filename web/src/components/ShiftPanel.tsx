/**
 * Shift definitions table + create/edit modal, plus daily roster editor.
 */
import type { FormEvent } from "react";
import type { Person, ShiftRosterEntry, ShiftRow } from "../api/client";
import { FormModal } from "./FormModal";

type ShiftFormMode = "closed" | "create" | "edit";

type Props = {
  label: (bg: string, en: string) => string;
  locale: "bg" | "en";
  shifts: ShiftRow[];
  housekeepers: Person[];
  canManage: boolean;
  busy: boolean;
  formError: string | null;
  mode: ShiftFormMode;
  editingShift: ShiftRow | null;
  shiftCode: string;
  shiftNameBg: string;
  shiftNameEn: string;
  shiftStart: string;
  shiftEnd: string;
  shiftSort: number;
  shiftActive: boolean;
  dirty: boolean;
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
  onStartCreate: () => void;
  onStartEdit: (shift: ShiftRow) => void;
  onCloseForm: () => void;
  onSave: (e: FormEvent) => void;
  onSaveRoster: () => void;
};

export function ShiftPanel({
  label,
  locale,
  shifts,
  housekeepers,
  canManage,
  busy,
  formError,
  mode,
  editingShift,
  shiftCode,
  shiftNameBg,
  shiftNameEn,
  shiftStart,
  shiftEnd,
  shiftSort,
  shiftActive,
  dirty,
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
  onStartCreate,
  onStartEdit,
  onCloseForm,
  onSave,
  onSaveRoster,
}: Props) {
  const title =
    mode === "edit"
      ? `${label("Редакция на смяна", "Edit shift")}${
          editingShift ? `: ${editingShift.code}` : ""
        }`
      : label("Добавяне на смяна", "Add shift");

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{label("Смени", "Shifts")}</h2>
        {canManage && (
          <button type="button" onClick={onStartCreate} disabled={busy}>
            {label("+ Добави смяна", "+ Add shift")}
          </button>
        )}
      </div>

      <div className="table-wrap">
        <table>
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
          <tbody>
            {shifts.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.code}</strong>
                </td>
                <td>{locale === "bg" ? s.nameBg : s.nameEn}</td>
                <td>{s.startTime}</td>
                <td>{s.endTime}</td>
                <td>{s.sortOrder}</td>
                <td>
                  {s.isActive
                    ? label("активна", "active")
                    : label("неактивна", "inactive")}
                </td>
                <td>
                  {canManage && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => onStartEdit(s)}
                      disabled={busy}
                    >
                      {label("Редакция", "Edit")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
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

      {mode !== "closed" && canManage && (
        <FormModal
          title={title}
          busy={busy}
          dirty={dirty}
          error={formError}
          submitLabel={label("Запази промените", "Save changes")}
          cancelLabel={label("Отмени", "Cancel")}
          onClose={onCloseForm}
          onSubmit={onSave}
        >
          <label>
            {label("Код", "Code")}
            <input
              value={shiftCode}
              onChange={(e) => onShiftCodeChange(e.target.value)}
              required
              maxLength={32}
              disabled={busy}
            />
          </label>
          <label>
            {label("Име BG", "Name BG")}
            <input
              value={shiftNameBg}
              onChange={(e) => onShiftNameBgChange(e.target.value)}
              required
              disabled={busy}
            />
          </label>
          <label>
            {label("Име EN", "Name EN")}
            <input
              value={shiftNameEn}
              onChange={(e) => onShiftNameEnChange(e.target.value)}
              required
              disabled={busy}
            />
          </label>
          <label>
            {label("Начало (HH:mm)", "Start (HH:mm)")}
            <input
              value={shiftStart}
              onChange={(e) => onShiftStartChange(e.target.value)}
              pattern="([01]\d|2[0-3]):[0-5]\d"
              required
              disabled={busy}
            />
          </label>
          <label>
            {label("Край (HH:mm)", "End (HH:mm)")}
            <input
              value={shiftEnd}
              onChange={(e) => onShiftEndChange(e.target.value)}
              pattern="([01]\d|2[0-3]):[0-5]\d"
              required
              disabled={busy}
            />
          </label>
          <label>
            {label("Ред", "Sort order")}
            <input
              type="number"
              min={0}
              value={shiftSort}
              onChange={(e) => onShiftSortChange(Number(e.target.value) || 0)}
              disabled={busy}
            />
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={shiftActive}
              onChange={(e) => onShiftActiveChange(e.target.checked)}
              disabled={busy}
            />
            {label("Активна", "Active")}
          </label>
        </FormModal>
      )}

      {canManage && (
        <div className="roster-block" style={{ marginTop: "1.5rem" }}>
          <h3>{label("Ростер за дата", "Roster for date")}</h3>
          <label>
            {label("Хотелска дата", "Hotel date")}
            <input
              type="date"
              value={rosterDate}
              onChange={(e) => onRosterDateChange(e.target.value)}
            />
          </label>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{label("Служител", "Employee")}</th>
                  <th>{label("Смяна", "Shift")}</th>
                </tr>
              </thead>
              <tbody>
                {housekeepers.map((hk) => (
                  <tr key={hk.id}>
                    <td>
                      {hk.fullName}{" "}
                      <span className="muted">({hk.employeeNumber})</span>
                    </td>
                    <td>
                      <select
                        value={rosterDraft[hk.id] ?? ""}
                        onChange={(e) =>
                          onRosterDraftChange(hk.id, e.target.value)
                        }
                      >
                        <option value="">
                          {label("— няма —", "— none —")}
                        </option>
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
          <button type="button" disabled={busy} onClick={onSaveRoster}>
            {busy
              ? label("Запис…", "Saving…")
              : label("Запази ростер", "Save roster")}
          </button>
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
