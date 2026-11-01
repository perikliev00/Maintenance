/**
 * Housekeeping admin: location catalog, sectors, and shifts/roster.
 * Tabs/actions gated by rooms.manage / sectors.manage / shifts.manage.
 * Sector create is hotel-wide only; supervisors may edit owned sectors.
 * Saves use a single atomic PATCH (metadata + membership + version).
 */
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  canPerformAction,
  createSector,
  createShift,
  fetchPeople,
  fetchSectors,
  fetchShiftRoster,
  fetchShifts,
  saveShiftRoster,
  todayHotelDate,
  updateSector,
  updateShift,
  type AuthUser,
  type Person,
  type Room,
  type SectorRow,
  type ShiftRosterEntry,
  type ShiftRow,
} from "../api/client";
import { LocationCatalogPanel } from "../components/LocationCatalogPanel";
import { SectorPanel } from "../components/SectorPanel";
import { ShiftPanel } from "../components/ShiftPanel";
import {
  canCreateSector,
  catalogChangedEvent,
  classifySaveRefreshOutcome,
  HOUSEKEEPING_CATALOG_CHANGED,
  isCatalogChangedEvent,
  mergeIndependentLoadErrors,
  shouldApplySectorSaveResult,
} from "./housekeepingLogic";

type Props = { user: AuthUser };

type Tab = "catalog" | "sectors" | "shifts";
type SectorFormMode = "closed" | "create" | "edit";
type ShiftFormMode = "closed" | "create" | "edit";

const TABS: Array<{ id: Tab; bg: string; en: string }> = [
  { id: "catalog", bg: "Каталог", en: "Catalog" },
  { id: "sectors", bg: "Сектори", en: "Sectors" },
  { id: "shifts", bg: "Смени", en: "Shifts" },
];

type LocationMeta = Room | SectorRow["locations"][number];

export function HousekeepingPage({ user }: Props) {
  const [tab, setTab] = useState<Tab>("sectors");
  const [locale] = useState<"bg" | "en">("bg");
  const label = (bg: string, en: string) => (locale === "bg" ? bg : en);

  const canManageSectors = canPerformAction(user, "sectors.manage");
  const canManageShifts = canPerformAction(user, "shifts.manage");
  const canManageLocations = canPerformAction(user, "rooms.manage");
  const isSupervisorScope = user.role === "supervisor";
  /** Supervisors with manage may edit, but must not create sectors. */
  const canCreateSectors = canCreateSector(user.role, canManageSectors);
  const lockedSupervisorId = isSupervisorScope ? user.employeeId : null;

  const [sectors, setSectors] = useState<SectorRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [supervisors, setSupervisors] = useState<Person[]>([]);
  const [sectorsLoading, setSectorsLoading] = useState(true);
  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [sectorsError, setSectorsError] = useState<string | null>(null);
  const [shiftsError, setShiftsError] = useState<string | null>(null);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const savingSectorIdRef = useRef<string | null>(null);
  /** Live edit target — updated on open/close so post-await identity checks are meaningful. */
  const editingTargetRef = useRef<string | null>(null);

  function setBusyState(next: boolean) {
    busyRef.current = next;
    setBusy(next);
  }

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

  const [shiftMode, setShiftMode] = useState<ShiftFormMode>("closed");
  const [editingShift, setEditingShift] = useState<ShiftRow | null>(null);
  const [shiftCode, setShiftCode] = useState("");
  const [shiftNameBg, setShiftNameBg] = useState("");
  const [shiftNameEn, setShiftNameEn] = useState("");
  const [shiftStart, setShiftStart] = useState("06:00");
  const [shiftEnd, setShiftEnd] = useState("14:00");
  const [shiftSort, setShiftSort] = useState(0);
  const [shiftActive, setShiftActive] = useState(true);
  const [shiftFormError, setShiftFormError] = useState<string | null>(null);
  const [shiftBaseline, setShiftBaseline] = useState("");

  const [rosterDate, setRosterDate] = useState(todayHotelDate());
  const [rosterEntries, setRosterEntries] = useState<ShiftRosterEntry[]>([]);
  const [rosterDraft, setRosterDraft] = useState<Record<string, string>>({});
  const [housekeepers, setHousekeepers] = useState<Person[]>([]);

  const refreshSectors = useCallback(async () => {
    if (!canManageSectors) {
      setSectors([]);
      return;
    }
    const sec = await fetchSectors(true);
    setSectors(sec);
  }, [canManageSectors]);

  const refreshShifts = useCallback(async () => {
    if (!canManageShifts) {
      setShifts([]);
      return;
    }
    const sh = await fetchShifts(true);
    setShifts(sh);
  }, [canManageShifts]);

  const refreshPeople = useCallback(async () => {
    const people = await fetchPeople({ includeInactive: false });
    setSupervisors(
      people.filter(
        (p) =>
          p.role === "supervisor" ||
          p.role === "manager" ||
          p.role === "admin" ||
          p.role === "owner",
      ),
    );
    setHousekeepers(people.filter((p) => p.role === "housekeeper"));
  }, []);

  const refreshRoster = useCallback(
    async (date: string) => {
      if (!canManageShifts) return;
      const roster = await fetchShiftRoster(date);
      setRosterEntries(roster.entries);
      const draft: Record<string, string> = {};
      for (const e of roster.entries) {
        draft[e.employee.id] = e.shift.id;
      }
      setRosterDraft(draft);
    },
    [canManageShifts],
  );

  useEffect(() => {
    if (lockedSupervisorId) {
      setSectorSupervisorId(lockedSupervisorId);
    }
  }, [lockedSupervisorId]);

  // Independent initial loads — one failing resource must not blank the page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSectorsLoading(true);
      setSectorsError(null);
      try {
        await refreshSectors();
      } catch (err) {
        if (!cancelled) {
          setSectorsError(
            err instanceof Error ? err.message : "Failed to load sectors",
          );
        }
      } finally {
        if (!cancelled) setSectorsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSectors]);

  useEffect(() => {
    if (tab !== "shifts") return;
    let cancelled = false;
    (async () => {
      setShiftsLoading(true);
      setShiftsError(null);
      try {
        await refreshShifts();
      } catch (err) {
        if (!cancelled) {
          setShiftsError(
            err instanceof Error ? err.message : "Failed to load shifts",
          );
        }
      } finally {
        if (!cancelled) setShiftsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, refreshShifts]);

  useEffect(() => {
    if (tab !== "sectors" && tab !== "shifts") return;
    let cancelled = false;
    (async () => {
      setPeopleLoading(true);
      setPeopleError(null);
      try {
        await refreshPeople();
      } catch (err) {
        if (!cancelled) {
          setPeopleError(
            err instanceof Error ? err.message : "Failed to load people",
          );
        }
      } finally {
        if (!cancelled) setPeopleLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, refreshPeople]);

  useEffect(() => {
    if (tab !== "shifts" || !canManageShifts) return;
    void refreshRoster(rosterDate).catch((err) => {
      setShiftsError(
        err instanceof Error ? err.message : "Failed to load roster",
      );
    });
  }, [tab, rosterDate, canManageShifts, refreshRoster]);

  // Catalog mutations notify sectors tab to reload membership options (BUG-10).
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
  }, [refreshSectors]);

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

  function closeSectorForm(options?: { force?: boolean }) {
    // Block user close while busy; allow forced close after successful save.
    if (!options?.force && busyRef.current) return;
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
  }

  function startCreateSector() {
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
  }

  function startEditSector(sector: SectorRow) {
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
  }

  function toggleLocation(id: string, meta?: Room) {
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
  }

  async function onSaveSector(e: FormEvent) {
    e.preventDefault();
    if (!canManageSectors || busyRef.current) return;
    setBusyState(true);
    setFormError(null);
    setMessage(null);
    const supervisorId = lockedSupervisorId ?? (sectorSupervisorId || null);
    const savingToken = editingTargetRef.current ?? "__create__";
    const wasCreate = savingToken === "__create__";
    savingSectorIdRef.current = savingToken;
    let saveOk = false;
    let refreshOk = true;
    try {
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
      saveOk = true;
      // Apply only if the live edit target still matches this in-flight save (BUG-08).
      const liveTarget = editingTargetRef.current;
      if (
        shouldApplySectorSaveResult({
          savingId: savingToken,
          targetId: liveTarget === "__create__" ? null : liveTarget,
        })
      ) {
        closeSectorForm({ force: true });
      }
      try {
        await refreshSectors();
      } catch (refreshErr) {
        refreshOk = false;
        const detail =
          refreshErr instanceof Error ? `: ${refreshErr.message}` : "";
        setSectorsError(
          `${label(
            "Записът е успешен, но обновяването на списъка се провали",
            "Saved, but list refresh failed",
          )}${detail}`,
        );
      }
    } catch (err) {
      saveOk = false;
      refreshOk = true;
      const msg = err instanceof Error ? err.message : "Save failed";
      if (/version_conflict|was updated by another/i.test(msg)) {
        setFormError(
          label(
            "Секторът е променен от друг потребител. Презаредете и опитайте отново.",
            "Sector was changed by another user. Reload and try again.",
          ),
        );
      } else {
        setFormError(msg);
      }
    } finally {
      const outcome = classifySaveRefreshOutcome({ saveOk, refreshOk });
      if (outcome === "saved" || outcome === "saved_refresh_failed") {
        setMessage(
          wasCreate
            ? label("Секторът е създаден", "Sector created")
            : label("Секторът е записан", "Sector saved"),
        );
      }
      if (savingSectorIdRef.current === savingToken) {
        savingSectorIdRef.current = null;
      }
      setBusyState(false);
    }
  }

  const shiftSnapshot = useMemo(
    () =>
      JSON.stringify({
        shiftCode,
        shiftNameBg,
        shiftNameEn,
        shiftStart,
        shiftEnd,
        shiftSort,
        shiftActive,
      }),
    [
      shiftCode,
      shiftNameBg,
      shiftNameEn,
      shiftStart,
      shiftEnd,
      shiftSort,
      shiftActive,
    ],
  );
  const shiftDirty =
    shiftMode !== "closed" && shiftSnapshot !== shiftBaseline;

  function closeShiftForm(options?: { force?: boolean }) {
    if (!options?.force && busyRef.current) return;
    setShiftMode("closed");
    setEditingShift(null);
    setShiftCode("");
    setShiftNameBg("");
    setShiftNameEn("");
    setShiftStart("06:00");
    setShiftEnd("14:00");
    setShiftSort(0);
    setShiftActive(true);
    setShiftFormError(null);
    setShiftBaseline("");
  }

  function startCreateShift() {
    if (!canManageShifts || busyRef.current) return;
    setShiftMode("create");
    setEditingShift(null);
    setShiftCode("");
    setShiftNameBg("");
    setShiftNameEn("");
    setShiftStart("06:00");
    setShiftEnd("14:00");
    setShiftSort(0);
    setShiftActive(true);
    setMessage(null);
    setShiftFormError(null);
    setShiftBaseline(
      JSON.stringify({
        shiftCode: "",
        shiftNameBg: "",
        shiftNameEn: "",
        shiftStart: "06:00",
        shiftEnd: "14:00",
        shiftSort: 0,
        shiftActive: true,
      }),
    );
  }

  function startEditShift(shift: ShiftRow) {
    if (busyRef.current) return;
    setShiftMode("edit");
    setEditingShift(shift);
    setShiftCode(shift.code);
    setShiftNameBg(shift.nameBg);
    setShiftNameEn(shift.nameEn);
    setShiftStart(shift.startTime);
    setShiftEnd(shift.endTime);
    setShiftSort(shift.sortOrder);
    setShiftActive(shift.isActive);
    setMessage(null);
    setShiftFormError(null);
    setShiftBaseline(
      JSON.stringify({
        shiftCode: shift.code,
        shiftNameBg: shift.nameBg,
        shiftNameEn: shift.nameEn,
        shiftStart: shift.startTime,
        shiftEnd: shift.endTime,
        shiftSort: shift.sortOrder,
        shiftActive: shift.isActive,
      }),
    );
  }

  async function onSaveShift(e: FormEvent) {
    e.preventDefault();
    if (!canManageShifts || busyRef.current) return;
    setBusyState(true);
    setMessage(null);
    setShiftsError(null);
    setShiftFormError(null);
    const editing = Boolean(editingShift);
    let saveOk = false;
    let refreshOk = true;
    try {
      if (editingShift) {
        await updateShift(editingShift.id, {
          code: shiftCode,
          nameBg: shiftNameBg,
          nameEn: shiftNameEn,
          startTime: shiftStart,
          endTime: shiftEnd,
          sortOrder: shiftSort,
          isActive: shiftActive,
        });
      } else {
        await createShift({
          code: shiftCode,
          nameBg: shiftNameBg,
          nameEn: shiftNameEn,
          startTime: shiftStart,
          endTime: shiftEnd,
          sortOrder: shiftSort,
          isActive: shiftActive,
        });
      }
      saveOk = true;
      closeShiftForm({ force: true });
      try {
        await refreshShifts();
      } catch (refreshErr) {
        refreshOk = false;
        const detail =
          refreshErr instanceof Error ? `: ${refreshErr.message}` : "";
        setShiftsError(
          `${label(
            "Записът е успешен, но обновяването се провали",
            "Saved, but refresh failed",
          )}${detail}`,
        );
      }
    } catch (err) {
      saveOk = false;
      setShiftFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      const outcome = classifySaveRefreshOutcome({ saveOk, refreshOk });
      if (outcome === "saved" || outcome === "saved_refresh_failed") {
        setMessage(
          editing
            ? label("Смяната е обновена", "Shift updated")
            : label("Смяната е създадена", "Shift created"),
        );
      }
      setBusyState(false);
    }
  }

  const pageError =
    tab === "sectors"
      ? mergeIndependentLoadErrors({
          sectors: sectorsError,
          people: peopleError,
        })
      : tab === "shifts"
        ? mergeIndependentLoadErrors({
            shifts: shiftsError,
            people: peopleError,
          })
        : null;

  return (
    <main className="content">
      <header className="page-header">
        <div>
          <h1>{label("Почистване", "Housekeeping")}</h1>
          <p>
            {label(
              "Каталог помещения, сектори и смени за оперативното разпределение.",
              "Location catalog, sectors and shifts for operational assignment.",
            )}
          </p>
        </div>
      </header>

      <div className="settings-tabs" role="tablist">
        {TABS.filter((t) => t.id !== "catalog" || canManageLocations).map(
          (t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? "active" : ""}
              disabled={busy}
              onClick={() => {
                if (busyRef.current) return;
                setTab(t.id);
                setMessage(null);
              }}
            >
              {label(t.bg, t.en)}
            </button>
          ),
        )}
      </div>

      {pageError && (
        <p className="error-banner">
          {pageError}{" "}
          <button
            type="button"
            className="ghost"
            onClick={() => {
              if (tab === "sectors") {
                setSectorsError(null);
                setPeopleError(null);
                void refreshSectors().catch((err) =>
                  setSectorsError(
                    err instanceof Error ? err.message : "Failed to load",
                  ),
                );
                void refreshPeople().catch((err) =>
                  setPeopleError(
                    err instanceof Error ? err.message : "Failed to load",
                  ),
                );
              }
              if (tab === "shifts") {
                setShiftsError(null);
                setPeopleError(null);
                void refreshShifts().catch((err) =>
                  setShiftsError(
                    err instanceof Error ? err.message : "Failed to load",
                  ),
                );
                void refreshPeople().catch((err) =>
                  setPeopleError(
                    err instanceof Error ? err.message : "Failed to load",
                  ),
                );
              }
            }}
          >
            {label("Презареди", "Reload")}
          </button>
        </p>
      )}
      {message && <p className="ok-banner">{message}</p>}
      {peopleLoading && tab === "sectors" && (
        <p className="muted small">
          {label("Зареждане на служители…", "Loading people…")}
        </p>
      )}

      {tab === "catalog" && canManageLocations && (
        <LocationCatalogPanel
          locale={locale}
          onCatalogChanged={() => {
            window.dispatchEvent(catalogChangedEvent());
          }}
        />
      )}

      {tab === "sectors" && (
        <>
          {sectorsLoading ? (
            <p className="muted">{label("Зареждане…", "Loading…")}</p>
          ) : (
            <SectorPanel
              label={label}
              locale={locale}
              sectors={sectors}
              supervisors={supervisors}
              canManage={canManageSectors}
              canCreate={canCreateSectors}
              isSupervisorScope={isSupervisorScope}
              busy={busy}
              formError={formError}
              mode={sectorMode}
              editingSector={editingSector}
              sectorCode={sectorCode}
              sectorNameBg={sectorNameBg}
              sectorNameEn={sectorNameEn}
              sectorSupervisorId={sectorSupervisorId}
              sectorActive={sectorActive}
              selectedLocationIds={selectedLocationIds}
              selectedLocationMeta={selectedLocationMeta}
              onSectorCodeChange={setSectorCode}
              onSectorNameBgChange={setSectorNameBg}
              onSectorNameEnChange={setSectorNameEn}
              onSectorSupervisorIdChange={setSectorSupervisorId}
              onSectorActiveChange={setSectorActive}
              onToggleLocation={toggleLocation}
              onStartCreate={startCreateSector}
              onStartEdit={startEditSector}
              onCloseForm={closeSectorForm}
              onSave={onSaveSector}
              dirty={dirty}
            />
          )}
        </>
      )}

      {tab === "shifts" && (
        <>
          {shiftsLoading ? (
            <p className="muted">{label("Зареждане…", "Loading…")}</p>
          ) : (
            <ShiftPanel
              label={label}
              locale={locale}
              shifts={shifts}
              housekeepers={housekeepers}
              canManage={canManageShifts}
              busy={busy}
              formError={shiftFormError}
              mode={shiftMode}
              editingShift={editingShift}
              shiftCode={shiftCode}
              shiftNameBg={shiftNameBg}
              shiftNameEn={shiftNameEn}
              shiftStart={shiftStart}
              shiftEnd={shiftEnd}
              shiftSort={shiftSort}
              shiftActive={shiftActive}
              dirty={shiftDirty}
              rosterDate={rosterDate}
              rosterEntries={rosterEntries}
              rosterDraft={rosterDraft}
              onShiftCodeChange={setShiftCode}
              onShiftNameBgChange={setShiftNameBg}
              onShiftNameEnChange={setShiftNameEn}
              onShiftStartChange={setShiftStart}
              onShiftEndChange={setShiftEnd}
              onShiftSortChange={setShiftSort}
              onShiftActiveChange={setShiftActive}
              onRosterDateChange={setRosterDate}
              onRosterDraftChange={(employeeId, shiftId) =>
                setRosterDraft((prev) => ({ ...prev, [employeeId]: shiftId }))
              }
              onStartCreate={startCreateShift}
              onStartEdit={startEditShift}
              onCloseForm={closeShiftForm}
              onSave={onSaveShift}
              onSaveRoster={async () => {
                setBusyState(true);
                setShiftsError(null);
                setMessage(null);
                try {
                  const entries = Object.entries(rosterDraft)
                    .filter(([, sid]) => sid)
                    .map(([employeeId, sid]) => ({
                      employeeId,
                      shiftId: sid,
                    }));
                  const saved = await saveShiftRoster({
                    hotelDate: rosterDate,
                    entries,
                  });
                  setRosterEntries(saved.entries);
                  setMessage(
                    label(
                      `Ростерът за ${rosterDate} е записан (${saved.entries.length})`,
                      `Roster for ${rosterDate} saved (${saved.entries.length})`,
                    ),
                  );
                } catch (err) {
                  setShiftsError(
                    err instanceof Error
                      ? err.message
                      : "Failed to save roster",
                  );
                } finally {
                  setBusyState(false);
                }
              }}
            />
          )}
        </>
      )}
    </main>
  );
}
