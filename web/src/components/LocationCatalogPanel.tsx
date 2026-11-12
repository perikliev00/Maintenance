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
      // Render JSX element.
      <div className="panel-header">
        // Render JSX element.
        <h2>{label("Каталог помещения", "Location catalog")}</h2>
        // Render JSX element.
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          // Render JSX element.
          <button type="button" disabled={busy} onClick={() => startCreate("room")}>
            // JSX expression container.
            {label("+ Добави стая", "+ Add room")}
          // JSX element boundary.
          </button>
          // Render JSX element.
          <button
            // Assign value for subsequent use.
            type="button"
            // Assign value for subsequent use.
            disabled={busy}
            // Arrow function / callback body.
            onClick={() => startCreate("common_area")}
          >
            // JSX expression container.
            {label("+ Добави обща част", "+ Add common area")}
          // JSX element boundary.
          </button>
        // JSX element boundary.
        </div>
      // JSX element boundary.
      </div>
      // Render JSX element.
      <p className="muted">
        // JSX expression container.
        {label(
          // Invoke helper or pass arguments.
          "Добавяне, редакция и архивиране на стаи и общи части. Оперативните статуси (заетост, out of service) се управляват от таблото Стаи / Общи части.",
          // Invoke helper or pass arguments.
          "Create, edit and archive rooms and common areas. Operational states (occupancy, out of service) are managed from the Rooms / Common areas board.",
        )}
      // JSX element boundary.
      </p>

      // JSX expression container.
      {error && (
        // Render JSX element.
        <p className="error-banner">
          // JSX expression container.
          {error}{" "}
          // Render JSX element.
          <button type="button" className="ghost" onClick={() => void retryLoad()}>
            // JSX expression container.
            {label("Презареди", "Reload")}
          // JSX element boundary.
          </button>
        // JSX element boundary.
        </p>
      )}
      // JSX expression container.
      {message && <p className="ok-banner">{message}</p>}

      // Render JSX element.
      <div className="toolbar" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
        // Render JSX element.
        <label>
          // JSX expression container.
          {label("Вид", "Kind")}
          // Render JSX element.
          <select
            // Assign value for subsequent use.
            value={kindFilter}
            // Arrow function / callback body.
            onChange={(e) =>
              // Invoke helper or pass arguments.
              setKindFilter(e.target.value as "all" | LocationKind)
            }
          >
            // Render JSX element.
            <option value="all">{label("Всички", "All")}</option>
            // Render JSX element.
            <option value="room">{label("Стаи", "Rooms")}</option>
            // Render JSX element.
            <option value="common_area">
              // JSX expression container.
              {label("Общи части", "Common areas")}
            // JSX element boundary.
            </option>
          // JSX element boundary.
          </select>
        // JSX element boundary.
        </label>
        // Render JSX element.
        <label className="checkbox-inline">
          // Render JSX element.
          <input
            // Assign value for subsequent use.
            type="checkbox"
            // Assign value for subsequent use.
            checked={showArchived}
            // Arrow function / callback body.
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          // JSX expression container.
          {label("Показвай архивирани", "Show archived")}
        // JSX element boundary.
        </label>
        // Render JSX element.
        <label>
          // JSX expression container.
          {label("Търсене", "Search")}
          // Render JSX element.
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
        // JSX element boundary.
        </label>
      // JSX element boundary.
      </div>

      // JSX expression container.
      {loading ? (
        // Render JSX element.
        <LoadingIndicator label={label("Зареждане…", "Loading…")} />
      // Invoke helper or pass arguments.
      ) : (
        // Continue module logic.
        <>
          // Render JSX element.
          <div className="table-wrap">
            // Render JSX element.
            <table>
              // Render JSX element.
              <thead>
                // Render JSX element.
                <tr>
                  // Render JSX element.
                  <th>{label("Номер", "Number")}</th>
                  // Render JSX element.
                  <th>{label("Сграда", "Building")}</th>
                  // Render JSX element.
                  <th>{label("Етаж", "Floor")}</th>
                  // Render JSX element.
                  <th>{label("Вид", "Kind")}</th>
                  // Render JSX element.
                  <th>{label("Каталог", "Catalog")}</th>
                  // Render JSX element.
                  <th />
                // JSX element boundary.
                </tr>
              // JSX element boundary.
              </thead>
              // Render JSX element.
              <tbody>
                // JSX expression container.
                {locations.map((loc) => (
                  // Render JSX element.
                  <tr key={loc.id}>
                    // Render JSX element.
                    <td>
                      // Render JSX element.
                      <strong>{loc.number}</strong>
                    // JSX element boundary.
                    </td>
                    // Render JSX element.
                    <td>
                      // JSX expression container.
                      {loc.buildingCode}
                      // Render JSX element.
                      <div className="muted small">{loc.building}</div>
                    // JSX element boundary.
                    </td>
                    // Render JSX element.
                    <td>
                      // JSX expression container.
                      {loc.floor}
                      // JSX expression container.
                      {loc.floorName ? (
                        // Render JSX element.
                        <div className="muted small">{loc.floorName}</div>
                      // Close multi-line construct with trailing syntax.
                      ) : null}
                    // JSX element boundary.
                    </td>
                    // Render JSX element.
                    <td>
                      // JSX expression container.
                      {loc.kind === "common_area"
                        // Invoke helper or pass arguments.
                        ? label("обща част", "common area")
                        // Invoke helper or pass arguments.
                        : label("стая", "room")}
                    // JSX element boundary.
                    </td>
                    // Render JSX element.
                    <td>
                      // JSX expression container.
                      {loc.catalogStatus === "archived"
                        // Invoke helper or pass arguments.
                        ? label("архивирана", "archived")
                        // Invoke helper or pass arguments.
                        : label("активна", "active")}
                    // JSX element boundary.
                    </td>
                    // Render JSX element.
                    <td className="actions">
                      // Render JSX element.
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
                        // JSX expression container.
                        {label("Редакция", "Edit")}
                      // JSX element boundary.
                      </button>
                      // JSX expression container.
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
                          // JSX expression container.
                          {label("Възстанови", "Restore")}
                        // JSX element boundary.
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
                          // JSX expression container.
                          {label("Архивирай", "Archive")}
                        // JSX element boundary.
                        </button>
                      )}
                    // JSX element boundary.
                    </td>
                  // JSX element boundary.
                  </tr>
                ))}
                // JSX expression container.
                {locations.length === 0 && (
                  // Render JSX element.
                  <tr>
                    // Render JSX element.
                    <td colSpan={6} className="muted">
                      // JSX expression container.
                      {label("Няма локации", "No locations")}
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
          <div className="pagination-bar">
            // Render JSX element.
            <span className="muted small">
              // JSX expression container.
              {label("Стр.", "Page")} {page}/{totalPages} · {total}{" "}
              // JSX expression container.
              {label("общо", "total")}
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
              disabled={page <= 1}
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
              disabled={page >= totalPages}
              // Arrow function / callback body.
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              // JSX expression container.
              {label("Следваща", "Next")}
            // JSX element boundary.
            </button>
          // JSX element boundary.
          </div>
        // Continue module logic.
        </>
      )}

      // JSX expression container.
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
          // Render JSX element.
          <label>
            // JSX expression container.
            {label("Сграда", "Building")}
            // Render JSX element.
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
              // JSX expression container.
              {hierarchy.map((b) => (
                // Render JSX element.
                <option key={b.id} value={b.id}>
                  // JSX expression container.
                  {b.code} — {b.name}
                // JSX element boundary.
                </option>
              ))}
            // JSX element boundary.
            </select>
          // JSX element boundary.
          </label>
          // Render JSX element.
          <label>
            // JSX expression container.
            {label("Етаж", "Floor")}
            // Render JSX element.
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
              // JSX expression container.
              {floorsForBuilding.map((f) => (
                // Render JSX element.
                <option key={f.id} value={f.id}>
                  // JSX expression container.
                  {f.number}
                  // JSX expression container.
                  {f.name ? ` — ${f.name}` : ""}
                // JSX element boundary.
                </option>
              ))}
            // JSX element boundary.
            </select>
          // JSX element boundary.
          </label>
          // Render JSX element.
          <label>
            // JSX expression container.
            {label("Номер / име", "Number / name")}
            // Render JSX element.
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
          // JSX element boundary.
          </label>
          // Render JSX element.
          <label>
            // JSX expression container.
            {label("Вид", "Kind")}
            // Render JSX element.
            <select
              // Assign value for subsequent use.
              value={kind}
              // Arrow function / callback body.
              onChange={(e) => setKind(e.target.value as LocationKind)}
              // Assign value for subsequent use.
              disabled={busy}
            >
              // Render JSX element.
              <option value="room">{label("Стая", "Room")}</option>
              // Render JSX element.
              <option value="common_area">
                // JSX expression container.
                {label("Обща част", "Common area")}
              // JSX element boundary.
              </option>
            // JSX element boundary.
            </select>
          // JSX element boundary.
          </label>
        // JSX element boundary.
        </FormModal>
      )}
    // JSX element boundary.
    </section>
  );
}
