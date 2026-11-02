import {
  FormEvent,
  MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createSector,
  updateSector,
  type Room,
  type SectorRow,
} from "../../api/client";
import type { BusyMutationResult } from "../../hooks/useBusyMutation";
import {
  HOUSEKEEPING_CATALOG_CHANGED,
  isCatalogChangedEvent,
  shouldApplySectorSaveResult,
} from "../housekeepingLogic";

export type SectorFormMode = "closed" | "create" | "edit";

type LocationMeta = Room | SectorRow["locations"][number];

type RunMutationWithRefresh = <T>(
  mutate: () => Promise<T>,
  refresh?: () => Promise<void>,
) => Promise<BusyMutationResult<T>>;

export type UseSectorEditorOptions = {
  canManageSectors: boolean;
  canCreateSectors: boolean;
  lockedSupervisorId: string | null;
  refreshSectors: () => Promise<void>;
  setSectorsError: (err: string | null) => void;
  setMessage: (msg: string | null) => void;
  label: (bg: string, en: string) => string;
  busyRef: MutableRefObject<boolean>;
  runMutationWithRefresh: RunMutationWithRefresh;
};

export function useSectorEditor(options: UseSectorEditorOptions) {
  const {
    canManageSectors,
    canCreateSectors,
    lockedSupervisorId,
    refreshSectors,
    setSectorsError,
    setMessage,
    label,
    busyRef,
    runMutationWithRefresh,
  } = options;

  const savingSectorIdRef = useRef<string | null>(null);
  /** Live edit target — updated on open/close so post-await identity checks are meaningful. */
  const editingTargetRef = useRef<string | null>(null);

  const [sectorMode, setSectorMode] = useState<SectorFormMode>("closed");
  const [editingSector, setEditingSector] = useState<SectorRow | null>(null);
  const [sectorCode, setSectorCode] = useState("");
  const [sectorNameBg, setSectorNameBg] = useState("");
  const [sectorNameEn, setSectorNameEn] = useState("");
  const [sectorSupervisorId, setSectorSupervisorId] = useState("");
  const [sectorActive, setSectorActive] = useState(true);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [selectedLocationMeta, setSelectedLocationMeta] = useState<
    Map<string, LocationMeta>
  >(new Map());
  const [baselineSnapshot, setBaselineSnapshot] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (lockedSupervisorId) {
      setSectorSupervisorId(lockedSupervisorId);
    }
  }, [lockedSupervisorId]);

  useEffect(() => {
    function onCatalogChanged(event: Event) {
      if (!isCatalogChangedEvent(event)) return;
      void refreshSectors().catch((err) => {
        setSectorsError(
          err instanceof Error
            ? `${label(
                "Каталогът е обновен, но секторите не се презаредиха",
                "Catalog updated, but sectors refresh failed",
              )}: ${err.message}`
            : label(
                "Каталогът е обновен, но секторите не се презаредиха",
                "Catalog updated, but sectors refresh failed",
              ),
        );
      });
    }
    window.addEventListener(HOUSEKEEPING_CATALOG_CHANGED, onCatalogChanged);
    return () =>
      window.removeEventListener(HOUSEKEEPING_CATALOG_CHANGED, onCatalogChanged);
  }, [refreshSectors, setSectorsError, label]);

  const currentSnapshot = useMemo(
    () =>
      JSON.stringify({
        sectorCode,
        sectorNameBg,
        sectorNameEn,
        sectorSupervisorId,
        sectorActive,
        selectedLocationIds: [...selectedLocationIds].sort(),
      }),
    [
      sectorCode,
      sectorNameBg,
      sectorNameEn,
      sectorSupervisorId,
      sectorActive,
      selectedLocationIds,
    ],
  );
  const dirty =
    sectorMode !== "closed" && currentSnapshot !== baselineSnapshot;

  const closeSectorForm = useCallback(
    (opts?: { force?: boolean }) => {
      if (!opts?.force && busyRef.current) return;
      setSectorMode("closed");
      setEditingSector(null);
      editingTargetRef.current = null;
      setSectorCode("");
      setSectorNameBg("");
      setSectorNameEn("");
      setSectorSupervisorId(lockedSupervisorId ?? "");
      setSectorActive(true);
      setSelectedLocationIds([]);
      setSelectedLocationMeta(new Map());
      setFormError(null);
      setBaselineSnapshot("");
    },
    [busyRef, lockedSupervisorId],
  );

  const startCreateSector = useCallback(() => {
    if (!canCreateSectors || busyRef.current) return;
    setSectorMode("create");
    setEditingSector(null);
    editingTargetRef.current = "__create__";
    setSectorCode("");
    setSectorNameBg("");
    setSectorNameEn("");
    setSectorSupervisorId(lockedSupervisorId ?? "");
    setSectorActive(true);
    setSelectedLocationIds([]);
    setSelectedLocationMeta(new Map());
    setMessage(null);
    setFormError(null);
    setBaselineSnapshot(
      JSON.stringify({
        sectorCode: "",
        sectorNameBg: "",
        sectorNameEn: "",
        sectorSupervisorId: lockedSupervisorId ?? "",
        sectorActive: true,
        selectedLocationIds: [],
      }),
    );
  }, [canCreateSectors, busyRef, lockedSupervisorId, setMessage]);

  const startEditSector = useCallback(
    (sector: SectorRow) => {
      if (busyRef.current) return;
      setSectorMode("edit");
      setEditingSector(sector);
      editingTargetRef.current = sector.id;
      setSectorCode(sector.code);
      setSectorNameBg(sector.nameBg);
      setSectorNameEn(sector.nameEn);
      setSectorSupervisorId(
        lockedSupervisorId ?? sector.primarySupervisor?.id ?? "",
      );
      setSectorActive(sector.isActive);
      setSelectedLocationIds([...sector.locationIds]);
      const meta = new Map<string, LocationMeta>();
      for (const loc of sector.locations) {
        meta.set(loc.id, loc);
      }
      setSelectedLocationMeta(meta);
      setMessage(null);
      setFormError(null);
      setBaselineSnapshot(
        JSON.stringify({
          sectorCode: sector.code,
          sectorNameBg: sector.nameBg,
          sectorNameEn: sector.nameEn,
          sectorSupervisorId:
            lockedSupervisorId ?? sector.primarySupervisor?.id ?? "",
          sectorActive: sector.isActive,
          selectedLocationIds: [...sector.locationIds].sort(),
        }),
      );
    },
    [busyRef, lockedSupervisorId, setMessage],
  );

  const toggleLocation = useCallback((id: string, meta?: Room) => {
    setSelectedLocationIds((prev) => {
      if (prev.includes(id)) {
        setSelectedLocationMeta((m) => {
          const next = new Map(m);
          next.delete(id);
          return next;
        });
        return prev.filter((x) => x !== id);
      }
      if (meta) {
        setSelectedLocationMeta((m) => new Map(m).set(id, meta));
      }
      return [...prev, id];
    });
  }, []);

  const onSaveSector = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canManageSectors || busyRef.current) return;
      setFormError(null);
      setMessage(null);
      const supervisorId = lockedSupervisorId ?? (sectorSupervisorId || null);
      const savingToken = editingTargetRef.current ?? "__create__";
      const wasCreate = savingToken === "__create__";
      savingSectorIdRef.current = savingToken;

      const result = await runMutationWithRefresh(async () => {
        if (!wasCreate && editingSector) {
          await updateSector(editingSector.id, {
            code: sectorCode,
            nameBg: sectorNameBg,
            nameEn: sectorNameEn,
            primarySupervisorEmployeeId: supervisorId,
            isActive: sectorActive,
            locationIds: selectedLocationIds,
            expectedVersion: editingSector.version,
          });
        } else {
          await createSector({
            code: sectorCode,
            nameBg: sectorNameBg,
            nameEn: sectorNameEn,
            primarySupervisorEmployeeId: supervisorId,
            locationIds: selectedLocationIds,
            isActive: sectorActive,
          });
        }
        const liveTarget = editingTargetRef.current;
        if (
          shouldApplySectorSaveResult({
            savingId: savingToken,
            targetId: liveTarget === "__create__" ? null : liveTarget,
          })
        ) {
          closeSectorForm({ force: true });
        }
      }, refreshSectors);

      if (!result.ok) {
        if (result.error !== "busy") {
          if (/version_conflict|was updated by another/i.test(result.error)) {
            setFormError(
              label(
                "Секторът е променен от друг потребител. Презаредете и опитайте отново.",
                "Sector was changed by another user. Reload and try again.",
              ),
            );
          } else {
            setFormError(result.error);
          }
        }
      } else {
        if (result.outcome === "saved_refresh_failed") {
          const detail = result.refreshError
            ? `: ${result.refreshError}`
            : "";
          setSectorsError(
            `${label(
              "Записът е успешен, но обновяването на списъка се провали",
              "Saved, but list refresh failed",
            )}${detail}`,
          );
        }
        if (
          result.outcome === "saved" ||
          result.outcome === "saved_refresh_failed"
        ) {
          setMessage(
            wasCreate
              ? label("Секторът е създаден", "Sector created")
              : label("Секторът е записан", "Sector saved"),
          );
        }
      }
      if (savingSectorIdRef.current === savingToken) {
        savingSectorIdRef.current = null;
      }
    },
    [
      canManageSectors,
      busyRef,
      runMutationWithRefresh,
      lockedSupervisorId,
      sectorSupervisorId,
      editingSector,
      sectorCode,
      sectorNameBg,
      sectorNameEn,
      sectorActive,
      selectedLocationIds,
      closeSectorForm,
      refreshSectors,
      setSectorsError,
      label,
      setMessage,
    ],
  );

  return {
    formError,
    sectorMode,
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
  };
}
