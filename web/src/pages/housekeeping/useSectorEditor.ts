// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  FormEvent,
  // Support the surrounding logic for this step.
  MutableRefObject,
  // Support the surrounding logic for this step.
  useCallback,
  // Support the surrounding logic for this step.
  useEffect,
  // Support the surrounding logic for this step.
  useMemo,
  // Support the surrounding logic for this step.
  useRef,
  // Support the surrounding logic for this step.
  useState,
// Support the surrounding logic for this step.
} from "react";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  createSector,
  // Support the surrounding logic for this step.
  updateSector,
  // Declare type alias Room.
  type Room,
  // Declare type alias SectorRow.
  type SectorRow,
// Support the surrounding logic for this step.
} from "../../api/client";
// Import type-only dependency for typing without runtime cost.
import type { BusyMutationResult } from "../../hooks/useBusyMutation";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  HOUSEKEEPING_CATALOG_CHANGED,
  // Support the surrounding logic for this step.
  isCatalogChangedEvent,
  // Support the surrounding logic for this step.
  shouldApplySectorSaveResult,
// Support the surrounding logic for this step.
} from "../housekeepingLogic";

// Export type definition for consumers of this module.
export type SectorFormMode = "closed" | "create" | "edit";

// Declare type alias LocationMeta.
type LocationMeta = Room | SectorRow["locations"][number];

// Declare type alias RunMutationWithRefresh.
type RunMutationWithRefresh = <T>(
  // Provide mutate field used by this structure.
  mutate: () => Promise<T>,
  // Support the surrounding logic for this step.
  refresh?: () => Promise<void>,
// Support the surrounding logic for this step.
) => Promise<BusyMutationResult<T>>;

// Export type definition for consumers of this module.
export type UseSectorEditorOptions = {
  // Provide canManageSectors field used by this structure.
  canManageSectors: boolean;
  // Provide canCreateSectors field used by this structure.
  canCreateSectors: boolean;
  // Provide lockedSupervisorId field used by this structure.
  lockedSupervisorId: string | null;
  // Provide refreshSectors field used by this structure.
  refreshSectors: () => Promise<void>;
  // Provide setSectorsError field used by this structure.
  setSectorsError: (err: string | null) => void;
  // Provide setMessage field used by this structure.
  setMessage: (msg: string | null) => void;
  // Provide label field used by this structure.
  label: (bg: string, en: string) => string;
  // Provide busyRef field used by this structure.
  busyRef: MutableRefObject<boolean>;
  // Provide runMutationWithRefresh field used by this structure.
  runMutationWithRefresh: RunMutationWithRefresh;
};

// Export function useSectorEditor as part of this module's API.
export function useSectorEditor(options: UseSectorEditorOptions) {
  // Bind a local value for the following logic.
  const {
    // Support the surrounding logic for this step.
    canManageSectors,
    // Support the surrounding logic for this step.
    canCreateSectors,
    // Support the surrounding logic for this step.
    lockedSupervisorId,
    // Support the surrounding logic for this step.
    refreshSectors,
    // Support the surrounding logic for this step.
    setSectorsError,
    // Support the surrounding logic for this step.
    setMessage,
    // Support the surrounding logic for this step.
    label,
    // Support the surrounding logic for this step.
    busyRef,
    // Support the surrounding logic for this step.
    runMutationWithRefresh,
  // Support the surrounding logic for this step.
  } = options;

  // Bind savingSectorIdRef for use in the following logic.
  const savingSectorIdRef = useRef<string | null>(null);
  /** Live edit target — updated on open/close so post-await identity checks are meaningful. */
  const editingTargetRef = useRef<string | null>(null);

  // React state slot for local UI/data that can change over time.
  const [sectorMode, setSectorMode] = useState<SectorFormMode>("closed");
  // React state slot for local UI/data that can change over time.
  const [editingSector, setEditingSector] = useState<SectorRow | null>(null);
  // React state slot for local UI/data that can change over time.
  const [sectorCode, setSectorCode] = useState("");
  // React state slot for local UI/data that can change over time.
  const [sectorNameBg, setSectorNameBg] = useState("");
  // React state slot for local UI/data that can change over time.
  const [sectorNameEn, setSectorNameEn] = useState("");
  // React state slot for local UI/data that can change over time.
  const [sectorSupervisorId, setSectorSupervisorId] = useState("");
  // React state slot for local UI/data that can change over time.
  const [sectorActive, setSectorActive] = useState(true);
  // React state slot for local UI/data that can change over time.
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  // React state slot for local UI/data that can change over time.
  const [selectedLocationMeta, setSelectedLocationMeta] = useState<
    // Support the surrounding logic for this step.
    Map<string, LocationMeta>
  // Support the surrounding logic for this step.
  >(new Map());
  // React state slot for local UI/data that can change over time.
  const [baselineSnapshot, setBaselineSnapshot] = useState("");
  // React state slot for local UI/data that can change over time.
  const [formError, setFormError] = useState<string | null>(null);

  // Run side effects after render when dependencies change.
  useEffect(() => {
    // Conditional branch for the case described by this guard.
    if (lockedSupervisorId) {
      // Update React state so the UI reflects the new value.
      setSectorSupervisorId(lockedSupervisorId);
    }
  // Support the surrounding logic for this step.
  }, [lockedSupervisorId]);

  // Run side effects after render when dependencies change.
  useEffect(() => {
    // Define function onCatalogChanged and its behavior.
    function onCatalogChanged(event: Event) {
      // Conditional branch for the case described by this guard.
      if (!isCatalogChangedEvent(event)) return;
      // Fire-and-forget async work without awaiting in this path.
      void refreshSectors().catch((err) => {
        // Update React state so the UI reflects the new value.
        setSectorsError(
          // Support the surrounding logic for this step.
          err instanceof Error
            // Support the surrounding logic for this step.
            ? `${label(
                // Support the surrounding logic for this step.
                "Каталогът е обновен, но секторите не се презаредиха",
                // Support the surrounding logic for this step.
                "Catalog updated, but sectors refresh failed",
              // Support the surrounding logic for this step.
              )}: ${err.message}`
            // Support the surrounding logic for this step.
            : label(
                // Support the surrounding logic for this step.
                "Каталогът е обновен, но секторите не се презаредиха",
                // Support the surrounding logic for this step.
                "Catalog updated, but sectors refresh failed",
              ),
        );
      });
    }
    // Invoke window.addEventListener to perform this step.
    window.addEventListener(HOUSEKEEPING_CATALOG_CHANGED, onCatalogChanged);
    // Return early result or rendered output from this path.
    return () =>
      // Invoke window.removeEventListener to perform this step.
      window.removeEventListener(HOUSEKEEPING_CATALOG_CHANGED, onCatalogChanged);
  // Support the surrounding logic for this step.
  }, [refreshSectors, setSectorsError, label]);

  // Memoize derived value to avoid recomputing every render.
  const currentSnapshot = useMemo(
    // Support the surrounding logic for this step.
    () =>
      // Invoke JSON.stringify to perform this step.
      JSON.stringify({
        // Support the surrounding logic for this step.
        sectorCode,
        // Support the surrounding logic for this step.
        sectorNameBg,
        // Support the surrounding logic for this step.
        sectorNameEn,
        // Support the surrounding logic for this step.
        sectorSupervisorId,
        // Support the surrounding logic for this step.
        sectorActive,
        // Provide selectedLocationIds field used by this structure.
        selectedLocationIds: [...selectedLocationIds].sort(),
      }),
    [
      // Support the surrounding logic for this step.
      sectorCode,
      // Support the surrounding logic for this step.
      sectorNameBg,
      // Support the surrounding logic for this step.
      sectorNameEn,
      // Support the surrounding logic for this step.
      sectorSupervisorId,
      // Support the surrounding logic for this step.
      sectorActive,
      // Support the surrounding logic for this step.
      selectedLocationIds,
    ],
  );
  // Bind dirty for use in the following logic.
  const dirty =
    // Support the surrounding logic for this step.
    sectorMode !== "closed" && currentSnapshot !== baselineSnapshot;

  // Memoize callback identity for stable child/effect deps.
  const closeSectorForm = useCallback(
    // Support the surrounding logic for this step.
    (opts?: { force?: boolean }) => {
      // Conditional branch for the case described by this guard.
      if (!opts?.force && busyRef.current) return;
      // Update React state so the UI reflects the new value.
      setSectorMode("closed");
      // Update React state so the UI reflects the new value.
      setEditingSector(null);
      // Support the surrounding logic for this step.
      editingTargetRef.current = null;
      // Update React state so the UI reflects the new value.
      setSectorCode("");
      // Update React state so the UI reflects the new value.
      setSectorNameBg("");
      // Update React state so the UI reflects the new value.
      setSectorNameEn("");
      // Update React state so the UI reflects the new value.
      setSectorSupervisorId(lockedSupervisorId ?? "");
      // Update React state so the UI reflects the new value.
      setSectorActive(true);
      // Update React state so the UI reflects the new value.
      setSelectedLocationIds([]);
      // Update React state so the UI reflects the new value.
      setSelectedLocationMeta(new Map());
      // Update React state so the UI reflects the new value.
      setFormError(null);
      // Update React state so the UI reflects the new value.
      setBaselineSnapshot("");
    },
    // Support the surrounding logic for this step.
    [busyRef, lockedSupervisorId],
  );

  // Memoize callback identity for stable child/effect deps.
  const startCreateSector = useCallback(() => {
    // Conditional branch for the case described by this guard.
    if (!canCreateSectors || busyRef.current) return;
    // Update React state so the UI reflects the new value.
    setSectorMode("create");
    // Update React state so the UI reflects the new value.
    setEditingSector(null);
    // Pass editingTargetRef.current prop/value into the element or config.
    editingTargetRef.current = "__create__";
    // Update React state so the UI reflects the new value.
    setSectorCode("");
    // Update React state so the UI reflects the new value.
    setSectorNameBg("");
    // Update React state so the UI reflects the new value.
    setSectorNameEn("");
    // Update React state so the UI reflects the new value.
    setSectorSupervisorId(lockedSupervisorId ?? "");
    // Update React state so the UI reflects the new value.
    setSectorActive(true);
    // Update React state so the UI reflects the new value.
    setSelectedLocationIds([]);
    // Update React state so the UI reflects the new value.
    setSelectedLocationMeta(new Map());
    // Update React state so the UI reflects the new value.
    setMessage(null);
    // Update React state so the UI reflects the new value.
    setFormError(null);
    // Update React state so the UI reflects the new value.
    setBaselineSnapshot(
      // Invoke JSON.stringify to perform this step.
      JSON.stringify({
        // Provide sectorCode field used by this structure.
        sectorCode: "",
        // Provide sectorNameBg field used by this structure.
        sectorNameBg: "",
        // Provide sectorNameEn field used by this structure.
        sectorNameEn: "",
        // Provide sectorSupervisorId field used by this structure.
        sectorSupervisorId: lockedSupervisorId ?? "",
        // Provide sectorActive field used by this structure.
        sectorActive: true,
        // Provide selectedLocationIds field used by this structure.
        selectedLocationIds: [],
      }),
    );
  // Support the surrounding logic for this step.
  }, [canCreateSectors, busyRef, lockedSupervisorId, setMessage]);

  // Memoize callback identity for stable child/effect deps.
  const startEditSector = useCallback(
    // Support the surrounding logic for this step.
    (sector: SectorRow) => {
      // Conditional branch for the case described by this guard.
      if (busyRef.current) return;
      // Update React state so the UI reflects the new value.
      setSectorMode("edit");
      // Update React state so the UI reflects the new value.
      setEditingSector(sector);
      // Support the surrounding logic for this step.
      editingTargetRef.current = sector.id;
      // Update React state so the UI reflects the new value.
      setSectorCode(sector.code);
      // Update React state so the UI reflects the new value.
      setSectorNameBg(sector.nameBg);
      // Update React state so the UI reflects the new value.
      setSectorNameEn(sector.nameEn);
      // Update React state so the UI reflects the new value.
      setSectorSupervisorId(
        // Support the surrounding logic for this step.
        lockedSupervisorId ?? sector.primarySupervisor?.id ?? "",
      );
      // Update React state so the UI reflects the new value.
      setSectorActive(sector.isActive);
      // Update React state so the UI reflects the new value.
      setSelectedLocationIds([...sector.locationIds]);
      // Create a Set/Map for efficient membership or keyed lookup.
      const meta = new Map<string, LocationMeta>();
      // Iterate a collection or counted range.
      for (const loc of sector.locations) {
        // Invoke meta.set to perform this step.
        meta.set(loc.id, loc);
      }
      // Update React state so the UI reflects the new value.
      setSelectedLocationMeta(meta);
      // Update React state so the UI reflects the new value.
      setMessage(null);
      // Update React state so the UI reflects the new value.
      setFormError(null);
      // Update React state so the UI reflects the new value.
      setBaselineSnapshot(
        // Invoke JSON.stringify to perform this step.
        JSON.stringify({
          // Provide sectorCode field used by this structure.
          sectorCode: sector.code,
          // Provide sectorNameBg field used by this structure.
          sectorNameBg: sector.nameBg,
          // Provide sectorNameEn field used by this structure.
          sectorNameEn: sector.nameEn,
          // Provide sectorSupervisorId field used by this structure.
          sectorSupervisorId:
            // Support the surrounding logic for this step.
            lockedSupervisorId ?? sector.primarySupervisor?.id ?? "",
          // Provide sectorActive field used by this structure.
          sectorActive: sector.isActive,
          // Provide selectedLocationIds field used by this structure.
          selectedLocationIds: [...sector.locationIds].sort(),
        }),
      );
    },
    // Support the surrounding logic for this step.
    [busyRef, lockedSupervisorId, setMessage],
  );

  // Memoize callback identity for stable child/effect deps.
  const toggleLocation = useCallback((id: string, meta?: Room) => {
    // Update React state so the UI reflects the new value.
    setSelectedLocationIds((prev) => {
      // Conditional branch for the case described by this guard.
      if (prev.includes(id)) {
        // Update React state so the UI reflects the new value.
        setSelectedLocationMeta((m) => {
          // Create a Set/Map for efficient membership or keyed lookup.
          const next = new Map(m);
          // Invoke next.delete to perform this step.
          next.delete(id);
          // Return early result or rendered output from this path.
          return next;
        });
        // Return early result or rendered output from this path.
        return prev.filter((x) => x !== id);
      }
      // Conditional branch for the case described by this guard.
      if (meta) {
        // Update React state so the UI reflects the new value.
        setSelectedLocationMeta((m) => new Map(m).set(id, meta));
      }
      // Return early result or rendered output from this path.
      return [...prev, id];
    });
  // Support the surrounding logic for this step.
  }, []);

  // Memoize callback identity for stable child/effect deps.
  const onSaveSector = useCallback(
    // Support the surrounding logic for this step.
    async (e: FormEvent) => {
      // Invoke e.preventDefault to perform this step.
      e.preventDefault();
      // Conditional branch for the case described by this guard.
      if (!canManageSectors || busyRef.current) return;
      // Update React state so the UI reflects the new value.
      setFormError(null);
      // Update React state so the UI reflects the new value.
      setMessage(null);
      // Bind supervisorId for use in the following logic.
      const supervisorId = lockedSupervisorId ?? (sectorSupervisorId || null);
      // Bind savingToken for use in the following logic.
      const savingToken = editingTargetRef.current ?? "__create__";
      // Bind wasCreate for use in the following logic.
      const wasCreate = savingToken === "__create__";
      // Support the surrounding logic for this step.
      savingSectorIdRef.current = savingToken;

      // Bind result for use in the following logic.
      const result = await runMutationWithRefresh(async () => {
        // Conditional branch for the case described by this guard.
        if (!wasCreate && editingSector) {
          // Wait for an async operation before continuing.
          await updateSector(editingSector.id, {
            // Provide code field used by this structure.
            code: sectorCode,
            // Provide nameBg field used by this structure.
            nameBg: sectorNameBg,
            // Provide nameEn field used by this structure.
            nameEn: sectorNameEn,
            // Provide primarySupervisorEmployeeId field used by this structure.
            primarySupervisorEmployeeId: supervisorId,
            // Provide isActive field used by this structure.
            isActive: sectorActive,
            // Provide locationIds field used by this structure.
            locationIds: selectedLocationIds,
            // Provide expectedVersion field used by this structure.
            expectedVersion: editingSector.version,
          });
        // Support the surrounding logic for this step.
        } else {
          // Wait for an async operation before continuing.
          await createSector({
            // Provide code field used by this structure.
            code: sectorCode,
            // Provide nameBg field used by this structure.
            nameBg: sectorNameBg,
            // Provide nameEn field used by this structure.
            nameEn: sectorNameEn,
            // Provide primarySupervisorEmployeeId field used by this structure.
            primarySupervisorEmployeeId: supervisorId,
            // Provide locationIds field used by this structure.
            locationIds: selectedLocationIds,
            // Provide isActive field used by this structure.
            isActive: sectorActive,
          });
        }
        // Bind liveTarget for use in the following logic.
        const liveTarget = editingTargetRef.current;
        // Conditional branch for the case described by this guard.
        if (
          // Invoke shouldApplySectorSaveResult to perform this step.
          shouldApplySectorSaveResult({
            // Provide savingId field used by this structure.
            savingId: savingToken,
            // Provide targetId field used by this structure.
            targetId: liveTarget === "__create__" ? null : liveTarget,
          })
        // Support the surrounding logic for this step.
        ) {
          // Invoke closeSectorForm to perform this step.
          closeSectorForm({ force: true });
        }
      // Support the surrounding logic for this step.
      }, refreshSectors);

      // Conditional branch for the case described by this guard.
      if (!result.ok) {
        // Conditional branch for the case described by this guard.
        if (result.error !== "busy") {
          // Conditional branch for the case described by this guard.
          if (/version_conflict|was updated by another/i.test(result.error)) {
            // Update React state so the UI reflects the new value.
            setFormError(
              // Invoke label to perform this step.
              label(
                // Support the surrounding logic for this step.
                "Секторът е променен от друг потребител. Презаредете и опитайте отново.",
                // Support the surrounding logic for this step.
                "Sector was changed by another user. Reload and try again.",
              ),
            );
          // Support the surrounding logic for this step.
          } else {
            // Update React state so the UI reflects the new value.
            setFormError(result.error);
          }
        }
      // Support the surrounding logic for this step.
      } else {
        // Conditional branch for the case described by this guard.
        if (result.outcome === "saved_refresh_failed") {
          // Bind detail for use in the following logic.
          const detail = result.refreshError
            // Support the surrounding logic for this step.
            ? `: ${result.refreshError}`
            // Support the surrounding logic for this step.
            : "";
          // Update React state so the UI reflects the new value.
          setSectorsError(
            // Support the surrounding logic for this step.
            `${label(
              // Support the surrounding logic for this step.
              "Записът е успешен, но обновяването на списъка се провали",
              // Support the surrounding logic for this step.
              "Saved, but list refresh failed",
            // Support the surrounding logic for this step.
            )}${detail}`,
          );
        }
        // Conditional branch for the case described by this guard.
        if (
          // Support the surrounding logic for this step.
          result.outcome === "saved" ||
          // Support the surrounding logic for this step.
          result.outcome === "saved_refresh_failed"
        // Support the surrounding logic for this step.
        ) {
          // Update React state so the UI reflects the new value.
          setMessage(
            // Support the surrounding logic for this step.
            wasCreate
              // Support the surrounding logic for this step.
              ? label("Секторът е създаден", "Sector created")
              // Support the surrounding logic for this step.
              : label("Секторът е записан", "Sector saved"),
          );
        }
      }
      // Conditional branch for the case described by this guard.
      if (savingSectorIdRef.current === savingToken) {
        // Support the surrounding logic for this step.
        savingSectorIdRef.current = null;
      }
    },
    [
      // Support the surrounding logic for this step.
      canManageSectors,
      // Support the surrounding logic for this step.
      busyRef,
      // Support the surrounding logic for this step.
      runMutationWithRefresh,
      // Support the surrounding logic for this step.
      lockedSupervisorId,
      // Support the surrounding logic for this step.
      sectorSupervisorId,
      // Support the surrounding logic for this step.
      editingSector,
      // Support the surrounding logic for this step.
      sectorCode,
      // Support the surrounding logic for this step.
      sectorNameBg,
      // Support the surrounding logic for this step.
      sectorNameEn,
      // Support the surrounding logic for this step.
      sectorActive,
      // Support the surrounding logic for this step.
      selectedLocationIds,
      // Support the surrounding logic for this step.
      closeSectorForm,
      // Support the surrounding logic for this step.
      refreshSectors,
      // Support the surrounding logic for this step.
      setSectorsError,
      // Support the surrounding logic for this step.
      label,
      // Support the surrounding logic for this step.
      setMessage,
    ],
  );

  // Return early result or rendered output from this path.
  return {
    // Support the surrounding logic for this step.
    formError,
    // Support the surrounding logic for this step.
    sectorMode,
    // Support the surrounding logic for this step.
    editingSector,
    // Support the surrounding logic for this step.
    sectorCode,
    // Support the surrounding logic for this step.
    sectorNameBg,
    // Support the surrounding logic for this step.
    sectorNameEn,
    // Support the surrounding logic for this step.
    sectorSupervisorId,
    // Support the surrounding logic for this step.
    sectorActive,
    // Support the surrounding logic for this step.
    selectedLocationIds,
    // Support the surrounding logic for this step.
    selectedLocationMeta,
    // Support the surrounding logic for this step.
    dirty,
    // Support the surrounding logic for this step.
    setSectorCode,
    // Support the surrounding logic for this step.
    setSectorNameBg,
    // Support the surrounding logic for this step.
    setSectorNameEn,
    // Support the surrounding logic for this step.
    setSectorSupervisorId,
    // Support the surrounding logic for this step.
    setSectorActive,
    // Support the surrounding logic for this step.
    toggleLocation,
    // Support the surrounding logic for this step.
    startCreateSector,
    // Support the surrounding logic for this step.
    startEditSector,
    // Support the surrounding logic for this step.
    closeSectorForm,
    // Support the surrounding logic for this step.
    onSaveSector,
  };
}
