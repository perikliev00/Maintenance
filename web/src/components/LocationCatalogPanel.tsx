import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  archiveLocation,
  createLocation,
  fetchLocationHierarchy,
  fetchLocationsCatalog,
  restoreLocation,
  updateLocation,
  type LocationHierarchyBuilding,
  type LocationKind,
  type Room,
} from "../api/client";

type Props = {
  locale: "bg" | "en";
};

export function LocationCatalogPanel({ locale }: Props) {
  const label = (bg: string, en: string) => (locale === "bg" ? bg : en);

  const [hierarchy, setHierarchy] = useState<LocationHierarchyBuilding[]>([]);
  const [locations, setLocations] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kindFilter, setKindFilter] = useState<"all" | LocationKind>("all");
  const [showArchived, setShowArchived] = useState(true);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [buildingId, setBuildingId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [number, setNumber] = useState("");
  const [kind, setKind] = useState<LocationKind>("room");

  const floorsForBuilding = useMemo(() => {
    return hierarchy.find((b) => b.id === buildingId)?.floors ?? [];
  }, [hierarchy, buildingId]);

  const refresh = useCallback(async () => {
    const [hier, locs] = await Promise.all([
      fetchLocationHierarchy(),
      fetchLocationsCatalog({
        kind: kindFilter === "all" ? undefined : kindFilter,
        includeArchived: showArchived,
      }),
    ]);
    setHierarchy(hier);
    setLocations(locs);
    setBuildingId((prev) => {
      if (prev) return prev;
      return hier[0]?.id ?? "";
    });
    setFloorId((prev) => {
      if (prev) return prev;
      return hier[0]?.floors[0]?.id ?? "";
    });
  }, [kindFilter, showArchived]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await refresh();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Load failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  function resetForm() {
    setEditingId(null);
    setNumber("");
    setKind("room");
    if (hierarchy[0]) {
      setBuildingId(hierarchy[0].id);
      setFloorId(hierarchy[0].floors[0]?.id ?? "");
    }
  }

  function startEdit(loc: Room) {
    setEditingId(loc.id);
    setNumber(loc.number);
    setKind(loc.kind === "common_area" ? "common_area" : "room");
    const building = hierarchy.find((b) =>
      b.floors.some((f) => f.id === loc.floorId),
    );
    if (building) {
      setBuildingId(building.id);
      setFloorId(loc.floorId ?? building.floors[0]?.id ?? "");
    } else if (loc.floorId) {
      setFloorId(loc.floorId);
    }
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      await refresh();
      setMessage(label("Запазено", "Saved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!floorId || !number.trim()) return;
    await run(async () => {
      if (editingId) {
        await updateLocation(editingId, {
          floorId,
          number: number.trim(),
          kind,
        });
      } else {
        await createLocation({
          floorId,
          number: number.trim(),
          kind,
        });
      }
      resetForm();
    });
  }

  if (loading) {
    return <p className="muted">{label("Зареждане…", "Loading…")}</p>;
  }

  return (
    <section className="panel">
      <h2>{label("Каталог помещения", "Location catalog")}</h2>
      <p className="muted">
        {label(
          "Добавяне, редакция и архивиране на стаи и общи части. Оперативните статуси (заетост, out of service) се управляват от таблото Стаи / Общи части.",
          "Create, edit and archive rooms and common areas. Operational states (occupancy, out of service) are managed from the Rooms / Common areas board.",
        )}
      </p>

      {error && <p className="error-banner">{error}</p>}
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
      </div>

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
                      onClick={() => run(() => restoreLocation(loc.id))}
                    >
                      {label("Възстанови", "Restore")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ghost"
                      disabled={busy}
                      onClick={() => run(() => archiveLocation(loc.id))}
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

      <form className="report-form" onSubmit={onSubmit}>
        <h3>
          {editingId
            ? label("Редакция на помещение", "Edit location")
            : label("Ново помещение", "New location")}
        </h3>
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
            placeholder={kind === "common_area" ? "Lobby" : "101"}
          />
        </label>
        <label>
          {label("Вид", "Kind")}
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as LocationKind)}
          >
            <option value="room">{label("Стая", "Room")}</option>
            <option value="common_area">
              {label("Обща част", "Common area")}
            </option>
          </select>
        </label>
        <div className="form-actions">
          <button type="submit" disabled={busy || !floorId}>
            {editingId
              ? label("Запази", "Save")
              : label("Добави", "Add")}
          </button>
          {editingId && (
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={resetForm}
            >
              {label("Отказ", "Cancel")}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
