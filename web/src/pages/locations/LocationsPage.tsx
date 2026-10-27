/**
 * Rooms / Common-areas operational board: cleaning workflow, issues,
 * overdue sessions, reassignment modal, filters, and detail audit.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchCommonAreas,
  fetchHousekeepers,
  fetchOverdueSessions,
  fetchRooms,
  fetchIssueOptions,
  fetchMaintenanceCategories,
  type IssueOptionRow,
  type MaintenanceCategoryRow,
  type OverdueSession,
  type Room,
} from "../../api/client";
import { ScopeHint } from "../../components/ScopeHint";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { LocationDetailPanel, useLocationAudit } from "./audit";
import {
  applyRoomFilters,
  EMPTY_ROOM_FILTERS,
  uniqueSorted,
  type RoomBoardFilters,
} from "./filters";
import { IssueDialogHost, asPriority, type Priority } from "./issues";
import { boardT, type BoardLocale } from "./labels";
import { AssigneeToolbar, OverdueSessionsPanel } from "./lifecycle";
import { LocationRow } from "./locationRow";
import { makeOccupancyHandlers } from "./occupancy";
import { locationPagePermissions } from "./permissions";
import { ReassignDialog } from "./ReassignDialog";
import type { LocationsPageProps } from "./types";

export function LocationsPage({
  user,
  kind,
  publicSettings,
  locale: localeProp,
}: LocationsPageProps) {
  const locale: BoardLocale =
    localeProp ?? publicSettings?.interface.locale ?? "bg";
  const isCommon = kind === "common_area";
  const unitLabel = isCommon
    ? boardT(locale, "зона", "zone")
    : boardT(locale, "стая", "room");
  const unitLabelCap = isCommon
    ? boardT(locale, "Зона", "Zone")
    : boardT(locale, "Стая", "Room");
  const pageTitle = isCommon
    ? boardT(locale, "Общи части", "Common areas")
    : boardT(locale, "Стаи", "Rooms");
  const pageSubtitle = isCommon
    ? boardT(
        locale,
        "Почистване, инспекция и проблеми по общи части",
        "Cleaning, inspection, and issues for common areas",
      )
    : boardT(
        locale,
        "Готовност, почистване и оперативни действия",
        "Readiness, cleaning workflow, and operational actions",
      );
  const showOverdueBanner =
    publicSettings?.flags.show_overdue_banner !== false;
  const dueHours = publicSettings?.operations.defaultTaskDueHours ?? 4;
  const allowReceptionReassign =
    publicSettings?.flags.allow_reception_reassign !== false;

  const [locations, setLocations] = useState<Room[]>([]);
  const [overdue, setOverdue] = useState<OverdueSession[]>([]);
  const [housekeepers, setHousekeepers] = useState<
    Array<{ id: string; fullName: string; employeeNumber: string }>
  >([]);
  const [assigneeId, setAssigneeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [issueLocationId, setIssueLocationId] = useState<string | null>(null);
  const [issueCategories, setIssueCategories] = useState<
    MaintenanceCategoryRow[]
  >([]);
  const [issueOptions, setIssueOptions] = useState<IssueOptionRow[]>([]);
  const [issuePickMode, setIssuePickMode] = useState<"option" | "custom">(
    "option",
  );
  const [issueOptionId, setIssueOptionId] = useState("");
  const [issueCategoryId, setIssueCategoryId] = useState("");
  const [issueTitle, setIssueTitle] = useState("");
  const [issueBlocks, setIssueBlocks] = useState(false);
  const [issuePriority, setIssuePriority] = useState<Priority>("normal");
  const [detailLocationId, setDetailLocationId] = useState<string | null>(null);
  const [reassignLocation, setReassignLocation] = useState<Room | null>(null);
  const [filters, setFilters] = useState<RoomBoardFilters>(EMPTY_ROOM_FILTERS);

  /** Only one overlay at a time — detail / issue / reassign never stack. */
  const openDetail = useCallback((id: string | null) => {
    setIssueLocationId(null);
    setReassignLocation(null);
    setDetailLocationId(id);
  }, []);
  const openIssue = useCallback((id: string | null) => {
    setDetailLocationId(null);
    setReassignLocation(null);
    setIssueLocationId(id);
  }, []);
  const openReassign = useCallback((location: Room | null) => {
    setDetailLocationId(null);
    setIssueLocationId(null);
    setReassignLocation(location);
  }, []);

  const permissions = locationPagePermissions(user, isCommon);
  const {
    owner,
    canShowAssigneeToolbar,
    canReassign,
    canReviewOverdue,
    canSetOccupancy,
    canSetServiceStatus,
  } = permissions;

  const canReassignEffective =
    canReassign &&
    (user.role !== "reception" || allowReceptionReassign);

  const canOverrideAvailability =
    owner ||
    user.role === "admin" ||
    user.role === "manager" ||
    user.role === "supervisor";

  const { detailEvents, detailLoading, detailAuditError } =
    useLocationAudit(detailLocationId);

  const detailLocation = detailLocationId
    ? (locations.find((l) => l.id === detailLocationId) ?? null)
    : null;

  const overdueLocationIds = useMemo(
    () => new Set(overdue.map((s) => s.room.id)),
    [overdue],
  );

  const filteredLocations = useMemo(
    () => applyRoomFilters(locations, filters, overdueLocationIds),
    [locations, filters, overdueLocationIds],
  );

  const buildingOptions = useMemo(
    () => uniqueSorted(locations.map((l) => l.buildingCode)),
    [locations],
  );
  const floorOptions = useMemo(
    () => uniqueSorted(locations.map((l) => String(l.floor))),
    [locations],
  );
  const sectorOptions = useMemo(
    () =>
      uniqueSorted(
        locations.map((l) => l.sector?.code ?? "").filter(Boolean),
      ),
    [locations],
  );

  const refresh = useCallback(async () => {
    setError(null);
    const data = isCommon ? await fetchCommonAreas() : await fetchRooms();
    setLocations(data);
    if (canReviewOverdue) {
      try {
        const sessions = await fetchOverdueSessions();
        const ids = new Set(data.map((l) => l.id));
        setOverdue(sessions.filter((s) => ids.has(s.room.id)));
      } catch {
        setOverdue([]);
      }
    }
  }, [canReviewOverdue, isCommon]);

  const liveAt = useLiveRefresh(refresh, {
    enabled: !loading,
    busy: busyId !== null,
    eventTypes: [
      "location.changed",
      "cleaning.changed",
      "ticket.changed",
      "settings.changed",
    ],
  });

  useEffect(() => {
    const ac = new AbortController();
    const { signal } = ac;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = isCommon
          ? await fetchCommonAreas({ signal })
          : await fetchRooms({ signal });
        if (signal.aborted) return;
        setLocations(data);
        if (canReviewOverdue) {
          try {
            const sessions = await fetchOverdueSessions({ signal });
            if (signal.aborted) return;
            const ids = new Set(data.map((l) => l.id));
            setOverdue(sessions.filter((s) => ids.has(s.room.id)));
          } catch (err) {
            if (signal.aborted) return;
            if (err instanceof DOMException && err.name === "AbortError") return;
            setOverdue([]);
          }
        }
        const [cats, opts] = await Promise.all([
          fetchMaintenanceCategories({ signal }),
          fetchIssueOptions({ signal }),
        ]);
        if (signal.aborted) return;
        setIssueCategories(cats);
        setIssueOptions(opts);
        if (opts[0]) {
          setIssueOptionId(opts[0].id);
          setIssueTitle(opts[0].nameBg);
          if (opts[0].defaultBlocksRoom != null) {
            setIssueBlocks(opts[0].defaultBlocksRoom);
          }
          setIssuePriority(asPriority(opts[0].defaultPriority));
        }
        if (cats[0]) setIssueCategoryId(cats[0].id);
        if (canShowAssigneeToolbar || canReassign) {
          const hk = await fetchHousekeepers({ signal });
          if (signal.aborted) return;
          setHousekeepers(hk);
          if (hk[0]) setAssigneeId(hk[0].id);
        }
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof Error
            ? err.message
            : `Failed to load ${isCommon ? "common areas" : "rooms"}`,
        );
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();
    return () => {
      ac.abort();
    };
  }, [canShowAssigneeToolbar, canReassign, canReviewOverdue, isCommon]);

  async function runAction(locationId: string, action: () => Promise<void>) {
    setBusyId(locationId);
    setError(null);
    setMessage(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  const occupancyHandlers = detailLocation
    ? makeOccupancyHandlers({
        location: detailLocation,
        runAction,
        setMessage,
      })
    : null;

  function patchFilter<K extends keyof RoomBoardFilters>(
    key: K,
    value: RoomBoardFilters[K],
  ) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <main className="content">
      <header className="page-header">
        <div>
          <h1>{pageTitle}</h1>
          <p>{pageSubtitle}</p>
          <ScopeHint user={user} />
        </div>
      </header>

      {owner && (
        <div className="owner-banner">
          {boardT(
            locale,
            `Собственик — пълен достъп до всички действия по ${
              isCommon ? "общите части" : "стаите"
            }`,
            `Owner — full access to all ${isCommon ? "common area" : "room"} actions`,
          )}
        </div>
      )}

      {canShowAssigneeToolbar && (
        <AssigneeToolbar
          assigneeId={assigneeId}
          setAssigneeId={setAssigneeId}
          housekeepers={housekeepers}
          refresh={refresh}
          liveAt={liveAt}
        />
      )}

      <div className="rooms-filters toolbar">
        <label>
          {boardT(locale, "Търсене", "Search")}
          <input
            value={filters.q}
            onChange={(e) => patchFilter("q", e.target.value)}
            placeholder={boardT(locale, "Номер на стая", "Room number")}
          />
        </label>
        <label>
          {boardT(locale, "Сграда", "Building")}
          <select
            value={filters.building}
            onChange={(e) => patchFilter("building", e.target.value)}
          >
            <option value="">{boardT(locale, "Всички", "All")}</option>
            {buildingOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label>
          {boardT(locale, "Етаж", "Floor")}
          <select
            value={filters.floor}
            onChange={(e) => patchFilter("floor", e.target.value)}
          >
            <option value="">{boardT(locale, "Всички", "All")}</option>
            {floorOptions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label>
          {boardT(locale, "Сектор", "Sector")}
          <select
            value={filters.sector}
            onChange={(e) => patchFilter("sector", e.target.value)}
          >
            <option value="">{boardT(locale, "Всички", "All")}</option>
            {sectorOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {!isCommon && (
          <label>
            {boardT(locale, "Заетост", "Occupancy")}
            <select
              value={filters.occupancy}
              onChange={(e) => patchFilter("occupancy", e.target.value)}
            >
              <option value="">{boardT(locale, "Всички", "All")}</option>
              <option value="vacant">{boardT(locale, "Свободна", "Vacant")}</option>
              <option value="occupied">{boardT(locale, "Заета", "Occupied")}</option>
              <option value="unknown">{boardT(locale, "Неизвестна", "Unknown")}</option>
            </select>
          </label>
        )}
        <label>
          {boardT(locale, "Готовност", "Readiness")}
          <select
            value={filters.readiness}
            onChange={(e) => patchFilter("readiness", e.target.value)}
          >
            <option value="">{boardT(locale, "Всички", "All")}</option>
            <option value="ready">{boardT(locale, "Готова", "Ready")}</option>
            <option value="not_ready">{boardT(locale, "Не е готова", "Not ready")}</option>
            <option value="needs_check">{boardT(locale, "Изисква проверка", "Needs check")}</option>
          </select>
        </label>
        <label>
          {boardT(locale, "Изпълнител", "Assignee")}
          <select
            value={filters.assigneeId}
            onChange={(e) => patchFilter("assigneeId", e.target.value)}
          >
            <option value="">{boardT(locale, "Всички", "All")}</option>
            {housekeepers.map((hk) => (
              <option key={hk.id} value={hk.id}>
                {hk.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={filters.dirtyOnly}
            onChange={(e) => patchFilter("dirtyOnly", e.target.checked)}
          />
          {boardT(locale, "Мръсни", "Dirty")}
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={filters.awaitingInspection}
            onChange={(e) => patchFilter("awaitingInspection", e.target.checked)}
          />
          {boardT(locale, "Чака проверка", "Awaiting inspection")}
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={filters.reworkOnly}
            onChange={(e) => patchFilter("reworkOnly", e.target.checked)}
          />
          {boardT(locale, "Преработка", "Rework")}
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={filters.activeRepairs}
            onChange={(e) => patchFilter("activeRepairs", e.target.checked)}
          />
          {boardT(locale, "Активни ремонти", "Active repairs")}
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={filters.blockingRepairs}
            onChange={(e) => patchFilter("blockingRepairs", e.target.checked)}
          />
          {boardT(locale, "Блокиращи ремонти", "Blocking repairs")}
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={filters.overdueOnly}
            onChange={(e) => patchFilter("overdueOnly", e.target.checked)}
          />
          {boardT(locale, "Просрочени", "Overdue")}
        </label>
        <button
          type="button"
          className="ghost"
          onClick={() => setFilters(EMPTY_ROOM_FILTERS)}
        >
          {boardT(locale, "Изчисти филтри", "Clear filters")}
        </button>
      </div>

      {canReviewOverdue && showOverdueBanner && (
        <OverdueSessionsPanel
          overdueSessionMinutes={
            publicSettings?.operations.overdueSessionMinutes ?? 240
          }
          overdue={overdue}
          unitLabel={unitLabel}
          unitLabelCap={unitLabelCap}
          busyId={busyId}
          setBusyId={setBusyId}
          setError={setError}
          setMessage={setMessage}
          refresh={refresh}
        />
      )}

      {error && <div className="error banner">{error}</div>}
      {message && <div className="ok banner">{message}</div>}

      {issueLocationId && (
        <IssueDialogHost
          issueLocationId={issueLocationId}
          unitLabel={unitLabel}
          pickMode={issuePickMode}
          optionId={issueOptionId}
          categoryId={issueCategoryId}
          title={issueTitle}
          blocksRoom={issueBlocks}
          priority={issuePriority}
          options={issueOptions}
          categories={issueCategories}
          onPickModeChange={setIssuePickMode}
          onOptionIdChange={(id, opt) => {
            setIssueOptionId(id);
            if (opt) {
              setIssueTitle(opt.nameBg);
              if (opt.defaultBlocksRoom != null) {
                setIssueBlocks(opt.defaultBlocksRoom);
              }
              setIssuePriority(asPriority(opt.defaultPriority));
            }
          }}
          onCategoryIdChange={setIssueCategoryId}
          onTitleChange={setIssueTitle}
          onBlocksRoomChange={setIssueBlocks}
          onPriorityChange={setIssuePriority}
          onCancel={() => openIssue(null)}
          runAction={runAction}
          setMessage={setMessage}
          setError={setError}
          setIssueLocationId={openIssue}
          setIssueTitle={setIssueTitle}
        />
      )}

      {reassignLocation && (
        <ReassignDialog
          location={reassignLocation}
          locale={locale}
          canOverrideAvailability={canOverrideAvailability}
          onClose={() => openReassign(null)}
          onSuccess={(msg) => {
            setMessage(msg);
            void refresh();
          }}
          onError={setError}
        />
      )}

      {loading ? (
        <p className="muted">
          {boardT(locale, "Зареждане…", "Loading…")}
        </p>
      ) : (
        <div className="table-wrap">
          <p className="muted">
            {filteredLocations.length} / {locations.length}{" "}
            {boardT(locale, "показани", "shown")}
          </p>
          <table className="rooms-board-table">
            <thead>
              <tr>
                <th>{boardT(locale, "Стая", "Room")}</th>
                <th>{boardT(locale, "Готовност", "Readiness")}</th>
                <th>{boardT(locale, "Изпълнител", "Assignee")}</th>
                <th>{boardT(locale, "Почистване", "Cleaning")}</th>
                <th>{boardT(locale, "Следващо действие", "Next action")}</th>
                <th>{boardT(locale, "Ремонти", "Issues")}</th>
                <th>{boardT(locale, "Задача", "Task")}</th>
                <th>{boardT(locale, "Действия", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredLocations.map((loc) => (
                <LocationRow
                  key={loc.id}
                  location={loc}
                  user={user}
                  locale={locale}
                  isCommon={isCommon}
                  unitLabel={unitLabel}
                  unitLabelCap={unitLabelCap}
                  dueHours={dueHours}
                  assigneeId={assigneeId}
                  busyId={busyId}
                  detailLocationId={detailLocationId}
                  permissions={permissions}
                  canReassignEffective={canReassignEffective}
                  setDetailLocationId={openDetail}
                  setBusyId={setBusyId}
                  setMessage={setMessage}
                  setError={setError}
                  setIssueLocationId={openIssue}
                  setIssueTitle={setIssueTitle}
                  setIssueBlocks={setIssueBlocks}
                  onReassignClick={openReassign}
                  runAction={runAction}
                  refresh={refresh}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detailLocation && occupancyHandlers && (
        <LocationDetailPanel
          location={detailLocation}
          unitLabelCap={unitLabelCap}
          events={detailEvents}
          loading={detailLoading}
          auditError={detailAuditError}
          busy={busyId === detailLocation.id}
          canSetOccupancy={canSetOccupancy}
          canSetServiceStatus={canSetServiceStatus}
          onClose={() => openDetail(null)}
          onOccupancyChange={occupancyHandlers.onOccupancyChange}
          onServiceStatusChange={occupancyHandlers.onServiceStatusChange}
        />
      )}
    </main>
  );
}
