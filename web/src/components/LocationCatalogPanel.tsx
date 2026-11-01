/**
 * CRUD panel for the location catalog (rooms / common areas).
 * Create/edit use centered modals; list uses server pagination.
 */
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  archiveLocation,
  createLocation,
  fetchLocationHierarchy,
  fetchLocationsCatalogPage,
  restoreLocation,
  updateLocation,
  type LocationHierarchyBuilding,
  type LocationKind,
  type Room,
} from "../api/client";
import { FormModal } from "./FormModal";

type Props = {
  locale: "bg" | "en";
  onCatalogChanged?: () => void;
};

const PAGE_SIZES = [25, 50, 100] as const;

export function LocationCatalogPanel({ locale, onCatalogChanged }: Props) {
  const label = (bg: string, en: string) => (locale === "bg" ? bg : en);

  const [hierarchy, setHierarchy] = useState<LocationHierarchyBuilding[]>([]);
  const [locations, setLocations] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kindFilter, setKindFilter] = useState<"all" | LocationKind>("all");
  const [showArchived, setShowArchived] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const [mode, setMode] = useState<"closed" | "create" | "edit">("closed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [createKind, setCreateKind] = useState<LocationKind>("room");
  const [buildingId, setBuildingId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [number, setNumber] = useState("");
  const [kind, setKind] = useState<LocationKind>("room");
  const [baseline, setBaseline] = useState("");

  const floorsForBuilding = useMemo(() => {
    return hierarchy.find((b) => b.id === buildingId)?.floors ?? [];
  }, [hierarchy, buildingId]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, kindFilter, showArchived, pageSize]);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const [hier, pageResult] = await Promise.all([
        fetchLocationHierarchy(),
        fetchLocationsCatalogPage({
          kind: kindFilter === "all" ? undefined : kindFilter,
          includeArchived: showArchived,
          q: debouncedQ,
          page,
          pageSize,
          signal,
        }),
      ]);
      setHierarchy(hier);
      setLocations(pageResult.items);
      setTotal(pageResult.total);
      setTotalPages(pageResult.totalPages);
      if (pageResult.page !== page) setPage(pageResult.page);
      setBuildingId((prev) => prev || hier[0]?.id || "");
      setFloorId((prev) => prev || hier[0]?.floors[0]?.id || "");
    },
    [kindFilter, showArchived, debouncedQ, page, pageSize],
  );

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await refresh(ac.signal);
      } catch (err) {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Load failed");
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [refresh]);

  const dirty =
    mode !== "closed" &&
    JSON.stringify({ buildingId, floorId, number, kind }) !== baseline;

  function closeForm(options?: { force?: boolean }) {
    if (!options?.force && busyRef.current) return;
    setMode("closed");
    setEditingId(null);
    setNumber("");
    setFormError(null);
  }

  function startCreate(preferredKind: LocationKind) {
    if (busyRef.current) return;
    const building = hierarchy[0];
    const floor = building?.floors[0];
    setMode("create");
    setEditingId(null);
    setCreateKind(preferredKind);
    setKind(preferredKind);
    setNumber("");
    setBuildingId(building?.id ?? "");
    setFloorId(floor?.id ?? "");
    setFormError(null);
    setMessage(null);
    setBaseline(
      JSON.stringify({
        buildingId: building?.id ?? "",
        floorId: floor?.id ?? "",
        number: "",
        kind: preferredKind,
      }),
    );
  }

  function startEdit(loc: Room) {
    if (busyRef.current) return;
    setMode("edit");
    setEditingId(loc.id);
    setNumber(loc.number);
    setKind(loc.kind === "common_area" ? "common_area" : "room");
    const building = hierarchy.find((b) =>
      b.floors.some((f) => f.id === loc.floorId),
    );
    const nextBuilding = building?.id ?? buildingId;
    const nextFloor = loc.floorId ?? building?.floors[0]?.id ?? "";
    setBuildingId(nextBuilding);
    setFloorId(nextFloor);
    setFormError(null);
    setMessage(null);
    setBaseline(
      JSON.stringify({
        buildingId: nextBuilding,
        floorId: nextFloor,
        number: loc.number,
        kind: loc.kind === "common_area" ? "common_area" : "room",
      }),
    );
  }

  async function runMutation(action: () => Promise<unknown>, close = false) {
    busyRef.current = true;
    setBusy(true);
    setFormError(null);
    setError(null);
    setMessage(null);
    try {
      await action();
      if (close) closeForm({ force: true });
      try {
        await refresh();
        setMessage(label("Запазено", "Saved"));
        onCatalogChanged?.();
      } catch (refreshErr) {
        setError(
          refreshErr instanceof Error
            ? `${label(
                "Записът е успешен, но обновяването се провали",
                "Saved, but refresh failed",
              )}: ${refreshErr.message}`
            : label(
                "Записът е успешен, но обновяването се провали",
                "Saved, but refresh failed",
              ),
        );
        onCatalogChanged?.();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Action failed";
      if (mode !== "closed") setFormError(msg);
      else setError(msg);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const resolvedFloor =
      floorId ||
      floorsForBuilding[0]?.id ||
      hierarchy[0]?.floors[0]?.id ||
      "";
    if (!resolvedFloor || !number.trim()) {
      setFormError(
        label(
          "Изберете етаж и въведете номер.",
          "Select a floor and enter a number.",
        ),
      );
      return;
    }
    if (!floorId) setFloorId(resolvedFloor);
    await runMutation(async () => {
      if (editingId) {
        await updateLocation(editingId, {
          floorId: resolvedFloor,
          number: number.trim(),
          kind,
        });
      } else {
        await createLocation({
          floorId: resolvedFloor,
          number: number.trim(),
          kind,
        });
      }
    }, true);
  }

  const title =
    mode === "edit"
      ? label("Редакция на помещение", "Edit location")
      : createKind === "common_area"
        ? label("Добавяне на обща част", "Add common area")
        : label("Добавяне на стая", "Add room");

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
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setError(null);
              void refresh().catch((err) =>
                setError(err instanceof Error ? err.message : "Load failed"),
              );
            }}
          >
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
                {PAGE_SIZES.map((n) => (
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
