/**
 * Sector list + create/edit modals with paginated location membership picker.
 * Create is hidden for supervisor scope; edit uses a centered modal.
 */
import { useMemo } from "react";
import { type Person, type SectorRow } from "../api/client";
import { useLocationCatalogPicker } from "../hooks/useLocationCatalogPicker";
import type { useSectorEditor } from "../pages/housekeeping/useSectorEditor";
import { FormModal } from "./FormModal";
import { LoadingIndicator } from "./LoadingIndicator";

type SectorEditor = ReturnType<typeof useSectorEditor>;

type Props = {
  label: (bg: string, en: string) => string;
  locale: "bg" | "en";
  sectors: SectorRow[];
  supervisors: Person[];
  canManage: boolean;
  /** Hotel-wide actors may create; supervisors may only edit. */
  canCreate: boolean;
  isSupervisorScope: boolean;
  busy: boolean;
  editor: SectorEditor;
};

export function SectorPanel({
  label,
  locale,
  sectors,
  supervisors,
  canManage,
  canCreate,
  isSupervisorScope,
  busy,
  editor,
}: Props) {
  const {
    formError,
    sectorMode: mode,
    editingSector,
    sectorCode,
    sectorNameBg,
    sectorNameEn,
    sectorSupervisorId,
    sectorActive,
    selectedLocationIds,
    selectedLocationMeta,
    dirty,
    setSectorCode,
    setSectorNameBg,
    setSectorNameEn,
    setSectorSupervisorId,
    setSectorActive,
    toggleLocation,
    startCreateSector,
    startEditSector,
    closeSectorForm,
    onSaveSector,
  } = editor;

  const pickerOpen = mode !== "closed";
  const {
    pageSizes,
    search: pickerQ,
    setSearch: setPickerQ,
    page,
    setPage,
    pageSize,
    setPageSize,
    items: pickerRows,
    total: pickerTotal,
    totalPages: pickerTotalPages,
    loading: pickerLoading,
    error: pickerError,
  } = useLocationCatalogPicker({
    enabled: pickerOpen,
    includeArchived: true,
  });

  const selectedSet = useMemo(
    () => new Set(selectedLocationIds),
    [selectedLocationIds],
  );

  const title =
    mode === "edit"
      ? `${label("Редакция на сектор", "Edit sector")}${
          editingSector ? `: ${editingSector.code}` : ""
        }`
      : label("Добавяне на сектор", "Add sector");

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{label("Сектори", "Sectors")}</h2>
        {canCreate && (
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
                      onClick={() => startEditSector(s)}
                      disabled={busy}
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

      {mode !== "closed" && canManage && (
        <FormModal
          title={title}
          busy={busy}
          dirty={dirty}
          error={formError}
          wide
          submitLabel={label("Запази промените", "Save changes")}
          cancelLabel={label("Отмени", "Cancel")}
          onClose={closeSectorForm}
          onSubmit={onSaveSector}
        >
          <label>
            {label("Код", "Code")}
            <input
              value={sectorCode}
              onChange={(e) => setSectorCode(e.target.value)}
              required
              maxLength={32}
              disabled={busy}
            />
          </label>
          <label>
            {label("Име BG", "Name BG")}
            <input
              value={sectorNameBg}
              onChange={(e) => setSectorNameBg(e.target.value)}
              required
              disabled={busy}
            />
          </label>
          <label>
            {label("Име EN", "Name EN")}
            <input
              value={sectorNameEn}
              onChange={(e) => setSectorNameEn(e.target.value)}
              required
              disabled={busy}
            />
          </label>
          <label>
            {label("Супервайзър", "Supervisor")}
            <select
              value={sectorSupervisorId}
              onChange={(e) => setSectorSupervisorId(e.target.value)}
              disabled={isSupervisorScope || busy}
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
              onChange={(e) => setSectorActive(e.target.checked)}
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
                "Избраните помещения се запазват при смяна на страница и търсене.",
                "Selected locations are kept across pages and search.",
              )}
            </p>
            {selectedLocationIds.length > 0 && (
              <div className="muted small" style={{ marginBottom: 8 }}>
                {selectedLocationIds.slice(0, 12).map((id) => {
                  const meta = selectedLocationMeta.get(id);
                  const archived =
                    meta &&
                    "catalogStatus" in meta &&
                    meta.catalogStatus === "archived";
                  return (
                    <span key={id} style={{ marginRight: 8 }}>
                      {meta
                        ? `${"buildingCode" in meta ? meta.buildingCode : ""} ${meta.number}`
                        : id.slice(0, 8)}
                      {archived && (
                        <span className="location-archived-tag">
                          {label("архив", "archived")}
                        </span>
                      )}
                    </span>
                  );
                })}
                {selectedLocationIds.length > 12
                  ? ` +${selectedLocationIds.length - 12}`
                  : ""}
              </div>
            )}
            <input
              type="search"
              placeholder={label("Търсене…", "Search…")}
              value={pickerQ}
              onChange={(e) => setPickerQ(e.target.value)}
              disabled={busy}
              style={{ marginTop: 8, marginBottom: 8, width: "100%" }}
            />
            {pickerError && <p className="error-banner">{pickerError}</p>}
            {pickerLoading && (
              <LoadingIndicator label={label("Зареждане…", "Loading…")} />
            )}
            <div
              className="table-wrap"
              style={{ maxHeight: 240, overflow: "auto" }}
            >
              {pickerRows.map((r) => (
                <label key={r.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(r.id)}
                    onChange={() => toggleLocation(r.id, r)}
                    disabled={busy}
                  />
                  {r.buildingCode} {r.number}
                  <span className="muted small">
                    {" "}
                    · {r.kind === "common_area"
                      ? label("обща част", "common")
                      : label("стая", "room")}{" "}
                    · ет. {r.floor}
                    {r.sector && r.sector.id !== editingSector?.id
                      ? ` · ${r.sector.code}`
                      : ""}
                  </span>
                  {r.catalogStatus === "archived" && (
                    <span className="location-archived-tag">
                      {label("архив", "archived")}
                    </span>
                  )}
                </label>
              ))}
              {!pickerLoading && pickerRows.length === 0 && (
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
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  disabled={busy}
                >
                  {pageSizes.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="ghost"
                disabled={busy || page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {label("Предишна", "Previous")}
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy || page >= pickerTotalPages}
                onClick={() =>
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
