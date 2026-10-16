/**
 * CRUD panel for the location catalog (rooms / common areas).
 * Manages identity (building, floor, number, kind) and archive/restore —
 * not operational states like occupancy (those live on the Rooms board).
 */
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

/**
 * CRUD panel for the location catalog (rooms / common areas).
 * Manages identity (building, floor, number, kind) and archive/restore —
 * not operational states like occupancy.
 */
export function LocationCatalogPanel({ locale }: Props) {
  /**
   * Helper `label`.
   */
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

  // Floors available for the currently selected building.
  const floorsForBuilding = useMemo(() => {
    // Early / value return.
    return hierarchy.find((b) => b.id === buildingId)?.floors ?? [];
  }, [hierarchy, buildingId]);

  /** Load building/floor hierarchy + filtered catalog rows. */
  const refresh = useCallback(async () => {
    const [hier, locs] = await Promise.all([
      fetchLocationHierarchy(),
      fetchLocationsCatalog({
        kind: kindFilter === "all" ? undefined : kindFilter,
        includeArchived: showArchived,
      }),
    ]);
    // State transition.
    setHierarchy(hier);
    // State transition.
    setLocations(locs);
    // Seed building/floor selects once when empty.
    setBuildingId((prev) => {
      // Branch: conditional gate.
      if (prev) return prev;
      // Early / value return.
      return hier[0]?.id ?? "";
    });
    // State transition.
    setFloorId((prev) => {
      // Branch: conditional gate.
      if (prev) return prev;
      // Early / value return.
      return hier[0]?.floors[0]?.id ?? "";
    });
  }, [kindFilter, showArchived]);

  // Re-fetch when filters change; ignore late responses after unmount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Try block for fallible work.
      try {
        // State transition.
        setLoading(true);
        // State transition.
        setError(null);
        // Await async step.
        await refresh();
      } catch (err) {
        // Branch: conditional gate.
        if (!cancelled) {
          // State transition.
          setError(err instanceof Error ? err.message : "Load failed");
        }
      } finally {
        // Branch: conditional gate.
        if (!cancelled) setLoading(false);
      }
    })();
    // Early / value return.
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  /** Clear the form back to create mode with the first building/floor. */
  function resetForm() {
    // State transition.
    setEditingId(null);
    // State transition.
    setNumber("");
    // State transition.
    setKind("room");
    // Branch: conditional gate.
    if (hierarchy[0]) {
      // State transition.
      setBuildingId(hierarchy[0].id);
      // State transition.
      setFloorId(hierarchy[0].floors[0]?.id ?? "");
    }
  }

  /** Populate the form from an existing catalog row for editing. */
  function startEdit(loc: Room) {
    // State transition.
    setEditingId(loc.id);
    // State transition.
    setNumber(loc.number);
    // State transition.
    setKind(loc.kind === "common_area" ? "common_area" : "room");
    const building = hierarchy.find((b) =>
      b.floors.some((f) => f.id === loc.floorId),
    );
    // Branch: conditional gate.
    if (building) {
      // State transition.
      setBuildingId(building.id);
      // State transition.
      setFloorId(loc.floorId ?? building.floors[0]?.id ?? "");
    } else if (loc.floorId) {
      // State transition.
      setFloorId(loc.floorId);
    }
  }

  /**
   * Helper `run`.
   */
  async function run(action: () => Promise<unknown>) {
    // State transition.
    setBusy(true);
    // State transition.
    setError(null);
    // State transition.
    setMessage(null);
    // Try block for fallible work.
    try {
      // Await async step.
      await action();
      // Await async step.
      await refresh();
      // State transition.
      setMessage(label("Запазено", "Saved"));
    } catch (err) {
      // State transition.
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      // State transition.
      setBusy(false);
    }
  }

  /**
   * Handler `onSubmit` for user or form events.
   */
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Branch: conditional gate.
    if (!floorId || !number.trim()) return;
    // Await async step.
    await run(async () => {
      // Branch: conditional gate.
      if (editingId) {
        // Await async step.
        await updateLocation(editingId, {
          floorId,
          number: number.trim(),
          kind,
        });
      } else {
        // Await async step.
        await createLocation({
          floorId,
          number: number.trim(),
          kind,
        });
      }
      resetForm();
    });
  }

  // Branch: conditional gate.
  if (loading) {
    return <p className="muted">{label("Зареждане…", "Loading…")}</p>;
  }

  // Early / value return.
  return (
    <section className="panel">
      <h2>{label("Каталог помещения", "Location catalog")}</h2>
      <p className="muted">
        {label(
          "Добавяне, редакция и архивиране на стаи и общи части. Оперативните статуси (заетост, out of service) се управляват от таблото Стаи / Общи части.",
          "Create, edit and archive rooms and common areas. Operational states (occupancy, out of service) are managed from the Rooms / Common areas board.",
        )}
      </p>

      {/* Render branch: error && <p className="error-banner">error</p> */}
      {error && <p className="error-banner">{error}</p>}
      {/* Render branch: message && <p className="ok-banner">message</p> */}
      {message && <p className="ok-banner">{message}</p>}

      <div className="toolbar" style={{ gap: "0.75rem", flexWrap: "wrap" }}>
        <label>
          {label("Вид", "Kind")}
          <select
            value={kindFilter}
            onChange={(e) =>
              // State transition.
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
              // State transition.
              setBuildingId(nextBuilding);
              const floors =
                hierarchy.find((b) => b.id === nextBuilding)?.floors ?? [];
              // State transition.
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
                {/* Render branch: f.name ? ` — $f.name` : "" */}
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
          {/* Render branch: editingId && ( */}
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
