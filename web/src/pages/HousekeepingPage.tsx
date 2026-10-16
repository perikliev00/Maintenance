/**
 * Housekeeping admin: location catalog, sectors, shifts/roster, and QR print.
 * Tabs/actions gated by rooms.manage / sectors.manage / shifts.manage.
 * Supervisors editing sectors have supervisor select locked to themselves.
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  canPerformAction,
  createSector,
  createShift,
  fetchPeople,
  fetchRooms,
  fetchSectors,
  fetchShiftRoster,
  fetchShifts,
  saveShiftRoster,
  setSectorLocations,
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
import { LocationQrPanel } from "../components/LocationQrPanel";
import { SectorPanel } from "../components/SectorPanel";
import { ShiftPanel } from "../components/ShiftPanel";

type Props = { user: AuthUser };

type Tab = "catalog" | "sectors" | "shifts" | "qr";

const TABS: Array<{ id: Tab; bg: string; en: string }> = [
  { id: "catalog", bg: "Каталог", en: "Catalog" },
  { id: "sectors", bg: "Сектори", en: "Sectors" },
  { id: "shifts", bg: "Смени", en: "Shifts" },
  { id: "qr", bg: "QR кодове", en: "QR codes" },
];

/**
 * Housekeeping admin page: location catalog, sectors, shifts/roster, QR print.
 * Tabs/actions gated by rooms.manage / sectors.manage / shifts.manage.
 */
export function HousekeepingPage({ user }: Props) {
  // Active admin tab (catalog gated by rooms.manage).
  const [tab, setTab] = useState<Tab>("sectors");
  const [locale] = useState<"bg" | "en">("bg");
  /** Pick BG vs EN label for this page's copy. */
  const label = (bg: string, en: string) => (locale === "bg" ? bg : en);

  // Permission gates for each admin tab/action surface.
  const canManageSectors = canPerformAction(user, "sectors.manage");
  const canManageShifts = canPerformAction(user, "shifts.manage");
  const canManageLocations = canPerformAction(user, "rooms.manage");
  // Supervisors editing sectors have supervisor select locked to themselves.
  const isSupervisorScope = user.role === "supervisor";
  const lockedSupervisorId = isSupervisorScope ? user.employeeId : null;

  // Catalog lists for sectors, shifts, rooms, and people pickers.
  const [sectors, setSectors] = useState<SectorRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [supervisors, setSupervisors] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Shared busy flag for sector/shift/roster saves.
  const [busy, setBusy] = useState(false);

  // Sector create/edit form drafts (null editing id = create mode).
  const [editingSectorId, setEditingSectorId] = useState<string | null>(null);
  const [sectorCode, setSectorCode] = useState("");
  const [sectorNameBg, setSectorNameBg] = useState("");
  const [sectorNameEn, setSectorNameEn] = useState("");
  // QR tab filter + preview room.
  const [qrFilter, setQrFilter] = useState("");
  const [previewQr, setPreviewQr] = useState<Room | null>(null);
  const [sectorSupervisorId, setSectorSupervisorId] = useState("");
  const [sectorActive, setSectorActive] = useState(true);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [locationFilter, setLocationFilter] = useState("");

  // Shift create/edit form drafts (null editing id = create mode).
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [shiftCode, setShiftCode] = useState("");
  const [shiftNameBg, setShiftNameBg] = useState("");
  const [shiftNameEn, setShiftNameEn] = useState("");
  const [shiftStart, setShiftStart] = useState("06:00");
  const [shiftEnd, setShiftEnd] = useState("14:00");
  const [shiftSort, setShiftSort] = useState(0);
  const [shiftActive, setShiftActive] = useState(true);

  // Daily roster: hotel date, server entries, and editable employee→shift draft.
  const [rosterDate, setRosterDate] = useState(todayHotelDate());
  const [rosterEntries, setRosterEntries] = useState<ShiftRosterEntry[]>([]);
  const [rosterDraft, setRosterDraft] = useState<
    Record<string, string>
  >({});
  const [housekeepers, setHousekeepers] = useState<Person[]>([]);

  /** Load sectors, shifts, rooms, and people options in parallel. */
  const refresh = useCallback(async () => {
    const [sec, sh, rm, people] = await Promise.all([
      fetchSectors(true),
      fetchShifts(true),
      fetchRooms(),
      fetchPeople({ includeInactive: false }),
    ]);
    setSectors(sec);
    setShifts(sh);
    setRooms(rm);
    // Supervisors for sector assignment include manager/admin/owner too.
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

  /** Load roster for a hotel date into entries + editable draft map. */
  const refreshRoster = useCallback(async (date: string) => {
    if (!canManageShifts) return;
    const roster = await fetchShiftRoster(date);
    setRosterEntries(roster.entries);
    // Draft keyed by employee id → shift id for the save payload.
    const draft: Record<string, string> = {};
    for (const e of roster.entries) {
      draft[e.employee.id] = e.shift.id;
    }
    setRosterDraft(draft);
  }, [canManageShifts]);

  // Keep supervisor field locked when the viewer is a supervisor.
  useEffect(() => {
    if (lockedSupervisorId) {
      setSectorSupervisorId(lockedSupervisorId);
    }
  }, [lockedSupervisorId]);

  // Initial catalog/sector/shift load.
  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  // Roster loads only on the shifts tab when the user can manage shifts.
  useEffect(() => {
    if (tab !== "shifts" || !canManageShifts) return;
    void refreshRoster(rosterDate).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load roster");
    });
  }, [tab, rosterDate, canManageShifts, refreshRoster]);

  // Client-side filter for sector location multi-select.
  const filteredRooms = useMemo(() => {
    const q = locationFilter.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter(
      (r) =>
        r.number.toLowerCase().includes(q) ||
        r.buildingCode.toLowerCase().includes(q) ||
        String(r.floor).includes(q),
    );
  }, [rooms, locationFilter]);

  /** Clear sector form back to create mode (respecting locked supervisor). */
  function resetSectorForm() {
    setEditingSectorId(null);
    setSectorCode("");
    setSectorNameBg("");
    setSectorNameEn("");
    setSectorSupervisorId(lockedSupervisorId ?? "");
    setSectorActive(true);
    setSelectedLocationIds([]);
    setLocationFilter("");
  }

  /** Clear shift form back to create mode with default times. */
  function resetShiftForm() {
    setEditingShiftId(null);
    setShiftCode("");
    setShiftNameBg("");
    setShiftNameEn("");
    setShiftStart("06:00");
    setShiftEnd("14:00");
    setShiftSort(0);
    setShiftActive(true);
  }

  /** Populate sector form from an existing row for edit. */
  function startEditSector(sector: SectorRow) {
    setEditingSectorId(sector.id);
    setSectorCode(sector.code);
    setSectorNameBg(sector.nameBg);
    setSectorNameEn(sector.nameEn);
    setSectorSupervisorId(
      lockedSupervisorId ?? sector.primarySupervisor?.id ?? "",
    );
    setSectorActive(sector.isActive);
    setSelectedLocationIds([...sector.locationIds]);
    setMessage(null);
    setError(null);
  }

  /** Populate shift form from an existing row for edit. */
  function startEditShift(shift: ShiftRow) {
    setEditingShiftId(shift.id);
    setShiftCode(shift.code);
    setShiftNameBg(shift.nameBg);
    setShiftNameEn(shift.nameEn);
    setShiftStart(shift.startTime);
    setShiftEnd(shift.endTime);
    setShiftSort(shift.sortOrder);
    setShiftActive(shift.isActive);
    setMessage(null);
    setError(null);
  }

  /** Toggle a location id in the sector membership multi-select. */
  function toggleLocation(id: string) {
    setSelectedLocationIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  /**
   * Create or update a sector (and replace location membership on update).
   * Permission-gated; supervisors force their own primary supervisor id.
   */
  async function onSaveSector(e: FormEvent) {
    e.preventDefault();
    // Permission gate — no-op without sectors.manage.
    if (!canManageSectors) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    // Supervisors cannot pick another primary supervisor.
    const supervisorId = lockedSupervisorId ?? (sectorSupervisorId || null);
    try {
      // Update path: patch sector row then replace membership.
      if (editingSectorId) {
        await updateSector(editingSectorId, {
          code: sectorCode,
          nameBg: sectorNameBg,
          nameEn: sectorNameEn,
          primarySupervisorEmployeeId: supervisorId,
          isActive: sectorActive,
        });
        // Membership is a separate replace call after the sector row update.
        await setSectorLocations(editingSectorId, selectedLocationIds);
        setMessage(label("Секторът е обновен", "Sector updated"));
      } else {
        // Create path: membership included in the create payload.
        await createSector({
          code: sectorCode,
          nameBg: sectorNameBg,
          nameEn: sectorNameEn,
          primarySupervisorEmployeeId: supervisorId,
          locationIds: selectedLocationIds,
          isActive: sectorActive,
        });
        setMessage(label("Секторът е създаден", "Sector created"));
      }
      resetSectorForm();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Create or update a shift definition.
   * Permission-gated by shifts.manage.
   */
  async function onSaveShift(e: FormEvent) {
    e.preventDefault();
    // Permission gate — no-op without shifts.manage.
    if (!canManageShifts) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      // Update vs create based on editingShiftId.
      if (editingShiftId) {
        await updateShift(editingShiftId, {
          code: shiftCode,
          nameBg: shiftNameBg,
          nameEn: shiftNameEn,
          startTime: shiftStart,
          endTime: shiftEnd,
          sortOrder: shiftSort,
          isActive: shiftActive,
        });
        setMessage(label("Смяната е обновена", "Shift updated"));
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
        setMessage(label("Смяната е създадена", "Shift created"));
      }
      resetShiftForm();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  // Early return while the initial parallel fetch is in flight.
  if (loading) {
    return (
      <main className="content">
        <p className="muted">{label("Зареждане…", "Loading…")}</p>
      </main>
    );
  }

  return (
    <main className="content">
      <header className="page-header">
        <div>
          <h1>{label("Почистване", "Housekeeping")}</h1>
          <p>
            {label(
              "Каталог помещения, сектори, смени и QR за оперативното разпределение.",
              "Location catalog, sectors, shifts and QR for operational assignment.",
            )}
          </p>
        </div>
      </header>

      <div className="settings-tabs" role="tablist">
        {/* Catalog tab only when the user can manage locations. */}
        {TABS.filter(
          (t) => t.id !== "catalog" || canManageLocations,
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => {
              setTab(t.id);
              setError(null);
              setMessage(null);
            }}
          >
            {label(t.bg, t.en)}
          </button>
        ))}
      </div>

      {/* Error / success banners shared across tabs. */}
      {error && <p className="error-banner">{error}</p>}
      {message && <p className="ok-banner">{message}</p>}

      {/* Catalog tab — location create/edit panel. */}
      {tab === "catalog" && canManageLocations && (
        <LocationCatalogPanel locale={locale} />
      )}

      {/* Sectors tab — create/edit form + membership multi-select. */}
      {tab === "sectors" && (
        <SectorPanel
          label={label}
          locale={locale}
          sectors={sectors}
          supervisors={supervisors}
          filteredRooms={filteredRooms}
          canManage={canManageSectors}
          isSupervisorScope={isSupervisorScope}
          busy={busy}
          editingSectorId={editingSectorId}
          sectorCode={sectorCode}
          sectorNameBg={sectorNameBg}
          sectorNameEn={sectorNameEn}
          sectorSupervisorId={sectorSupervisorId}
          sectorActive={sectorActive}
          selectedLocationIds={selectedLocationIds}
          locationFilter={locationFilter}
          onSectorCodeChange={setSectorCode}
          onSectorNameBgChange={setSectorNameBg}
          onSectorNameEnChange={setSectorNameEn}
          onSectorSupervisorIdChange={setSectorSupervisorId}
          onSectorActiveChange={setSectorActive}
          onLocationFilterChange={setLocationFilter}
          onToggleLocation={toggleLocation}
          onStartEdit={startEditSector}
          onReset={resetSectorForm}
          onSave={onSaveSector}
        />
      )}

      {/* Shifts tab — shift definitions + daily roster editor. */}
      {tab === "shifts" && (
        <ShiftPanel
          label={label}
          locale={locale}
          shifts={shifts}
          housekeepers={housekeepers}
          canManage={canManageShifts}
          busy={busy}
          editingShiftId={editingShiftId}
          shiftCode={shiftCode}
          shiftNameBg={shiftNameBg}
          shiftNameEn={shiftNameEn}
          shiftStart={shiftStart}
          shiftEnd={shiftEnd}
          shiftSort={shiftSort}
          shiftActive={shiftActive}
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
            // Patch one employee's shift selection in the draft map.
            setRosterDraft((prev) => ({ ...prev, [employeeId]: shiftId }))
          }
          onStartEdit={startEditShift}
          onReset={resetShiftForm}
          onSave={onSaveShift}
          onSaveRoster={async () => {
            // Persist roster draft: skip employees with empty shift selection.
            setBusy(true);
            setError(null);
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
              setError(
                err instanceof Error ? err.message : "Failed to save roster",
              );
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {/* QR print/preview tab — no manage gate (read of rooms). */}
      {tab === "qr" && (
        <LocationQrPanel
          label={label}
          rooms={rooms}
          filter={qrFilter}
          preview={previewQr}
          onFilterChange={setQrFilter}
          onPreviewChange={setPreviewQr}
        />
      )}
    </main>
  );
}
