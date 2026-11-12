/**
 * Shift definitions table + create/edit modal, plus daily roster editor.
 */
import type { Person, ShiftRow } from "../api/client";
import type { useShiftEditor } from "../pages/housekeeping/useShiftEditor";
import { canSaveRosterDraft } from "../pages/housekeeping/shiftRosterLoadLogic";
import { FormModal } from "./FormModal";

type ShiftEditor = ReturnType<typeof useShiftEditor>;

type Props = {
  label: (bg: string, en: string) => string;
  locale: "bg" | "en";
  shifts: ShiftRow[];
  housekeepers: Person[];
  canManage: boolean;
  busy: boolean;
  editor: ShiftEditor;
};

// Exported function entry point.
export function ShiftPanel({
  label,
  locale,
  shifts,
  housekeepers,
  canManage,
  busy,
  editor,
}: Props) {
  const {
    shiftFormError: formError,
    shiftMode: mode,
    editingShift,
    shiftCode,
    shiftNameBg,
    shiftNameEn,
    shiftStart,
    shiftEnd,
    shiftSort,
    shiftActive,
    shiftDirty: dirty,
    rosterDate,
    rosterEntries,
    rosterDraft,
    rosterLoadedDate,
    setShiftCode,
    setShiftNameBg,
    setShiftNameEn,
    setShiftStart,
    setShiftEnd,
    setShiftSort,
    setShiftActive,
    setRosterDate,
    onRosterDraftChange,
    startCreateShift,
    startEditShift,
    closeShiftForm,
    onSaveShift,
    onSaveRoster,
  } = editor;

  const title =
    mode === "edit"
      ? `${label("Редакция на смяна", "Edit shift")}${
          // Continue module logic.
          editingShift ? `: ${editingShift.code}` : ""
        // Continue module logic.
        }`
      : label("Добавяне на смяна", "Add shift");

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
                    ? label("активна", "active")
                    : label("неактивна", "inactive")}
                                </td>
                                <td>
                                    {canManage && (
                    // Render JSX element.
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => startEditShift(s)}
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
          title={title}
          busy={busy}
          dirty={dirty}
          error={formError}
          submitLabel={label("Запази промените", "Save changes")}
          cancelLabel={label("Отмени", "Cancel")}
          onClose={closeShiftForm}
          onSubmit={onSaveShift}
        >
                    <label>
                        {label("Код", "Code")}
                        <input
              value={shiftCode}
              onChange={(e) => setShiftCode(e.target.value)}
              // JSX boolean prop or identifier.
              required
              maxLength={32}
              disabled={busy}
            />
                    </label>
                    <label>
                        {label("Име BG", "Name BG")}
                        <input
              value={shiftNameBg}
              onChange={(e) => setShiftNameBg(e.target.value)}
              // JSX boolean prop or identifier.
              required
              disabled={busy}
            />
                    </label>
                    <label>
                        {label("Име EN", "Name EN")}
                        <input
              value={shiftNameEn}
              onChange={(e) => setShiftNameEn(e.target.value)}
              // JSX boolean prop or identifier.
              required
              disabled={busy}
            />
                    </label>
                    <label>
                        {label("Начало (HH:mm)", "Start (HH:mm)")}
                        <input
              value={shiftStart}
              onChange={(e) => setShiftStart(e.target.value)}
              pattern="([01]\d|2[0-3]):[0-5]\d"
              // JSX boolean prop or identifier.
              required
              disabled={busy}
            />
                    </label>
                    <label>
                        {label("Край (HH:mm)", "End (HH:mm)")}
                        <input
              value={shiftEnd}
              onChange={(e) => setShiftEnd(e.target.value)}
              pattern="([01]\d|2[0-3]):[0-5]\d"
              // JSX boolean prop or identifier.
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
              onChange={(e) => setShiftSort(Number(e.target.value) || 0)}
              disabled={busy}
            />
                    </label>
                    <label className="check-row">
                        <input
              type="checkbox"
              checked={shiftActive}
              onChange={(e) => setShiftActive(e.target.checked)}
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
              type="date"
              value={rosterDate}
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
                        value={rosterDraft[hk.id] ?? ""}
                        disabled={
                          busy || rosterLoadedDate !== rosterDate
                        }
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
            type="button"
            disabled={
              !canSaveRosterDraft({
                activeDate: rosterDate,
                loadedDate: rosterLoadedDate,
                busy,
              })
            }
            onClick={onSaveRoster}
          >
                        {busy
              ? label("Запис…", "Saving…")
              : label("Запази ростер", "Save roster")}
                    </button>
                    {rosterEntries.length > 0 && (
            // Render JSX element.
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
