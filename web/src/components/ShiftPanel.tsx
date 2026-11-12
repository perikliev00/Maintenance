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
      // Render JSX element.
      <div className="panel-header">
        // Render JSX element.
        <h2>{label("Смени", "Shifts")}</h2>
        // JSX expression container.
        {canManage && (
          // Render JSX element.
          <button type="button" onClick={startCreateShift} disabled={busy}>
            // JSX expression container.
            {label("+ Добави смяна", "+ Add shift")}
          // JSX element boundary.
          </button>
        )}
      // JSX element boundary.
      </div>

      // Render JSX element.
      <div className="table-wrap">
        // Render JSX element.
        <table>
          // Render JSX element.
          <thead>
            // Render JSX element.
            <tr>
              // Render JSX element.
              <th>{label("Код", "Code")}</th>
              // Render JSX element.
              <th>{label("Име", "Name")}</th>
              // Render JSX element.
              <th>{label("Начало", "Start")}</th>
              // Render JSX element.
              <th>{label("Край", "End")}</th>
              // Render JSX element.
              <th>{label("Ред", "Order")}</th>
              // Render JSX element.
              <th>{label("Статус", "Status")}</th>
              // Render JSX element.
              <th />
            // JSX element boundary.
            </tr>
          // JSX element boundary.
          </thead>
          // Render JSX element.
          <tbody>
            // JSX expression container.
            {shifts.map((s) => (
              // Render JSX element.
              <tr key={s.id}>
                // Render JSX element.
                <td>
                  // Render JSX element.
                  <strong>{s.code}</strong>
                // JSX element boundary.
                </td>
                // Render JSX element.
                <td>{locale === "bg" ? s.nameBg : s.nameEn}</td>
                // Render JSX element.
                <td>{s.startTime}</td>
                // Render JSX element.
                <td>{s.endTime}</td>
                // Render JSX element.
                <td>{s.sortOrder}</td>
                // Render JSX element.
                <td>
                  // JSX expression container.
                  {s.isActive
                    // Invoke helper or pass arguments.
                    ? label("активна", "active")
                    // Invoke helper or pass arguments.
                    : label("неактивна", "inactive")}
                // JSX element boundary.
                </td>
                // Render JSX element.
                <td>
                  // JSX expression container.
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
                      // JSX expression container.
                      {label("Редакция", "Edit")}
                    // JSX element boundary.
                    </button>
                  )}
                // JSX element boundary.
                </td>
              // JSX element boundary.
              </tr>
            ))}
            // JSX expression container.
            {shifts.length === 0 && (
              // Render JSX element.
              <tr>
                // Render JSX element.
                <td colSpan={7} className="muted">
                  // JSX expression container.
                  {label("Няма смени", "No shifts yet")}
                // JSX element boundary.
                </td>
              // JSX element boundary.
              </tr>
            )}
          // JSX element boundary.
          </tbody>
        // JSX element boundary.
        </table>
      // JSX element boundary.
      </div>

      // JSX expression container.
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
          // Render JSX element.
          <label>
            // JSX expression container.
            {label("Код", "Code")}
            // Render JSX element.
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
          // JSX element boundary.
          </label>
          // Render JSX element.
          <label>
            // JSX expression container.
            {label("Име BG", "Name BG")}
            // Render JSX element.
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
          // JSX element boundary.
          </label>
          // Render JSX element.
          <label>
            // JSX expression container.
            {label("Име EN", "Name EN")}
            // Render JSX element.
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
          // JSX element boundary.
          </label>
          // Render JSX element.
          <label>
            // JSX expression container.
            {label("Начало (HH:mm)", "Start (HH:mm)")}
            // Render JSX element.
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
          // JSX element boundary.
          </label>
          // Render JSX element.
          <label>
            // JSX expression container.
            {label("Край (HH:mm)", "End (HH:mm)")}
            // Render JSX element.
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
          // JSX element boundary.
          </label>
          // Render JSX element.
          <label>
            // JSX expression container.
            {label("Ред", "Sort order")}
            // Render JSX element.
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
          // JSX element boundary.
          </label>
          // Render JSX element.
          <label className="check-row">
            // Render JSX element.
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
            // JSX expression container.
            {label("Активна", "Active")}
          // JSX element boundary.
          </label>
        // JSX element boundary.
        </FormModal>
      )}

      // JSX expression container.
      {canManage && (
        // Render JSX element.
        <div className="roster-block" style={{ marginTop: "1.5rem" }}>
          // Render JSX element.
          <h3>{label("Ростер за дата", "Roster for date")}</h3>
          // Render JSX element.
          <label>
            // JSX expression container.
            {label("Хотелска дата", "Hotel date")}
            // Render JSX element.
            <input
              // Assign value for subsequent use.
              type="date"
              // Assign value for subsequent use.
              value={rosterDate}
              // Arrow function / callback body.
              onChange={(e) => setRosterDate(e.target.value)}
            />
          // JSX element boundary.
          </label>
          // Render JSX element.
          <div className="table-wrap">
            // Render JSX element.
            <table>
              // Render JSX element.
              <thead>
                // Render JSX element.
                <tr>
                  // Render JSX element.
                  <th>{label("Служител", "Employee")}</th>
                  // Render JSX element.
                  <th>{label("Смяна", "Shift")}</th>
                // JSX element boundary.
                </tr>
              // JSX element boundary.
              </thead>
              // Render JSX element.
              <tbody>
                // JSX expression container.
                {housekeepers.map((hk) => (
                  // Render JSX element.
                  <tr key={hk.id}>
                    // Render JSX element.
                    <td>
                      // JSX expression container.
                      {hk.fullName}{" "}
                      // Render JSX element.
                      <span className="muted">({hk.employeeNumber})</span>
                    // JSX element boundary.
                    </td>
                    // Render JSX element.
                    <td>
                      // Render JSX element.
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
                        // Render JSX element.
                        <option value="">
                          // JSX expression container.
                          {label("— няма —", "— none —")}
                        // JSX element boundary.
                        </option>
                        // JSX expression container.
                        {shifts
                          // Arrow function / callback body.
                          .filter((s) => s.isActive)
                          // Arrow function / callback body.
                          .map((s) => (
                            // Render JSX element.
                            <option key={s.id} value={s.id}>
                              // JSX expression container.
                              {locale === "bg" ? s.nameBg : s.nameEn} (
                              // JSX expression container.
                              {s.startTime}–{s.endTime})
                            // JSX element boundary.
                            </option>
                          ))}
                      // JSX element boundary.
                      </select>
                    // JSX element boundary.
                    </td>
                  // JSX element boundary.
                  </tr>
                ))}
                // JSX expression container.
                {housekeepers.length === 0 && (
                  // Render JSX element.
                  <tr>
                    // Render JSX element.
                    <td colSpan={2} className="muted">
                      // JSX expression container.
                      {label("Няма камериери", "No housekeepers")}
                    // JSX element boundary.
                    </td>
                  // JSX element boundary.
                  </tr>
                )}
              // JSX element boundary.
              </tbody>
            // JSX element boundary.
            </table>
          // JSX element boundary.
          </div>
          // Render JSX element.
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
            // JSX expression container.
            {busy
              // Invoke helper or pass arguments.
              ? label("Запис…", "Saving…")
              // Invoke helper or pass arguments.
              : label("Запази ростер", "Save roster")}
          // JSX element boundary.
          </button>
          // JSX expression container.
          {rosterEntries.length > 0 && (
            // Render JSX element.
            <p className="muted small">
              // JSX expression container.
              {label(
                // Continue multi-line list/arguments.
                `Текущи записи: ${rosterEntries.length}`,
                // Continue multi-line list/arguments.
                `Current entries: ${rosterEntries.length}`,
              )}
            // JSX element boundary.
            </p>
          )}
        // JSX element boundary.
        </div>
      )}
    // JSX element boundary.
    </section>
  );
}
