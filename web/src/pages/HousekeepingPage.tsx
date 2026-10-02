import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  canPerformAction,
  createSector,
  createShift,
  fetchPeople,
  fetchRooms,
  fetchSectors,
  fetchShifts,
  roomQrImageUrl,
  roomQrScanUrl,
  setSectorLocations,
  updateSector,
  updateShift,
  type AuthUser,
  type Person,
  type Room,
  type SectorRow,
  type ShiftRow,
} from "../api/client";

type Props = { user: AuthUser };

type Tab = "sectors" | "shifts" | "qr";

const TABS: Array<{ id: Tab; bg: string; en: string }> = [
  { id: "sectors", bg: "Сектори", en: "Sectors" },
  { id: "shifts", bg: "Смени", en: "Shifts" },
  { id: "qr", bg: "QR кодове", en: "QR codes" },
];

export function HousekeepingPage({ user }: Props) {
  const [tab, setTab] = useState<Tab>("sectors");
  const [locale] = useState<"bg" | "en">("bg");
  const label = (bg: string, en: string) => (locale === "bg" ? bg : en);

  const canManageSectors = canPerformAction(user, "sectors.manage");
  const canManageShifts = canPerformAction(user, "shifts.manage");
  const isSupervisorScope = user.role === "supervisor";
  const lockedSupervisorId = isSupervisorScope ? user.employeeId : null;

  const [sectors, setSectors] = useState<SectorRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [supervisors, setSupervisors] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editingSectorId, setEditingSectorId] = useState<string | null>(null);
  const [sectorCode, setSectorCode] = useState("");
  const [sectorNameBg, setSectorNameBg] = useState("");
  const [sectorNameEn, setSectorNameEn] = useState("");
  const [qrFilter, setQrFilter] = useState("");
  const [previewQr, setPreviewQr] = useState<Room | null>(null);
  const [sectorSupervisorId, setSectorSupervisorId] = useState("");
  const [sectorActive, setSectorActive] = useState(true);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [locationFilter, setLocationFilter] = useState("");

  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [shiftCode, setShiftCode] = useState("");
  const [shiftNameBg, setShiftNameBg] = useState("");
  const [shiftNameEn, setShiftNameEn] = useState("");
  const [shiftStart, setShiftStart] = useState("06:00");
  const [shiftEnd, setShiftEnd] = useState("14:00");
  const [shiftSort, setShiftSort] = useState(0);
  const [shiftActive, setShiftActive] = useState(true);

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
    setSupervisors(
      people.filter(
        (p) =>
          p.role === "supervisor" ||
          p.role === "manager" ||
          p.role === "admin" ||
          p.role === "owner",
      ),
    );
  }, []);

  useEffect(() => {
    if (lockedSupervisorId) {
      setSectorSupervisorId(lockedSupervisorId);
    }
  }, [lockedSupervisorId]);

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

  const qrRooms = useMemo(() => {
    const q = qrFilter.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter(
      (r) =>
        r.number.toLowerCase().includes(q) ||
        r.buildingCode.toLowerCase().includes(q) ||
        (r.sector?.code.toLowerCase().includes(q) ?? false),
    );
  }, [rooms, qrFilter]);

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

  function toggleLocation(id: string) {
    setSelectedLocationIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onSaveSector(e: FormEvent) {
    e.preventDefault();
    if (!canManageSectors) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const supervisorId = lockedSupervisorId ?? (sectorSupervisorId || null);
    try {
      if (editingSectorId) {
        await updateSector(editingSectorId, {
          code: sectorCode,
          nameBg: sectorNameBg,
          nameEn: sectorNameEn,
          primarySupervisorEmployeeId: supervisorId,
          isActive: sectorActive,
        });
        await setSectorLocations(editingSectorId, selectedLocationIds);
        setMessage(label("Секторът е обновен", "Sector updated"));
      } else {
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

  async function onSaveShift(e: FormEvent) {
    e.preventDefault();
    if (!canManageShifts) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
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
              "Сектори, смени и QR за оперативното разпределение.",
              "Sectors, shifts and QR for operational assignment.",
            )}
          </p>
        </div>
      </header>

      <div className="settings-tabs" role="tablist">
        {TABS.map((t) => (
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

      {error && <p className="error-banner">{error}</p>}
      {message && <p className="ok-banner">{message}</p>}

      {tab === "sectors" && (
        <section className="panel">
          <h2>{label("Сектори", "Sectors")}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{label("Код", "Code")}</th>
                  <th>{label("Име", "Name")}</th>
                  <th>{label("Супервайзър", "Supervisor")}</th>
                  <th>{label("Помещения", "Locations")}</th>
                  <th>{label("Статус", "Status")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sectors.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.code}</strong>
                    </td>
                    <td>
                      {locale === "bg" ? s.nameBg : s.nameEn}
                      <div className="muted small">
                        {locale === "bg" ? s.nameEn : s.nameBg}
                      </div>
                    </td>
                    <td>
                      {s.primarySupervisor
                        ? `${s.primarySupervisor.fullName} (${s.primarySupervisor.employeeNumber})`
                        : "—"}
                    </td>
                    <td>{s.locationCount}</td>
                    <td>
                      {s.isActive
                        ? label("активен", "active")
                        : label("неактивен", "inactive")}
                    </td>
                    <td>
                      {canManageSectors && (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => startEditSector(s)}
                        >
                          {label("Редакция", "Edit")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {sectors.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      {label("Няма сектори", "No sectors yet")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {canManageSectors && (
            <form className="report-form" onSubmit={onSaveSector}>
              <h3>
                {editingSectorId
                  ? label("Редакция на сектор", "Edit sector")
                  : label("Нов сектор", "New sector")}
              </h3>
              <label>
                {label("Код", "Code")}
                <input
                  value={sectorCode}
                  onChange={(e) => setSectorCode(e.target.value)}
                  required
                  maxLength={32}
                />
              </label>
              <label>
                {label("Име BG", "Name BG")}
                <input
                  value={sectorNameBg}
                  onChange={(e) => setSectorNameBg(e.target.value)}
                  required
                />
              </label>
              <label>
                {label("Име EN", "Name EN")}
                <input
                  value={sectorNameEn}
                  onChange={(e) => setSectorNameEn(e.target.value)}
                  required
                />
              </label>
              <label>
                {label("Супервайзър", "Supervisor")}
                <select
                  value={sectorSupervisorId}
                  onChange={(e) => setSectorSupervisorId(e.target.value)}
                  disabled={isSupervisorScope}
                >
                  <option value="">—</option>
                  {supervisors.map((p) => (
                    <option key={p.employeeId} value={p.employeeId}>
                      {p.fullName} ({p.employeeNumber})
                    </option>
                  ))}
                </select>
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={sectorActive}
                  onChange={(e) => setSectorActive(e.target.checked)}
                />
                {label("Активен", "Active")}
              </label>

              <div>
                <strong>
                  {label("Помещения", "Locations")} ({selectedLocationIds.length})
                </strong>
                <input
                  type="search"
                  placeholder={label("Филтър…", "Filter…")}
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                  style={{ marginTop: 8, marginBottom: 8 }}
                />
                <div
                  className="table-wrap"
                  style={{ maxHeight: 220, overflow: "auto" }}
                >
                  {filteredRooms.map((r) => (
                    <label key={r.id} className="check-row">
                      <input
                        type="checkbox"
                        checked={selectedLocationIds.includes(r.id)}
                        onChange={() => toggleLocation(r.id)}
                      />
                      {r.buildingCode} {r.number}
                      <span className="muted small">
                        {" "}
                        · ет. {r.floor}
                        {r.sector && r.sector.id !== editingSectorId
                          ? ` · ${r.sector.code}`
                          : ""}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="row-actions">
                <button type="submit" disabled={busy}>
                  {busy
                    ? label("Запис…", "Saving…")
                    : label("Запази", "Save")}
                </button>
                {editingSectorId && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={resetSectorForm}
                    disabled={busy}
                  >
                    {label("Отмени", "Cancel")}
                  </button>
                )}
              </div>
            </form>
          )}
        </section>
      )}

      {tab === "shifts" && (
        <section className="panel">
          <h2>{label("Смени", "Shifts")}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{label("Код", "Code")}</th>
                  <th>{label("Име", "Name")}</th>
                  <th>{label("Начало", "Start")}</th>
                  <th>{label("Край", "End")}</th>
                  <th>{label("Ред", "Order")}</th>
                  <th>{label("Статус", "Status")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shifts.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.code}</strong>
                    </td>
                    <td>{locale === "bg" ? s.nameBg : s.nameEn}</td>
                    <td>{s.startTime}</td>
                    <td>{s.endTime}</td>
                    <td>{s.sortOrder}</td>
                    <td>
                      {s.isActive
                        ? label("активна", "active")
                        : label("неактивна", "inactive")}
                    </td>
                    <td>
                      {canManageShifts && (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => startEditShift(s)}
                        >
                          {label("Редакция", "Edit")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {shifts.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      {label("Няма смени", "No shifts yet")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {canManageShifts && (
            <form className="report-form" onSubmit={onSaveShift}>
              <h3>
                {editingShiftId
                  ? label("Редакция на смяна", "Edit shift")
                  : label("Нова смяна", "New shift")}
              </h3>
              <label>
                {label("Код", "Code")}
                <input
                  value={shiftCode}
                  onChange={(e) => setShiftCode(e.target.value)}
                  required
                  maxLength={32}
                />
              </label>
              <label>
                {label("Име BG", "Name BG")}
                <input
                  value={shiftNameBg}
                  onChange={(e) => setShiftNameBg(e.target.value)}
                  required
                />
              </label>
              <label>
                {label("Име EN", "Name EN")}
                <input
                  value={shiftNameEn}
                  onChange={(e) => setShiftNameEn(e.target.value)}
                  required
                />
              </label>
              <label>
                {label("Начало (HH:mm)", "Start (HH:mm)")}
                <input
                  value={shiftStart}
                  onChange={(e) => setShiftStart(e.target.value)}
                  pattern="([01]\d|2[0-3]):[0-5]\d"
                  required
                />
              </label>
              <label>
                {label("Край (HH:mm)", "End (HH:mm)")}
                <input
                  value={shiftEnd}
                  onChange={(e) => setShiftEnd(e.target.value)}
                  pattern="([01]\d|2[0-3]):[0-5]\d"
                  required
                />
              </label>
              <label>
                {label("Ред", "Sort order")}
                <input
                  type="number"
                  min={0}
                  value={shiftSort}
                  onChange={(e) => setShiftSort(Number(e.target.value) || 0)}
                />
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={shiftActive}
                  onChange={(e) => setShiftActive(e.target.checked)}
                />
                {label("Активна", "Active")}
              </label>
              <div className="row-actions">
                <button type="submit" disabled={busy}>
                  {busy
                    ? label("Запис…", "Saving…")
                    : label("Запази", "Save")}
                </button>
                {editingShiftId && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={resetShiftForm}
                    disabled={busy}
                  >
                    {label("Отмени", "Cancel")}
                  </button>
                )}
              </div>
            </form>
          )}
        </section>
      )}

      {tab === "qr" && (
        <section className="panel">
          <h2>{label("QR кодове", "QR codes")}</h2>
          <p className="muted">
            {label(
              "Генериране и печат на QR за помещения. Сканирането само идентифицира стаята — без автоматичен start/complete. (Invite QR за устройства е в Екип.)",
              "Generate and print room QR codes. Scanning only identifies the room — no auto start/complete. (Device invite QR lives under Team.)",
            )}
          </p>
          <label className="inline-search">
            {label("Филтър…", "Filter…")}
            <input
              value={qrFilter}
              onChange={(e) => setQrFilter(e.target.value)}
              placeholder={label("номер / сграда", "number / building")}
            />
          </label>
          {previewQr && (
            <div className="qr-print-card" style={{ margin: "1rem 0" }}>
              <h3>
                {previewQr.buildingCode} {previewQr.number}
              </h3>
              <img
                src={roomQrImageUrl(roomQrScanUrl(previewQr.qrToken!), 220)}
                alt={`QR ${previewQr.number}`}
                width={220}
                height={220}
              />
              <p className="muted small">{roomQrScanUrl(previewQr.qrToken!)}</p>
              <div className="row-actions">
                <button
                  type="button"
                  onClick={() => window.print()}
                >
                  {label("Печат", "Print")}
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setPreviewQr(null)}
                >
                  {label("Затвори", "Close")}
                </button>
              </div>
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{label("Помещение", "Location")}</th>
                  <th>{label("Сектор", "Sector")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {qrRooms.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>
                        {r.buildingCode} {r.number}
                      </strong>
                      <div className="muted small">
                        ет. {r.floor} · {r.kind === "common_area" ? "common" : "room"}
                      </div>
                    </td>
                    <td>{r.sector?.code ?? "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="ghost"
                        disabled={!r.qrToken}
                        onClick={() => setPreviewQr(r)}
                      >
                        {label("QR", "QR")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
