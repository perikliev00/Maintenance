/**
 * Shift definitions table + create/edit modal, plus daily roster editor.
 */
import type { Person, ShiftRow } from "../api/client";
// Import dependency used by this module.
import type { useShiftEditor } from "../pages/housekeeping/useShiftEditor";
// Import dependency used by this module.
import { canSaveRosterDraft } from "../pages/housekeeping/shiftRosterLoadLogic";
// Import dependency used by this module.
import { FormModal } from "./FormModal";

// Local type alias shaping data.
type ShiftEditor = ReturnType<typeof useShiftEditor>;

// Local type alias shaping data.
type Props = {
  // Arrow function / callback body.
  label: (bg: string, en: string) => string;
  // Field/property in this shape.
  locale: "bg" | "en";
  // Field/property in this shape.
  shifts: ShiftRow[];
  // Field/property in this shape.
  housekeepers: Person[];
  // Field/property in this shape.
  canManage: boolean;
  // Field/property in this shape.
  busy: boolean;
  // Field/property in this shape.
  editor: ShiftEditor;
};

// Exported function entry point.
export function ShiftPanel({
  // List item in import/export/params.
  label,
  // List item in import/export/params.
  locale,
  // List item in import/export/params.
  shifts,
  // List item in import/export/params.
  housekeepers,
  // List item in import/export/params.
  canManage,
  // List item in import/export/params.
  busy,
  // List item in import/export/params.
  editor,
// Open multi-line construct.
}: Props) {
  // Open multi-line construct.
  const {
    // Field/property in this shape.
    shiftFormError: formError,
    // Field/property in this shape.
    shiftMode: mode,
    // List item in import/export/params.
    editingShift,
    // List item in import/export/params.
    shiftCode,
    // List item in import/export/params.
    shiftNameBg,
    // List item in import/export/params.
    shiftNameEn,
    // List item in import/export/params.
    shiftStart,
    // List item in import/export/params.
    shiftEnd,
    // List item in import/export/params.
    shiftSort,
    // List item in import/export/params.
    shiftActive,
    // Field/property in this shape.
    shiftDirty: dirty,
    // List item in import/export/params.
    rosterDate,
    // List item in import/export/params.
    rosterEntries,
    // List item in import/export/params.
    rosterDraft,
    // List item in import/export/params.
    rosterLoadedDate,
    // List item in import/export/params.
    setShiftCode,
    // List item in import/export/params.
    setShiftNameBg,
    // List item in import/export/params.
    setShiftNameEn,
    // List item in import/export/params.
    setShiftStart,
    // List item in import/export/params.
    setShiftEnd,
    // List item in import/export/params.
    setShiftSort,
    // List item in import/export/params.
    setShiftActive,
    // List item in import/export/params.
    setRosterDate,
    // List item in import/export/params.
    onRosterDraftChange,
    // List item in import/export/params.
    startCreateShift,
    // List item in import/export/params.
    startEditShift,
    // List item in import/export/params.
    closeShiftForm,
    // List item in import/export/params.
    onSaveShift,
    // List item in import/export/params.
    onSaveRoster,
  // Assign value for subsequent use.
  } = editor;

  // Local constant binding.
  const title =
    // Assign value for subsequent use.
    mode === "edit"
      // Invoke helper or pass arguments.
      ? `${label("Редакция на смяна", "Edit shift")}${
          // Continue module logic.
          editingShift ? `: ${editingShift.code}` : ""
        // Continue module logic.
        }`
      // Invoke helper or pass arguments.
      : label("Добавяне на смяна", "Add shift");

  // Return computed result to caller.
  return (
    // Render JSX element.
    <section className="panel">
            <div className="panel-header">
                <h2>{label("Смени", "Shifts")}</h2>
                {canManage && (
          // Render JSX element.
          <button type="button" onClick={startCreateShift} disabled={busy}>
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
              // Render JSX element.
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
                    // Invoke helper or pass arguments.
                    ? label("активна", "active")
                    // Invoke helper or pass arguments.
                    : label("неактивна", "inactive")}
                                </td>
                                <td>
                                    {canManage && (
                    // Render JSX element.
                    <button
                      // Assign value for subsequent use.
                      type="button"
                      // Assign value for subsequent use.
                      className="ghost"
                      // Arrow function / callback body.
                      onClick={() => startEditShift(s)}
                      // Assign value for subsequent use.
                      disabled={busy}
                    >
                                            {label("Редакция", "Edit")}
                                        </button>
                  )}
                                </td>
                            </tr>
            ))}
                        {shifts.length === 0 && (
              // Render JSX element.
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
        // Render JSX element.
        <FormModal
          // Assign value for subsequent use.
          title={title}
          // Assign value for subsequent use.
          busy={busy}
          // Assign value for subsequent use.
          dirty={dirty}
          // Assign value for subsequent use.
          error={formError}
          // Assign value for subsequent use.
          submitLabel={label("Запази промените", "Save changes")}
          // Assign value for subsequent use.
          cancelLabel={label("Отмени", "Cancel")}
          // Assign value for subsequent use.
          onClose={closeShiftForm}
          // Assign value for subsequent use.
          onSubmit={onSaveShift}
        >
                    <label>
                        {label("Код", "Code")}
                        <input
              // Assign value for subsequent use.
              value={shiftCode}
              // Arrow function / callback body.
              onChange={(e) => setShiftCode(e.target.value)}
              // JSX boolean prop or identifier.
              required
              // Assign value for subsequent use.
              maxLength={32}
              // Assign value for subsequent use.
              disabled={busy}
            />
                    </label>
                    <label>
                        {label("Име BG", "Name BG")}
                        <input
              // Assign value for subsequent use.
              value={shiftNameBg}
              // Arrow function / callback body.
              onChange={(e) => setShiftNameBg(e.target.value)}
              // JSX boolean prop or identifier.
              required
              // Assign value for subsequent use.
              disabled={busy}
            />
                    </label>
                    <label>
                        {label("Име EN", "Name EN")}
                        <input
              // Assign value for subsequent use.
              value={shiftNameEn}
              // Arrow function / callback body.
              onChange={(e) => setShiftNameEn(e.target.value)}
              // JSX boolean prop or identifier.
              required
              // Assign value for subsequent use.
              disabled={busy}
            />
                    </label>
                    <label>
                        {label("Начало (HH:mm)", "Start (HH:mm)")}
                        <input
              // Assign value for subsequent use.
              value={shiftStart}
              // Arrow function / callback body.
              onChange={(e) => setShiftStart(e.target.value)}
              // Assign value for subsequent use.
              pattern="([01]\d|2[0-3]):[0-5]\d"
              // JSX boolean prop or identifier.
              required
              // Assign value for subsequent use.
              disabled={busy}
            />
                    </label>
                    <label>
                        {label("Край (HH:mm)", "End (HH:mm)")}
                        <input
              // Assign value for subsequent use.
              value={shiftEnd}
              // Arrow function / callback body.
              onChange={(e) => setShiftEnd(e.target.value)}
              // Assign value for subsequent use.
              pattern="([01]\d|2[0-3]):[0-5]\d"
              // JSX boolean prop or identifier.
              required
              // Assign value for subsequent use.
              disabled={busy}
            />
                    </label>
                    <label>
                        {label("Ред", "Sort order")}
                        <input
              // Assign value for subsequent use.
              type="number"
              // Assign value for subsequent use.
              min={0}
              // Assign value for subsequent use.
              value={shiftSort}
              // Arrow function / callback body.
              onChange={(e) => setShiftSort(Number(e.target.value) || 0)}
              // Assign value for subsequent use.
              disabled={busy}
            />
                    </label>
                    <label className="check-row">
                        <input
              // Assign value for subsequent use.
              type="checkbox"
              // Assign value for subsequent use.
              checked={shiftActive}
              // Arrow function / callback body.
              onChange={(e) => setShiftActive(e.target.checked)}
              // Assign value for subsequent use.
              disabled={busy}
            />
                        {label("Активна", "Active")}
                    </label>
                </FormModal>
      )}

            {canManage && (
        // Render JSX element.
        <div className="roster-block" style={{ marginTop: "1.5rem" }}>
                    <h3>{label("Ростер за дата", "Roster for date")}</h3>
                    <label>
                        {label("Хотелска дата", "Hotel date")}
                        <input
              // Assign value for subsequent use.
              type="date"
              // Assign value for subsequent use.
              value={rosterDate}
              // Arrow function / callback body.
              onChange={(e) => setRosterDate(e.target.value)}
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
                  // Render JSX element.
                  <tr key={hk.id}>
                                        <td>
                                            {hk.fullName}{" "}
                                            <span className="muted">({hk.employeeNumber})</span>
                                        </td>
                                        <td>
                                            <select
                        // Assign value for subsequent use.
                        value={rosterDraft[hk.id] ?? ""}
                        // Assign value for subsequent use.
                        disabled={
                          // Assign value for subsequent use.
                          busy || rosterLoadedDate !== rosterDate
                        }
                        // Arrow function / callback body.
                        onChange={(e) =>
                          // Invoke helper or pass arguments.
                          onRosterDraftChange(hk.id, e.target.value)
                        }
                      >
                                                <option value="">
                                                    {label("— няма —", "— none —")}
                                                </option>
                                                {shifts
                          // Arrow function / callback body.
                          .filter((s) => s.isActive)
                          // Arrow function / callback body.
                          .map((s) => (
                            // Render JSX element.
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
                  // Render JSX element.
                  <tr>
                                        <td colSpan={2} className="muted">
                                            {label("Няма камериери", "No housekeepers")}
                                        </td>
                                    </tr>
                )}
                            </tbody>
                        </table>
                    </div>
                    <button
            // Assign value for subsequent use.
            type="button"
            // Assign value for subsequent use.
            disabled={
              // Open multi-line construct.
              !canSaveRosterDraft({
                // Field/property in this shape.
                activeDate: rosterDate,
                // Field/property in this shape.
                loadedDate: rosterLoadedDate,
                // List item in import/export/params.
                busy,
              })
            }
            // Assign value for subsequent use.
            onClick={onSaveRoster}
          >
                        {busy
              // Invoke helper or pass arguments.
              ? label("Запис…", "Saving…")
              // Invoke helper or pass arguments.
              : label("Запази ростер", "Save roster")}
                    </button>
                    {rosterEntries.length > 0 && (
            // Render JSX element.
            <p className="muted small">
                            {label(
                // Continue multi-line list/arguments.
                `Текущи записи: ${rosterEntries.length}`,
                // Continue multi-line list/arguments.
                `Current entries: ${rosterEntries.length}`,
              )}
                        </p>
          )}
                </div>
      )}
        </section>
  );
}
