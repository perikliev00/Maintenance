/**
 * CRUD panel for the location catalog (rooms / common areas).
 * Create/edit use centered modals; list uses server pagination.
 */
import { archiveLocation, restoreLocation, type LocationKind } from "../api/client";
import { useLocationCatalog } from "../hooks/useLocationCatalog";
import { FormModal } from "./FormModal";

type Props = {
  locale: "bg" | "en";
  onCatalogChanged?: () => void;
};

export function LocationCatalogPanel({ locale, onCatalogChanged }: Props) {
  const {
    label,
    hierarchy,
    locations,
    loading,
    error,
    formError,
    message,
    busy,
    kindFilter,
    setKindFilter,
    showArchived,
    setShowArchived,
    search,
    setSearch,
    page,
    setPage,
    pageSize,
    setPageSize,
    total,
    totalPages,
    pageSizes,
    mode,
    buildingId,
    setBuildingId,
    floorId,
    setFloorId,
    number,
    setNumber,
    kind,
    setKind,
    floorsForBuilding,
    dirty,
    title,
    closeForm,
    startCreate,
    startEdit,
    runMutation,
    onSubmit,
    retryLoad,
  } = useLocationCatalog({ locale, onCatalogChanged });

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{label("Каталог помещения", "Location catalog")}</h2>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="button" disabled={busy} onClick={() => startCreate("room")}>
            {label("+ Добави стая", "+ Add room")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => startCreate("common_area")}
          >
            {label("+ Добави обща част", "+ Add common area")}
          </button>
        </div>
      </div>
      <p className="muted">
        {label(
          "Добавяне, редакция и архивиране на стаи и общи части. Оперативните статуси (заетост, out of service) се управляват от таблото Стаи / Общи части.",
          "Create, edit and archive rooms and common areas. Operational states (occupancy, out of service) are managed from the Rooms / Common areas board.",
        )}
      </p>

      {error && (
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
            value={kindFilter}
            onChange={(e) =>
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
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          {label("Показвай архивирани", "Show archived")}
        </label>
        <label>
          {label("Търсене", "Search")}
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={label("Номер / сграда…", "Number / building…")}
          />
        </label>
      </div>

      {loading ? (
        <p className="muted">{label("Зареждане…", "Loading…")}</p>
      ) : (
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
                        <div className="muted small">{loc.floorName}</div>
                      ) : null}
                    </td>
                    <td>
                      {loc.kind === "common_area"
                        ? label("обща част", "common area")
                        : label("стая", "room")}
                    </td>
                    <td>
                      {loc.catalogStatus === "archived"
                        ? label("архивирана", "archived")
                        : label("активна", "active")}
                    </td>
                    <td className="actions">
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        onClick={() => startEdit(loc)}
                      >
                        {label("Редакция", "Edit")}
                      </button>
                      {loc.catalogStatus === "archived" ? (
                        <button
                          type="button"
                          className="ghost"
                          disabled={busy}
                          onClick={() =>
                            runMutation(() => restoreLocation(loc.id))
                          }
                        >
                          {label("Възстанови", "Restore")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="ghost"
                          disabled={busy}
                          onClick={() =>
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
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
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
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {label("Предишна", "Previous")}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              {label("Следваща", "Next")}
            </button>
          </div>
        </>
      )}

      {mode !== "closed" && (
        <FormModal
          title={title}
          busy={busy}
          dirty={dirty}
          error={formError}
          submitLabel={label("Запази промените", "Save changes")}
          cancelLabel={label("Отмени", "Cancel")}
          onClose={closeForm}
          onSubmit={onSubmit}
        >
          <label>
            {label("Сграда", "Building")}
            <select
              value={buildingId}
              onChange={(e) => {
                const nextBuilding = e.target.value;
                setBuildingId(nextBuilding);
                const floors =
                  hierarchy.find((b) => b.id === nextBuilding)?.floors ?? [];
                setFloorId(floors[0]?.id ?? "");
              }}
              required
              disabled={busy}
            >
              {hierarchy.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {label("Етаж", "Floor")}
            <select
              value={floorId}
              onChange={(e) => setFloorId(e.target.value)}
              required
              disabled={busy}
            >
              {floorsForBuilding.map((f) => (
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
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              required
              maxLength={64}
              disabled={busy}
              placeholder={kind === "common_area" ? "Lobby" : "101"}
            />
          </label>
          <label>
            {label("Вид", "Kind")}
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as LocationKind)}
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
