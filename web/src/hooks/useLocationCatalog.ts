import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  createLocation,
  fetchLocationHierarchy,
  updateLocation,
  type LocationHierarchyBuilding,
  type LocationKind,
  type Room,
} from "../api/client";
import { useBusyMutation } from "./useBusyMutation";
import { useLocationCatalogPicker } from "./useLocationCatalogPicker";
import { labelFor } from "../i18n";

type UseLocationCatalogParams = {
  locale: "bg" | "en";
  onCatalogChanged?: () => void;
};

export function useLocationCatalog({
  locale,
  onCatalogChanged,
}: UseLocationCatalogParams) {
  const label = labelFor(locale);

  const [hierarchy, setHierarchy] = useState<LocationHierarchyBuilding[]>([]);
  const [hierarchyLoading, setHierarchyLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { busy, busyRef, runMutationWithRefresh } = useBusyMutation();
  const [kindFilter, setKindFilter] = useState<"all" | LocationKind>("all");
  const [showArchived, setShowArchived] = useState(true);

  const catalogKind = kindFilter === "all" ? undefined : kindFilter;
  const picker = useLocationCatalogPicker({
    kind: catalogKind,
    includeArchived: showArchived,
  });

  const loading = picker.loading || hierarchyLoading;
  const locations = picker.items;

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

  const loadHierarchy = useCallback(async (signal?: AbortSignal) => {
    const hier = await fetchLocationHierarchy();
    if (signal?.aborted) return hier;
    setHierarchy(hier);
    setBuildingId((prev) => prev || hier[0]?.id || "");
    setFloorId((prev) => prev || hier[0]?.floors[0]?.id || "");
    return hier;
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        setHierarchyLoading(true);
        await loadHierarchy(ac.signal);
      } catch (err) {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Load failed");
      } finally {
        if (!ac.signal.aborted) setHierarchyLoading(false);
      }
    })();
    return () => ac.abort();
  }, [
    loadHierarchy,
    picker.debouncedQ,
    picker.page,
    picker.pageSize,
    catalogKind,
    showArchived,
  ]);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      await Promise.all([loadHierarchy(signal), picker.reload(signal)]);
    },
    [loadHierarchy, picker.reload],
  );

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
    setFormError(null);
    setError(null);
    setMessage(null);
    const result = await runMutationWithRefresh(async () => {
      await action();
      if (close) closeForm({ force: true });
    }, refresh);
    if (!result.ok) {
      if (result.error === "busy") return;
      if (mode !== "closed") setFormError(result.error);
      else setError(result.error);
      return;
    }
    if (result.outcome === "saved") {
      setMessage(label("Запазено", "Saved"));
      onCatalogChanged?.();
      return;
    }
    const refreshPrefix = label(
      "Записът е успешен, но обновяването се провали",
      "Saved, but refresh failed",
    );
    setError(
      result.refreshError
        ? `${refreshPrefix}: ${result.refreshError}`
        : refreshPrefix,
    );
    onCatalogChanged?.();
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

  async function retryLoad() {
    setError(null);
    picker.setError(null);
    try {
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    }
  }

  return {
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
    search: picker.search,
    setSearch: picker.setSearch,
    page: picker.page,
    setPage: picker.setPage,
    pageSize: picker.pageSize,
    setPageSize: picker.setPageSize,
    total: picker.total,
    totalPages: picker.totalPages,
    pageSizes: picker.pageSizes,
    mode,
    editingId,
    createKind,
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
    refresh,
  };
}
