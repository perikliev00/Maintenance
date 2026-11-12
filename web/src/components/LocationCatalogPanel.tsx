/**
 * CRUD panel for the location catalog (rooms / common areas).
 * Create/edit use centered modals; list uses server pagination.
 */
import { archiveLocation, restoreLocation, type LocationKind } from "../api/client";
// Import dependency used by this module.
import { useLocationCatalog } from "../hooks/useLocationCatalog";
// Import dependency used by this module.
import { FormModal } from "./FormModal";
// Import dependency used by this module.
import { LoadingIndicator } from "./LoadingIndicator";

// Local type alias shaping data.
type Props = {
  // Field/property in this shape.
  locale: "bg" | "en";
  // Arrow function / callback body.
  onCatalogChanged?: () => void;
};

// Exported function entry point.
export function LocationCatalogPanel({ locale, onCatalogChanged }: Props) {
  // Open multi-line construct.
  const {
    // List item in import/export/params.
    label,
    // List item in import/export/params.
    hierarchy,
    // List item in import/export/params.
    locations,
    // List item in import/export/params.
    loading,
    // List item in import/export/params.
    error,
    // List item in import/export/params.
    formError,
    // List item in import/export/params.
    message,
    // List item in import/export/params.
    busy,
    // List item in import/export/params.
    kindFilter,
    // List item in import/export/params.
    setKindFilter,
    // List item in import/export/params.
    showArchived,
    // List item in import/export/params.
    setShowArchived,
    // List item in import/export/params.
    search,
    // List item in import/export/params.
    setSearch,
    // List item in import/export/params.
    page,
    // List item in import/export/params.
    setPage,
    // List item in import/export/params.
    pageSize,
    // List item in import/export/params.
    setPageSize,
    // List item in import/export/params.
    total,
    // List item in import/export/params.
    totalPages,
    // List item in import/export/params.
    pageSizes,
    // List item in import/export/params.
    mode,
    // List item in import/export/params.
    buildingId,
    // List item in import/export/params.
    setBuildingId,
    // List item in import/export/params.
    floorId,
    // List item in import/export/params.
    setFloorId,
    // List item in import/export/params.
    number,
    // List item in import/export/params.
    setNumber,
    // List item in import/export/params.
    kind,
    // List item in import/export/params.
    setKind,
    // List item in import/export/params.
    floorsForBuilding,
    // List item in import/export/params.
    dirty,
    // List item in import/export/params.
    title,
    // List item in import/export/params.
    closeForm,
    // List item in import/export/params.
    startCreate,
    // List item in import/export/params.
    startEdit,
    // List item in import/export/params.
    runMutation,
    // List item in import/export/params.
    onSubmit,
    // List item in import/export/params.
    retryLoad,
  // Assign value for subsequent use.
  } = useLocationCatalog({ locale, onCatalogChanged });

  // Return computed result to caller.
  return (
    // Render JSX element.
    <section className="panel">
            <div className="panel-header">
                <h2>{label("Каталог помещения", "Location catalog")}</h2>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <button type="button" disabled={busy} onClick={() => startCreate("room")}>
                        {label("+ Добави стая", "+ Add room")}
                    </button>
                    <button
            // Assign value for subsequent use.
            type="button"
            // Assign value for subsequent use.
            disabled={busy}
            // Arrow function / callback body.
            onClick={() => startCreate("common_area")}
          >
                        {label("+ Добави обща част", "+ Add common area")}
                    </button>
                </div>
            </div>
            <p className="muted">
                {label(
          // Invoke helper or pass arguments.
          "Добавяне, редакция и архивиране на стаи и общи части. Оперативните статуси (заетост, out of service) се управляват от таблото Стаи / Общи части.",
          // Invoke helper or pass arguments.
          "Create, edit and archive rooms and common areas. Operational states (occupancy, out of service) are managed from the Rooms / Common areas board.",
        )}
            </p>

            {error && (
        // Render JSX element.
        <p className="error-banner">
                    {error}{" "}
                    <button type="button" className="ghost" onClick={() => void retryLoad()}>
                        {label("Презареди", "Reload")}
                    </button>
                </p>
      )}
            {message && <p className="ok-banner">{message}</p>}

            <div className="toolbar" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
                <label>
                    {label("Вид", "Kind")}
                    <select
            // Assign value for subsequent use.
            value={kindFilter}
            // Arrow function / callback body.
            onChange={(e) =>
              // Invoke helper or pass arguments.
              setKindFilter(e.target.value as "all" | LocationKind)
            }
          >
                        <option value="all">{label("Всички", "All")}</option>
                        <option value="room">{label("Стаи", "Rooms")}</option>
                        <option value="common_area">
                            {label("Общи части", "Common areas")}
                        </option>
                    </select>
                </label>
                <label className="checkbox-inline">
                    <input
            // Assign value for subsequent use.
            type="checkbox"
            // Assign value for subsequent use.
            checked={showArchived}
            // Arrow function / callback body.
            onChange={(e) => setShowArchived(e.target.checked)}
          />
                    {label("Показвай архивирани", "Show archived")}
                </label>
                <label>
                    {label("Търсене", "Search")}
                    <input
            // Assign value for subsequent use.
            type="search"
            // Assign value for subsequent use.
            value={search}
            // Arrow function / callback body.
            onChange={(e) => setSearch(e.target.value)}
            // Assign value for subsequent use.
            placeholder={label("Номер / сграда…", "Number / building…")}
          />
                </label>
            </div>

            {loading ? (
        // Render JSX element.
        <LoadingIndicator label={label("Зареждане…", "Loading…")} />
      // Invoke helper or pass arguments.
      ) : (
        // Continue module logic.
        <>
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>{label("Номер", "Number")}</th>
                                    <th>{label("Сграда", "Building")}</th>
                                    <th>{label("Етаж", "Floor")}</th>
                                    <th>{label("Вид", "Kind")}</th>
                                    <th>{label("Каталог", "Catalog")}</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {locations.map((loc) => (
                  // Render JSX element.
                  <tr key={loc.id}>
                                        <td>
                                            <strong>{loc.number}</strong>
                                        </td>
                                        <td>
                                            {loc.buildingCode}
                                            <div className="muted small">{loc.building}</div>
                                        </td>
                                        <td>
                                            {loc.floor}
                                            {loc.floorName ? (
                        // Render JSX element.
                        <div className="muted small">{loc.floorName}</div>
                      // Close multi-line construct with trailing syntax.
                      ) : null}
                                        </td>
                                        <td>
                                            {loc.kind === "common_area"
                        // Invoke helper or pass arguments.
                        ? label("обща част", "common area")
                        // Invoke helper or pass arguments.
                        : label("стая", "room")}
                                        </td>
                                        <td>
                                            {loc.catalogStatus === "archived"
                        // Invoke helper or pass arguments.
                        ? label("архивирана", "archived")
                        // Invoke helper or pass arguments.
                        : label("активна", "active")}
                                        </td>
                                        <td className="actions">
                                            <button
                        // Assign value for subsequent use.
                        type="button"
                        // Assign value for subsequent use.
                        className="ghost"
                        // Assign value for subsequent use.
                        disabled={busy}
                        // Arrow function / callback body.
                        onClick={() => startEdit(loc)}
                      >
                                                {label("Редакция", "Edit")}
                                            </button>
                                            {loc.catalogStatus === "archived" ? (
                        // Render JSX element.
                        <button
                          // Assign value for subsequent use.
                          type="button"
                          // Assign value for subsequent use.
                          className="ghost"
                          // Assign value for subsequent use.
                          disabled={busy}
                          // Arrow function / callback body.
                          onClick={() =>
                            // Arrow function / callback body.
                            runMutation(() => restoreLocation(loc.id))
                          }
                        >
                                                    {label("Възстанови", "Restore")}
                                                </button>
                      // Invoke helper or pass arguments.
                      ) : (
                        // Render JSX element.
                        <button
                          // Assign value for subsequent use.
                          type="button"
                          // Assign value for subsequent use.
                          className="ghost"
                          // Assign value for subsequent use.
                          disabled={busy}
                          // Arrow function / callback body.
                          onClick={() =>
                            // Arrow function / callback body.
                            runMutation(() => archiveLocation(loc.id))
                          }
                        >
                                                    {label("Архивирай", "Archive")}
                                                </button>
                      )}
                                        </td>
                                    </tr>
                ))}
                                {locations.length === 0 && (
                  // Render JSX element.
                  <tr>
                                        <td colSpan={6} className="muted">
                                            {label("Няма локации", "No locations")}
                                        </td>
                                    </tr>
                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="pagination-bar">
                        <span className="muted small">
                            {label("Стр.", "Page")} {page}/{totalPages} · {total}{" "}
                            {label("общо", "total")}
                        </span>
                        <label className="muted small">
                            {label("По стр.", "Per page")}
                            <select
                // Assign value for subsequent use.
                value={pageSize}
                // Arrow function / callback body.
                onChange={(e) => setPageSize(Number(e.target.value))}
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
              disabled={page <= 1}
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
              disabled={page >= totalPages}
              // Arrow function / callback body.
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
                            {label("Следваща", "Next")}
                        </button>
                    </div>
                </>
      )}

            {mode !== "closed" && (
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
          onClose={closeForm}
          // Assign value for subsequent use.
          onSubmit={onSubmit}
        >
                    <label>
                        {label("Сграда", "Building")}
                        <select
              // Assign value for subsequent use.
              value={buildingId}
              // Arrow function / callback body.
              onChange={(e) => {
                // Local constant binding.
                const nextBuilding = e.target.value;
                // Invoke helper or pass arguments.
                setBuildingId(nextBuilding);
                // Local constant binding.
                const floors =
                  // Arrow function / callback body.
                  hierarchy.find((b) => b.id === nextBuilding)?.floors ?? [];
                // Invoke helper or pass arguments.
                setFloorId(floors[0]?.id ?? "");
              }}
              // JSX boolean prop or identifier.
              required
              // Assign value for subsequent use.
              disabled={busy}
            >
                            {hierarchy.map((b) => (
                // Render JSX element.
                <option key={b.id} value={b.id}>
                                    {b.code} — {b.name}
                                </option>
              ))}
                        </select>
                    </label>
                    <label>
                        {label("Етаж", "Floor")}
                        <select
              // Assign value for subsequent use.
              value={floorId}
              // Arrow function / callback body.
              onChange={(e) => setFloorId(e.target.value)}
              // JSX boolean prop or identifier.
              required
              // Assign value for subsequent use.
              disabled={busy}
            >
                            {floorsForBuilding.map((f) => (
                // Render JSX element.
                <option key={f.id} value={f.id}>
                                    {f.number}
                                    {f.name ? ` — ${f.name}` : ""}
                                </option>
              ))}
                        </select>
                    </label>
                    <label>
                        {label("Номер / име", "Number / name")}
                        <input
              // Assign value for subsequent use.
              value={number}
              // Arrow function / callback body.
              onChange={(e) => setNumber(e.target.value)}
              // JSX boolean prop or identifier.
              required
              // Assign value for subsequent use.
              maxLength={64}
              // Assign value for subsequent use.
              disabled={busy}
              // Assign value for subsequent use.
              placeholder={kind === "common_area" ? "Lobby" : "101"}
            />
                    </label>
                    <label>
                        {label("Вид", "Kind")}
                        <select
              // Assign value for subsequent use.
              value={kind}
              // Arrow function / callback body.
              onChange={(e) => setKind(e.target.value as LocationKind)}
              // Assign value for subsequent use.
              disabled={busy}
            >
                            <option value="room">{label("Стая", "Room")}</option>
                            <option value="common_area">
                                {label("Обща част", "Common area")}
                            </option>
                        </select>
                    </label>
                </FormModal>
      )}
        </section>
  );
}
