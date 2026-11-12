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
      // Render JSX element.
      <div className="panel-header">
        // Render JSX element.
        <h2>{label("Сектори", "Sectors")}</h2>
        // JSX expression container.
        {canCreate && (
          // Render JSX element.
          <button type="button" onClick={startCreateSector} disabled={busy}>
            // JSX expression container.
            {label("+ Добави сектор", "+ Add sector")}
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
              <th>{label("Супервайзър", "Supervisor")}</th>
              // Render JSX element.
              <th>{label("Помещения", "Locations")}</th>
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
            {sectors.map((s) => (
              // Render JSX element.
              <tr key={s.id}>
                // Render JSX element.
                <td>
                  // Render JSX element.
                  <strong>{s.code}</strong>
                // JSX element boundary.
                </td>
                // Render JSX element.
                <td>
                  // JSX expression container.
                  {locale === "bg" ? s.nameBg : s.nameEn}
                  // Render JSX element.
                  <div className="muted small">
                    // JSX expression container.
                    {locale === "bg" ? s.nameEn : s.nameBg}
                  // JSX element boundary.
                  </div>
                // JSX element boundary.
                </td>
                // Render JSX element.
                <td>
                  // JSX expression container.
                  {s.primarySupervisor
                    // Invoke helper or pass arguments.
                    ? `${s.primarySupervisor.fullName} (${s.primarySupervisor.employeeNumber})`
                    // Continue module logic.
                    : "—"}
                // JSX element boundary.
                </td>
                // Render JSX element.
                <td>{s.locationCount}</td>
                // Render JSX element.
                <td>
                  // JSX expression container.
                  {s.isActive
                    // Invoke helper or pass arguments.
                    ? label("активен", "active")
                    // Invoke helper or pass arguments.
                    : label("неактивен", "inactive")}
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
                      onClick={() => startEditSector(s)}
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
            {sectors.length === 0 && (
              // Render JSX element.
              <tr>
                // Render JSX element.
                <td colSpan={6} className="muted">
                  // JSX expression container.
                  {label("Няма сектори", "No sectors yet")}
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
          // Render JSX element.
          <label>
            // JSX expression container.
            {label("Код", "Code")}
            // Render JSX element.
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
          // JSX element boundary.
          </label>
          // Render JSX element.
          <label>
            // JSX expression container.
            {label("Име BG", "Name BG")}
            // Render JSX element.
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
          // JSX element boundary.
          </label>
          // Render JSX element.
          <label>
            // JSX expression container.
            {label("Име EN", "Name EN")}
            // Render JSX element.
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
          // JSX element boundary.
          </label>
          // Render JSX element.
          <label>
            // JSX expression container.
            {label("Супервайзър", "Supervisor")}
            // Render JSX element.
            <select
              // Assign value for subsequent use.
              value={sectorSupervisorId}
              // Arrow function / callback body.
              onChange={(e) => setSectorSupervisorId(e.target.value)}
              // Assign value for subsequent use.
              disabled={isSupervisorScope || busy}
            >
              // Render JSX element.
              <option value="">—</option>
              // JSX expression container.
              {supervisors.map((p) => (
                // Render JSX element.
                <option key={p.employeeId} value={p.employeeId}>
                  // JSX expression container.
                  {p.fullName} ({p.employeeNumber})
                // JSX element boundary.
                </option>
              ))}
            // JSX element boundary.
            </select>
          // JSX element boundary.
          </label>
          // Render JSX element.
          <label className="check-row">
            // Render JSX element.
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
            // JSX expression container.
            {label("Активен", "Active")}
          // JSX element boundary.
          </label>

          // Render JSX element.
          <div>
            // Render JSX element.
            <strong>
              // JSX expression container.
              {label("Помещения", "Locations")} ({selectedLocationIds.length})
            // JSX element boundary.
            </strong>
            // Render JSX element.
            <p className="muted small">
              // JSX expression container.
              {label(
                // Continue multi-line list/arguments.
                "Избраните помещения се запазват при смяна на страница и търсене.",
                // Continue multi-line list/arguments.
                "Selected locations are kept across pages and search.",
              )}
            // JSX element boundary.
            </p>
            // JSX expression container.
            {selectedLocationIds.length > 0 && (
              // Render JSX element.
              <div className="muted small" style={{ marginBottom: 8 }}>
                // JSX expression container.
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
                      // JSX expression container.
                      {meta
                        // Continue module logic.
                        ? `${"buildingCode" in meta ? meta.buildingCode : ""} ${meta.number}`
                        // Invoke helper or pass arguments.
                        : id.slice(0, 8)}
                      // JSX expression container.
                      {archived && (
                        // Render JSX element.
                        <span className="location-archived-tag">
                          // JSX expression container.
                          {label("архив", "archived")}
                        // JSX element boundary.
                        </span>
                      )}
                    // JSX element boundary.
                    </span>
                  );
                })}
                // JSX expression container.
                {selectedLocationIds.length > 12
                  // Continue module logic.
                  ? ` +${selectedLocationIds.length - 12}`
                  // Continue module logic.
                  : ""}
              // JSX element boundary.
              </div>
            )}
            // Render JSX element.
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
            // JSX expression container.
            {pickerError && <p className="error-banner">{pickerError}</p>}
            // JSX expression container.
            {pickerLoading && (
              // Render JSX element.
              <LoadingIndicator label={label("Зареждане…", "Loading…")} />
            )}
            // Render JSX element.
            <div
              // Assign value for subsequent use.
              className="table-wrap"
              // Assign value for subsequent use.
              style={{ maxHeight: 240, overflow: "auto" }}
            >
              // JSX expression container.
              {pickerRows.map((r) => (
                // Render JSX element.
                <label key={r.id} className="check-row">
                  // Render JSX element.
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
                  // JSX expression container.
                  {r.buildingCode} {r.number}
                  // Render JSX element.
                  <span className="muted small">
                    // JSX expression container.
                    {" "}
                    // Assign value for subsequent use.
                    · {r.kind === "common_area"
                      // Invoke helper or pass arguments.
                      ? label("обща част", "common")
                      // Invoke helper or pass arguments.
                      : label("стая", "room")}{" "}
                    // Continue module logic.
                    · ет. {r.floor}
                    // JSX expression container.
                    {r.sector && r.sector.id !== editingSector?.id
                      // Continue module logic.
                      ? ` · ${r.sector.code}`
                      // Continue module logic.
                      : ""}
                  // JSX element boundary.
                  </span>
                  // JSX expression container.
                  {r.catalogStatus === "archived" && (
                    // Render JSX element.
                    <span className="location-archived-tag">
                      // JSX expression container.
                      {label("архив", "archived")}
                    // JSX element boundary.
                    </span>
                  )}
                // JSX element boundary.
                </label>
              ))}
              // JSX expression container.
              {!pickerLoading && pickerRows.length === 0 && (
                // Render JSX element.
                <p className="muted">
                  // JSX expression container.
                  {label("Няма резултати", "No results")}
                // JSX element boundary.
                </p>
              )}
            // JSX element boundary.
            </div>
            // Render JSX element.
            <div className="pagination-bar">
              // Render JSX element.
              <span className="muted small">
                // JSX expression container.
                {label("Стр.", "Page")} {page}/{pickerTotalPages} ·{" "}
                // JSX expression container.
                {pickerTotal} {label("общо", "total")}
              // JSX element boundary.
              </span>
              // Render JSX element.
              <label className="muted small">
                // JSX expression container.
                {label("По стр.", "Per page")}
                // Render JSX element.
                <select
                  // Assign value for subsequent use.
                  value={pageSize}
                  // Arrow function / callback body.
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  // Assign value for subsequent use.
                  disabled={busy}
                >
                  // JSX expression container.
                  {pageSizes.map((n) => (
                    // Render JSX element.
                    <option key={n} value={n}>
                      // JSX expression container.
                      {n}
                    // JSX element boundary.
                    </option>
                  ))}
                // JSX element boundary.
                </select>
              // JSX element boundary.
              </label>
              // Render JSX element.
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
                // JSX expression container.
                {label("Предишна", "Previous")}
              // JSX element boundary.
              </button>
              // Render JSX element.
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
                // JSX expression container.
                {label("Следваща", "Next")}
              // JSX element boundary.
              </button>
            // JSX element boundary.
            </div>
          // JSX element boundary.
          </div>
        // JSX element boundary.
        </FormModal>
      )}
    // JSX element boundary.
    </section>
  );
}
