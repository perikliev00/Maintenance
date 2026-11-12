// Import dependency used by this module.
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  createLocation,
  // List item in import/export/params.
  fetchLocationHierarchy,
  // List item in import/export/params.
  updateLocation,
  // Local type alias shaping data.
  type LocationHierarchyBuilding,
  // Local type alias shaping data.
  type LocationKind,
  // Local type alias shaping data.
  type Room,
// Close multi-line construct with trailing syntax.
} from "../api/client";
// Import dependency used by this module.
import { useBusyMutation } from "./useBusyMutation";
// Import dependency used by this module.
import { useLocationCatalogPicker } from "./useLocationCatalogPicker";
// Import dependency used by this module.
import { labelFor } from "../i18n";

// Local type alias shaping data.
type UseLocationCatalogParams = {
  // Field/property in this shape.
  locale: "bg" | "en";
  // Arrow function / callback body.
  onCatalogChanged?: () => void;
};

// Exported function entry point.
export function useLocationCatalog({
  // List item in import/export/params.
  locale,
  // List item in import/export/params.
  onCatalogChanged,
// Open multi-line construct.
}: UseLocationCatalogParams) {
  // Local constant binding.
  const label = labelFor(locale);

  // Assign value for subsequent use.
  const [hierarchy, setHierarchy] = useState<LocationHierarchyBuilding[]>([]);
  // Assign value for subsequent use.
  const [hierarchyLoading, setHierarchyLoading] = useState(true);
  // Assign value for subsequent use.
  const [error, setError] = useState<string | null>(null);
  // Assign value for subsequent use.
  const [formError, setFormError] = useState<string | null>(null);
  // Assign value for subsequent use.
  const [message, setMessage] = useState<string | null>(null);
  // Assign value for subsequent use.
  const { busy, busyRef, runMutationWithRefresh } = useBusyMutation();
  // Assign value for subsequent use.
  const [kindFilter, setKindFilter] = useState<"all" | LocationKind>("all");
  // Assign value for subsequent use.
  const [showArchived, setShowArchived] = useState(true);

  // Local constant binding.
  const catalogKind = kindFilter === "all" ? undefined : kindFilter;
  // Local constant binding.
  const picker = useLocationCatalogPicker({
    // Field/property in this shape.
    kind: catalogKind,
    // Field/property in this shape.
    includeArchived: showArchived,
  });

  // Local constant binding.
  const loading = picker.loading || hierarchyLoading;
  // Local constant binding.
  const locations = picker.items;

  // Assign value for subsequent use.
  const [mode, setMode] = useState<"closed" | "create" | "edit">("closed");
  // Assign value for subsequent use.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Assign value for subsequent use.
  const [createKind, setCreateKind] = useState<LocationKind>("room");
  // Assign value for subsequent use.
  const [buildingId, setBuildingId] = useState("");
  // Assign value for subsequent use.
  const [floorId, setFloorId] = useState("");
  // Assign value for subsequent use.
  const [number, setNumber] = useState("");
  // Assign value for subsequent use.
  const [kind, setKind] = useState<LocationKind>("room");
  // Assign value for subsequent use.
  const [baseline, setBaseline] = useState("");

  // Local constant binding.
  const floorsForBuilding = useMemo(() => {
    // Return computed result to caller.
    return hierarchy.find((b) => b.id === buildingId)?.floors ?? [];
  // Close multi-line construct with trailing syntax.
  }, [hierarchy, buildingId]);

  // Local constant binding.
  const loadHierarchy = useCallback(async (signal?: AbortSignal) => {
    // Local constant binding.
    const hier = await fetchLocationHierarchy();
    // Conditional branch for this case.
    if (signal?.aborted) return hier;
    // Invoke helper or pass arguments.
    setHierarchy(hier);
    // Arrow function / callback body.
    setBuildingId((prev) => prev || hier[0]?.id || "");
    // Arrow function / callback body.
    setFloorId((prev) => prev || hier[0]?.floors[0]?.id || "");
    // Return computed result to caller.
    return hier;
  // Close multi-line construct with trailing syntax.
  }, []);

  // Arrow function / callback body.
  useEffect(() => {
    // Local constant binding.
    const ac = new AbortController();
    // Arrow function / callback body.
    (async () => {
      // Guard fallible work.
      try {
        // Invoke helper or pass arguments.
        setHierarchyLoading(true);
        // Await async work before continuing.
        await loadHierarchy(ac.signal);
      // Invoke helper or pass arguments.
      } catch (err) {
        // Conditional branch for this case.
        if (ac.signal.aborted) return;
        // Invoke helper or pass arguments.
        setError(err instanceof Error ? err.message : "Load failed");
      // Open multi-line construct.
      } finally {
        // Conditional branch for this case.
        if (!ac.signal.aborted) setHierarchyLoading(false);
      }
    // Invoke helper or pass arguments.
    })();
    // Return computed result to caller.
    return () => ac.abort();
  // Open multi-line construct.
  }, [
    // List item in import/export/params.
    loadHierarchy,
    // Continue multi-line list/arguments.
    picker.debouncedQ,
    // Continue multi-line list/arguments.
    picker.page,
    // Continue multi-line list/arguments.
    picker.pageSize,
    // List item in import/export/params.
    catalogKind,
    // List item in import/export/params.
    showArchived,
  ]);

  // Local constant binding.
  const refresh = useCallback(
    // Arrow function / callback body.
    async (signal?: AbortSignal) => {
      // Await async work before continuing.
      await Promise.all([loadHierarchy(signal), picker.reload(signal)]);
    },
    // Continue multi-line list/arguments.
    [loadHierarchy, picker.reload],
  );

  // Local constant binding.
  const dirty =
    // Assign value for subsequent use.
    mode !== "closed" &&
    // Assign value for subsequent use.
    JSON.stringify({ buildingId, floorId, number, kind }) !== baseline;

  // Function definition.
  function closeForm(options?: { force?: boolean }) {
    // Conditional branch for this case.
    if (!options?.force && busyRef.current) return;
    // Invoke helper or pass arguments.
    setMode("closed");
    // Invoke helper or pass arguments.
    setEditingId(null);
    // Invoke helper or pass arguments.
    setNumber("");
    // Invoke helper or pass arguments.
    setFormError(null);
  }

  // Function definition.
  function startCreate(preferredKind: LocationKind) {
    // Conditional branch for this case.
    if (busyRef.current) return;
    // Local constant binding.
    const building = hierarchy[0];
    // Local constant binding.
    const floor = building?.floors[0];
    // Invoke helper or pass arguments.
    setMode("create");
    // Invoke helper or pass arguments.
    setEditingId(null);
    // Invoke helper or pass arguments.
    setCreateKind(preferredKind);
    // Invoke helper or pass arguments.
    setKind(preferredKind);
    // Invoke helper or pass arguments.
    setNumber("");
    // Invoke helper or pass arguments.
    setBuildingId(building?.id ?? "");
    // Invoke helper or pass arguments.
    setFloorId(floor?.id ?? "");
    // Invoke helper or pass arguments.
    setFormError(null);
    // Invoke helper or pass arguments.
    setMessage(null);
    // Open multi-line construct.
    setBaseline(
      // Open multi-line construct.
      JSON.stringify({
        // Field/property in this shape.
        buildingId: building?.id ?? "",
        // Field/property in this shape.
        floorId: floor?.id ?? "",
        // Field/property in this shape.
        number: "",
        // Field/property in this shape.
        kind: preferredKind,
      }),
    );
  }

  // Function definition.
  function startEdit(loc: Room) {
    // Conditional branch for this case.
    if (busyRef.current) return;
    // Invoke helper or pass arguments.
    setMode("edit");
    // Invoke helper or pass arguments.
    setEditingId(loc.id);
    // Invoke helper or pass arguments.
    setNumber(loc.number);
    // Assign value for subsequent use.
    setKind(loc.kind === "common_area" ? "common_area" : "room");
    // Local constant binding.
    const building = hierarchy.find((b) =>
      // Arrow function / callback body.
      b.floors.some((f) => f.id === loc.floorId),
    );
    // Local constant binding.
    const nextBuilding = building?.id ?? buildingId;
    // Local constant binding.
    const nextFloor = loc.floorId ?? building?.floors[0]?.id ?? "";
    // Invoke helper or pass arguments.
    setBuildingId(nextBuilding);
    // Invoke helper or pass arguments.
    setFloorId(nextFloor);
    // Invoke helper or pass arguments.
    setFormError(null);
    // Invoke helper or pass arguments.
    setMessage(null);
    // Open multi-line construct.
    setBaseline(
      // Open multi-line construct.
      JSON.stringify({
        // Field/property in this shape.
        buildingId: nextBuilding,
        // Field/property in this shape.
        floorId: nextFloor,
        // Field/property in this shape.
        number: loc.number,
        // Field/property in this shape.
        kind: loc.kind === "common_area" ? "common_area" : "room",
      }),
    );
  }

  // Function definition.
  async function runMutation(action: () => Promise<unknown>, close = false) {
    // Invoke helper or pass arguments.
    setFormError(null);
    // Invoke helper or pass arguments.
    setError(null);
    // Invoke helper or pass arguments.
    setMessage(null);
    // Local constant binding.
    const result = await runMutationWithRefresh(async () => {
      // Await async work before continuing.
      await action();
      // Conditional branch for this case.
      if (close) closeForm({ force: true });
    // Close multi-line construct with trailing syntax.
    }, refresh);
    // Conditional branch for this case.
    if (!result.ok) {
      // Conditional branch for this case.
      if (result.error === "busy") return;
      // Conditional branch for this case.
      if (mode !== "closed") setFormError(result.error);
      // Fallback branch when prior checks fail.
      else setError(result.error);
      // Return computed result to caller.
      return;
    }
    // Conditional branch for this case.
    if (result.outcome === "saved") {
      // Invoke helper or pass arguments.
      setMessage(label("Запазено", "Saved"));
      // Invoke helper or pass arguments.
      onCatalogChanged?.();
      // Return computed result to caller.
      return;
    }
    // Local constant binding.
    const refreshPrefix = label(
      // Continue multi-line list/arguments.
      "Записът е успешен, но обновяването се провали",
      // Continue multi-line list/arguments.
      "Saved, but refresh failed",
    );
    // Open multi-line construct.
    setError(
      // Continue module logic.
      result.refreshError
        // Continue module logic.
        ? `${refreshPrefix}: ${result.refreshError}`
        // Continue multi-line list/arguments.
        : refreshPrefix,
    );
    // Invoke helper or pass arguments.
    onCatalogChanged?.();
  }

  // Function definition.
  async function onSubmit(e: FormEvent) {
    // Invoke helper or pass arguments.
    e.preventDefault();
    // Local constant binding.
    const resolvedFloor =
      // Continue module logic.
      floorId ||
      // Continue module logic.
      floorsForBuilding[0]?.id ||
      // Continue module logic.
      hierarchy[0]?.floors[0]?.id ||
      // Continue module logic.
      "";
    // Conditional branch for this case.
    if (!resolvedFloor || !number.trim()) {
      // Open multi-line construct.
      setFormError(
        // Open multi-line construct.
        label(
          // Continue multi-line list/arguments.
          "Изберете етаж и въведете номер.",
          // Continue multi-line list/arguments.
          "Select a floor and enter a number.",
        ),
      );
      // Return computed result to caller.
      return;
    }
    // Conditional branch for this case.
    if (!floorId) setFloorId(resolvedFloor);
    // Await async work before continuing.
    await runMutation(async () => {
      // Conditional branch for this case.
      if (editingId) {
        // Await async work before continuing.
        await updateLocation(editingId, {
          // Field/property in this shape.
          floorId: resolvedFloor,
          // Field/property in this shape.
          number: number.trim(),
          // List item in import/export/params.
          kind,
        });
      // Open multi-line construct.
      } else {
        // Await async work before continuing.
        await createLocation({
          // Field/property in this shape.
          floorId: resolvedFloor,
          // Field/property in this shape.
          number: number.trim(),
          // List item in import/export/params.
          kind,
        });
      }
    // Close multi-line construct with trailing syntax.
    }, true);
  }

  // Local constant binding.
  const title =
    // Assign value for subsequent use.
    mode === "edit"
      // Invoke helper or pass arguments.
      ? label("Редакция на помещение", "Edit location")
      // Assign value for subsequent use.
      : createKind === "common_area"
        // Invoke helper or pass arguments.
        ? label("Добавяне на обща част", "Add common area")
        // Invoke helper or pass arguments.
        : label("Добавяне на стая", "Add room");

  // Function definition.
  async function retryLoad() {
    // Invoke helper or pass arguments.
    setError(null);
    // Invoke helper or pass arguments.
    picker.setError(null);
    // Guard fallible work.
    try {
      // Await async work before continuing.
      await refresh();
    // Invoke helper or pass arguments.
    } catch (err) {
      // Invoke helper or pass arguments.
      setError(err instanceof Error ? err.message : "Load failed");
    }
  }

  // Return computed result to caller.
  return {
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
    // Field/property in this shape.
    search: picker.search,
    // Field/property in this shape.
    setSearch: picker.setSearch,
    // Field/property in this shape.
    page: picker.page,
    // Field/property in this shape.
    setPage: picker.setPage,
    // Field/property in this shape.
    pageSize: picker.pageSize,
    // Field/property in this shape.
    setPageSize: picker.setPageSize,
    // Field/property in this shape.
    total: picker.total,
    // Field/property in this shape.
    totalPages: picker.totalPages,
    // Field/property in this shape.
    pageSizes: picker.pageSizes,
    // List item in import/export/params.
    mode,
    // List item in import/export/params.
    editingId,
    // List item in import/export/params.
    createKind,
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
    // List item in import/export/params.
    refresh,
  };
}
