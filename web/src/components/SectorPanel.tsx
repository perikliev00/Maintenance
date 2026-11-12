/**
 * Sector list + create/edit modals with paginated location membership picker.
 * Create is hidden for supervisor scope; edit uses a centered modal.
 */
import { useMemo } from "react";
// Import dependency used by this module.
import { type Person, type SectorRow } from "../api/client";
// Import dependency used by this module.
import { useLocationCatalogPicker } from "../hooks/useLocationCatalogPicker";
// Import dependency used by this module.
import type { useSectorEditor } from "../pages/housekeeping/useSectorEditor";
// Import dependency used by this module.
import { FormModal } from "./FormModal";
// Import dependency used by this module.
import { LoadingIndicator } from "./LoadingIndicator";

// Local type alias shaping data.
type SectorEditor = ReturnType<typeof useSectorEditor>;

// Local type alias shaping data.
type Props = {
  // Arrow function / callback body.
  label: (bg: string, en: string) => string;
  // Field/property in this shape.
  locale: "bg" | "en";
  // Field/property in this shape.
  sectors: SectorRow[];
  // Field/property in this shape.
  supervisors: Person[];
  // Field/property in this shape.
  canManage: boolean;
  /** Hotel-wide actors may create; supervisors may only edit. */
  canCreate: boolean;
  // Field/property in this shape.
  isSupervisorScope: boolean;
  // Field/property in this shape.
  busy: boolean;
  // Field/property in this shape.
  editor: SectorEditor;
};

// Exported function entry point.
export function SectorPanel({
  // List item in import/export/params.
  label,
  // List item in import/export/params.
  locale,
  // List item in import/export/params.
  sectors,
  // List item in import/export/params.
  supervisors,
  // List item in import/export/params.
  canManage,
  // List item in import/export/params.
  canCreate,
  // List item in import/export/params.
  isSupervisorScope,
  // List item in import/export/params.
  busy,
  // List item in import/export/params.
  editor,
// Open multi-line construct.
}: Props) {
  // Open multi-line construct.
  const {
    // List item in import/export/params.
    formError,
    // Field/property in this shape.
    sectorMode: mode,
    // List item in import/export/params.
    editingSector,
    // List item in import/export/params.
    sectorCode,
    // List item in import/export/params.
    sectorNameBg,
    // List item in import/export/params.
    sectorNameEn,
    // List item in import/export/params.
    sectorSupervisorId,
    // List item in import/export/params.
    sectorActive,
    // List item in import/export/params.
    selectedLocationIds,
    // List item in import/export/params.
    selectedLocationMeta,
    // List item in import/export/params.
    dirty,
    // List item in import/export/params.
    setSectorCode,
    // List item in import/export/params.
    setSectorNameBg,
    // List item in import/export/params.
    setSectorNameEn,
    // List item in import/export/params.
    setSectorSupervisorId,
    // List item in import/export/params.
    setSectorActive,
    // List item in import/export/params.
    toggleLocation,
    // List item in import/export/params.
    startCreateSector,
    // List item in import/export/params.
    startEditSector,
    // List item in import/export/params.
    closeSectorForm,
    // List item in import/export/params.
    onSaveSector,
  // Assign value for subsequent use.
  } = editor;

  // Local constant binding.
  const pickerOpen = mode !== "closed";
  // Open multi-line construct.
  const {
    // List item in import/export/params.
    pageSizes,
    // Field/property in this shape.
    search: pickerQ,
    // Field/property in this shape.
    setSearch: setPickerQ,
    // List item in import/export/params.
    page,
    // List item in import/export/params.
    setPage,
    // List item in import/export/params.
    pageSize,
    // List item in import/export/params.
    setPageSize,
    // Field/property in this shape.
    items: pickerRows,
    // Field/property in this shape.
    total: pickerTotal,
    // Field/property in this shape.
    totalPages: pickerTotalPages,
    // Field/property in this shape.
    loading: pickerLoading,
    // Field/property in this shape.
    error: pickerError,
  // Assign value for subsequent use.
  } = useLocationCatalogPicker({
    // Field/property in this shape.
    enabled: pickerOpen,
    // Field/property in this shape.
    includeArchived: true,
  });

  // Local constant binding.
  const selectedSet = useMemo(
    // Arrow function / callback body.
    () => new Set(selectedLocationIds),
    // Continue multi-line list/arguments.
    [selectedLocationIds],
  );

  // Local constant binding.
  const title =
    // Assign value for subsequent use.
    mode === "edit"
      // Invoke helper or pass arguments.
      ? `${label("Редакция на сектор", "Edit sector")}${
          // Continue module logic.
          editingSector ? `: ${editingSector.code}` : ""
        // Continue module logic.
        }`
      // Invoke helper or pass arguments.
      : label("Добавяне на сектор", "Add sector");

  // Return computed result to caller.
  return (
    // Render JSX element.
    <section className="panel">
            <div className="panel-header">
                <h2>{label("Сектори", "Sectors")}</h2>
                {canCreate && (
          // Render JSX element.
          <button type="button" onClick={startCreateSector} disabled={busy}>
                        {label("+ Добави сектор", "+ Add sector")}
                    </button>
        )}
            </div>

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
              // Render JSX element.
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
                    // Invoke helper or pass arguments.
                    ? `${s.primarySupervisor.fullName} (${s.primarySupervisor.employeeNumber})`
                    // Continue module logic.
                    : "—"}
                                </td>
                                <td>{s.locationCount}</td>
                                <td>
                                    {s.isActive
                    // Invoke helper or pass arguments.
                    ? label("активен", "active")
                    // Invoke helper or pass arguments.
                    : label("неактивен", "inactive")}
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
                      onClick={() => startEditSector(s)}
                      // Assign value for subsequent use.
                      disabled={busy}
                    >
                                            {label("Редакция", "Edit")}
                                        </button>
                  )}
                                </td>
                            </tr>
            ))}
                        {sectors.length === 0 && (
              // Render JSX element.
              <tr>
                                <td colSpan={6} className="muted">
                                    {label("Няма сектори", "No sectors yet")}
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
          // JSX boolean prop or identifier.
          wide
          // Assign value for subsequent use.
          submitLabel={label("Запази промените", "Save changes")}
          // Assign value for subsequent use.
          cancelLabel={label("Отмени", "Cancel")}
          // Assign value for subsequent use.
          onClose={closeSectorForm}
          // Assign value for subsequent use.
          onSubmit={onSaveSector}
        >
                    <label>
                        {label("Код", "Code")}
                        <input
              // Assign value for subsequent use.
              value={sectorCode}
              // Arrow function / callback body.
              onChange={(e) => setSectorCode(e.target.value)}
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
              value={sectorNameBg}
              // Arrow function / callback body.
              onChange={(e) => setSectorNameBg(e.target.value)}
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
              value={sectorNameEn}
              // Arrow function / callback body.
              onChange={(e) => setSectorNameEn(e.target.value)}
              // JSX boolean prop or identifier.
              required
              // Assign value for subsequent use.
              disabled={busy}
            />
                    </label>
                    <label>
                        {label("Супервайзър", "Supervisor")}
                        <select
              // Assign value for subsequent use.
              value={sectorSupervisorId}
              // Arrow function / callback body.
              onChange={(e) => setSectorSupervisorId(e.target.value)}
              // Assign value for subsequent use.
              disabled={isSupervisorScope || busy}
            >
                            <option value="">—</option>
                            {supervisors.map((p) => (
                // Render JSX element.
                <option key={p.employeeId} value={p.employeeId}>
                                    {p.fullName} ({p.employeeNumber})
                </option>
              ))}
                        </select>
                    </label>
                    <label className="check-row">
                        <input
              // Assign value for subsequent use.
              type="checkbox"
              // Assign value for subsequent use.
              checked={sectorActive}
              // Arrow function / callback body.
              onChange={(e) => setSectorActive(e.target.checked)}
              // Assign value for subsequent use.
              disabled={busy}
            />
                        {label("Активен", "Active")}
                    </label>

                    <div>
                        <strong>
                            {label("Помещения", "Locations")} ({selectedLocationIds.length})
            </strong>
                        <p className="muted small">
                            {label(
                // Continue multi-line list/arguments.
                "Избраните помещения се запазват при смяна на страница и търсене.",
                // Continue multi-line list/arguments.
                "Selected locations are kept across pages and search.",
              )}
                        </p>
                        {selectedLocationIds.length > 0 && (
              // Render JSX element.
              <div className="muted small" style={{ marginBottom: 8 }}>
                                {selectedLocationIds.slice(0, 12).map((id) => {
                  // Local constant binding.
                  const meta = selectedLocationMeta.get(id);
                  // Local constant binding.
                  const archived =
                    // Continue module logic.
                    meta &&
                    // Continue module logic.
                    "catalogStatus" in meta &&
                    // Assign value for subsequent use.
                    meta.catalogStatus === "archived";
                  // Return computed result to caller.
                  return (
                    // Render JSX element.
                    <span key={id} style={{ marginRight: 8 }}>
                                            {meta
                        // Continue module logic.
                        ? `${"buildingCode" in meta ? meta.buildingCode : ""} ${meta.number}`
                        // Invoke helper or pass arguments.
                        : id.slice(0, 8)}
                                            {archived && (
                        // Render JSX element.
                        <span className="location-archived-tag">
                                                    {label("архив", "archived")}
                                                </span>
                      )}
                                        </span>
                  );
                })}
                                {selectedLocationIds.length > 12
                  // Continue module logic.
                  ? ` +${selectedLocationIds.length - 12}`
                  // Continue module logic.
                  : ""}
                            </div>
            )}
                        <input
              // Assign value for subsequent use.
              type="search"
              // Assign value for subsequent use.
              placeholder={label("Търсене…", "Search…")}
              // Assign value for subsequent use.
              value={pickerQ}
              // Arrow function / callback body.
              onChange={(e) => setPickerQ(e.target.value)}
              // Assign value for subsequent use.
              disabled={busy}
              // Assign value for subsequent use.
              style={{ marginTop: 8, marginBottom: 8, width: "100%" }}
            />
                        {pickerError && <p className="error-banner">{pickerError}</p>}
                        {pickerLoading && (
              // Render JSX element.
              <LoadingIndicator label={label("Зареждане…", "Loading…")} />
            )}
                        <div
              // Assign value for subsequent use.
              className="table-wrap"
              // Assign value for subsequent use.
              style={{ maxHeight: 240, overflow: "auto" }}
            >
                            {pickerRows.map((r) => (
                // Render JSX element.
                <label key={r.id} className="check-row">
                                    <input
                    // Assign value for subsequent use.
                    type="checkbox"
                    // Assign value for subsequent use.
                    checked={selectedSet.has(r.id)}
                    // Arrow function / callback body.
                    onChange={() => toggleLocation(r.id, r)}
                    // Assign value for subsequent use.
                    disabled={busy}
                  />
                                    {r.buildingCode} {r.number}
                                    <span className="muted small">
                                        {" "}
                                        · {r.kind === "common_area"
                      // Invoke helper or pass arguments.
                      ? label("обща част", "common")
                      // Invoke helper or pass arguments.
                      : label("стая", "room")}{" "}
                                        · ет. {r.floor}
                                        {r.sector && r.sector.id !== editingSector?.id
                      // Continue module logic.
                      ? ` · ${r.sector.code}`
                      // Continue module logic.
                      : ""}
                                    </span>
                                    {r.catalogStatus === "archived" && (
                    // Render JSX element.
                    <span className="location-archived-tag">
                                            {label("архив", "archived")}
                                        </span>
                  )}
                                </label>
              ))}
                            {!pickerLoading && pickerRows.length === 0 && (
                // Render JSX element.
                <p className="muted">
                                    {label("Няма резултати", "No results")}
                                </p>
              )}
                        </div>
                        <div className="pagination-bar">
                            <span className="muted small">
                                {label("Стр.", "Page")} {page}/{pickerTotalPages} ·{" "}
                                {pickerTotal} {label("общо", "total")}
                            </span>
                            <label className="muted small">
                                {label("По стр.", "Per page")}
                                <select
                  // Assign value for subsequent use.
                  value={pageSize}
                  // Arrow function / callback body.
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  // Assign value for subsequent use.
                  disabled={busy}
                >
                                    {pageSizes.map((n) => (
                    // Render JSX element.
                    <option key={n} value={n}>
                                            {n}
                                        </option>
                  ))}
                                </select>
                            </label>
                            <button
                // Assign value for subsequent use.
                type="button"
                // Assign value for subsequent use.
                className="ghost"
                // Assign value for subsequent use.
                disabled={busy || page <= 1}
                // Arrow function / callback body.
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                                {label("Предишна", "Previous")}
                            </button>
                            <button
                // Assign value for subsequent use.
                type="button"
                // Assign value for subsequent use.
                className="ghost"
                // Assign value for subsequent use.
                disabled={busy || page >= pickerTotalPages}
                // Arrow function / callback body.
                onClick={() =>
                  // Arrow function / callback body.
                  setPage((p) => Math.min(pickerTotalPages, p + 1))
                }
              >
                                {label("Следваща", "Next")}
                            </button>
                        </div>
                    </div>
                </FormModal>
      )}
        </section>
  );
}
