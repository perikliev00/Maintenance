/**
 * Rooms / Common-areas operational board: cleaning workflow, issues,
 * overdue sessions, reassignment modal, filters, and detail audit.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCommonAreas,
  fetchHousekeepers,
  fetchOverdueSessions,
  fetchRooms,
  fetchIssueOptions,
  fetchMaintenanceCategories,
  type IssueOptionRow,
  type MaintenanceCategoryRow,
  type Room,
} from "../../api/client";
import { ScopeHint } from "../../components/ScopeHint";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { LocationDetailPanel, useLocationAudit } from "./audit";
import { addBusyId, removeBusyId } from "./busyIds";
import {
  applyRoomFilters,
  EMPTY_ROOM_FILTERS,
  uniqueSorted,
  type RoomBoardFilters,
} from "./filters";
import { IssueDialogHost, asPriority, type Priority } from "./issues";
import { buildIssueFormDefaults } from "./issueFormDefaults";
import { boardT, type BoardLocale } from "./labels";
import { AssigneeToolbar, OverdueSessionsPanel } from "./lifecycle";
import { LocationRepairsPanel } from "./LocationRepairsPanel";
import { LocationRow } from "./locationRow";
import { makeOccupancyHandlers } from "./occupancy";
import {
  INITIAL_OVERDUE_STATE,
  applyOverdueFetchResult,
  overdueFilterReliable,
  overdueLoading,
  type OverdueState,
} from "./overdueState";
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
  const [overdueState, setOverdueState] = useState<OverdueState>(
    INITIAL_OVERDUE_STATE,
  );
  const [housekeepers, setHousekeepers] = useState<
    Array<{ id: string; fullName: string; employeeNumber: string }>
  >([]);
  const [assigneeId, setAssigneeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [issueLocationId, setIssueLocationId] = useState<string | null>(null);
  const [repairsLocationId, setRepairsLocationId] = useState<string | null>(
    null,
  );
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
  const refreshRevision = useRef(0);
  const overdueRevision = useRef(0);
  const overdueAbortRef = useRef<AbortController | null>(null);
  const busyIdsRef = useRef<Set<string>>(new Set());

  const beginBusy = useCallback((id: string) => {
    if (busyIdsRef.current.has(id)) return false;
    busyIdsRef.current = addBusyId(busyIdsRef.current, id);
    setBusyIds(busyIdsRef.current);
    return true;
  }, []);

  const endBusy = useCallback((id: string) => {
    busyIdsRef.current = removeBusyId(busyIdsRef.current, id);
    setBusyIds(busyIdsRef.current);
  }, []);

  /** Only one overlay at a time — detail / issue / reassign / repairs never stack. */
  const openDetail = useCallback((id: string | null) => {
    setIssueLocationId(null);
    setReassignLocation(null);
    setRepairsLocationId(null);
    setDetailLocationId(id);
  }, []);
  const openIssue = useCallback((id: string | null) => {
    setDetailLocationId(null);
    setReassignLocation(null);
    setRepairsLocationId(null);
    setIssueLocationId(id);
  }, []);
  const openReassign = useCallback((location: Room | null) => {
    setDetailLocationId(null);
    setIssueLocationId(null);
    setRepairsLocationId(null);
    setReassignLocation(location);
  }, []);
  const openRepairs = useCallback((locationId: string | null) => {
    setDetailLocationId(null);
    setIssueLocationId(null);
    setReassignLocation(null);
    setRepairsLocationId(locationId);
  }, []);

  const applyIssueDefaults = useCallback(
    (
      pickMode: "option" | "custom",
      options: IssueOptionRow[],
      optionId: string,
      categoryId: string,
      categories: MaintenanceCategoryRow[],
    ) => {
      const defaults = buildIssueFormDefaults({
        locale,
        pickMode,
        options,
        optionId,
        categoryId,
        categoriesFirstId: categories[0]?.id,
      });
      setIssuePickMode(defaults.pickMode);
      setIssueOptionId(defaults.optionId);
      setIssueCategoryId(defaults.categoryId);
      setIssueTitle(defaults.title);
      setIssueBlocks(defaults.blocksRoom);
      setIssuePriority(defaults.priority);
    },
    [locale],
  );

  const openIssueForLocation = useCallback(
    (locationId: string) => {
      applyIssueDefaults(
        issuePickMode,
        issueOptions,
        issueOptionId,
        issueCategoryId,
        issueCategories,
      );
      openIssue(locationId);
    },
    [
      applyIssueDefaults,
      issuePickMode,
      issueOptions,
      issueOptionId,
      issueCategoryId,
      issueCategories,
      openIssue,
    ],
  );

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

  const repairsLocation = repairsLocationId
    ? (locations.find((l) => l.id === repairsLocationId) ?? null)
    : null;

  const overdueLocationIds = useMemo(
    () => new Set(overdueState.sessions.map((s) => s.room.id)),
    [overdueState.sessions],
  );

  const filteredLocations = useMemo(() => {
    const base = applyRoomFilters(locations, filters, overdueLocationIds);
    // When overdue data is unreliable, overdueOnly must not pretend completeness.
    if (filters.overdueOnly && !overdueFilterReliable(overdueState)) {
      return base;
    }
    return base;
  }, [locations, filters, overdueLocationIds, overdueState]);

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

  const loadOverdue = useCallback(
    async (locationIds: Set<string>, externalSignal?: AbortSignal) => {
      if (!canReviewOverdue) return;
      overdueAbortRef.current?.abort();
      const ac = new AbortController();
      overdueAbortRef.current = ac;
      const onExternalAbort = () => ac.abort();
      externalSignal?.addEventListener("abort", onExternalAbort);
      const revision = ++overdueRevision.current;
      setOverdueState((prev) => overdueLoading(prev));
      try {
        const sessions = await fetchOverdueSessions({ signal: ac.signal });
        if (ac.signal.aborted) return;
        const filtered = sessions.filter((s) => locationIds.has(s.room.id));
        setOverdueState((prev) => {
          const next = applyOverdueFetchResult(
            overdueRevision.current,
            revision,
            { ok: true, sessions: filtered },
            prev,
          );
          return next ?? prev;
        });
      } catch (err) {
        if (ac.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message =
          err instanceof Error
            ? err.message
            : boardT(
                locale,
                "Неуспешна проверка за просрочени сесии",
                "Failed to check overdue sessions",
              );
        setOverdueState((prev) => {
          const next = applyOverdueFetchResult(
            overdueRevision.current,
            revision,
            { ok: false, message },
            prev,
          );
          return next ?? prev;
        });
      } finally {
        externalSignal?.removeEventListener("abort", onExternalAbort);
      }
    },
    [canReviewOverdue, locale],
  );

  const refresh = useCallback(async () => {
    const revision = ++refreshRevision.current;
    setError(null);
    try {
      const data = isCommon ? await fetchCommonAreas() : await fetchRooms();
      if (revision !== refreshRevision.current) return;
      setLocations(data);
      if (canReviewOverdue) {
        await loadOverdue(new Set(data.map((l) => l.id)));
      }
    } catch (err) {
      if (revision !== refreshRevision.current) return;
      setError(err instanceof Error ? err.message : "Refresh failed");
    }
  }, [canReviewOverdue, isCommon, loadOverdue]);

  const liveAt = useLiveRefresh(refresh, {
    enabled: !loading,
    busy: busyIds.size > 0,
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
          await loadOverdue(
            new Set(data.map((l) => l.id)),
            signal,
          );
        }
        const [cats, opts] = await Promise.all([
          fetchMaintenanceCategories({ signal }),
          fetchIssueOptions({ signal }),
        ]);
        if (signal.aborted) return;
        setIssueCategories(cats);
        setIssueOptions(opts);
        if (opts[0] || cats[0]) {
          applyIssueDefaults("option", opts, opts[0]?.id ?? "", cats[0]?.id ?? "", cats);
        }
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
      overdueAbortRef.current?.abort();
      overdueRevision.current += 1;
    };
  }, [
    applyIssueDefaults,
    canShowAssigneeToolbar,
    canReassign,
    canReviewOverdue,
    isCommon,
    loadOverdue,
  ]);

  async function runAction(locationId: string, action: () => Promise<void>) {
    if (!beginBusy(locationId)) return;
    setError(null);
    setMessage(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      endBusy(locationId);
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

  const overdueFilterHint =
    filters.overdueOnly && !overdueFilterReliable(overdueState)
      ? boardT(
          locale,
          "Филтърът „Просрочени“ използва непълни или остарели данни.",
          "The Overdue filter is using incomplete or outdated data.",
        )
      : null;

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
          locale={locale}
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
            placeholder={
              isCommon
                ? boardT(locale, "Име на зона", "Zone name")
                : boardT(locale, "Номер на стая", "Room number")
            }
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
            disabled={
              overdueState.status === "error" && !overdueState.stale
            }
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

      {overdueFilterHint && (
        <div className="warn banner" role="status">
          {overdueFilterHint}
        </div>
      )}

      {canReviewOverdue && showOverdueBanner && (
        <OverdueSessionsPanel
          locale={locale}
          overdueSessionMinutes={
            publicSettings?.operations.overdueSessionMinutes ?? 240
          }
          overdueState={overdueState}
          unitLabel={unitLabel}
          unitLabelCap={unitLabelCap}
          busyIds={busyIds}
          beginBusy={beginBusy}
          endBusy={endBusy}
          setError={setError}
          setMessage={setMessage}
          refresh={refresh}
          onRetry={() => {
            void loadOverdue(new Set(locations.map((l) => l.id)));
          }}
        />
      )}

      {error && <div className="error banner">{error}</div>}
      {message && <div className="ok banner">{message}</div>}

      {issueLocationId && (
        <IssueDialogHost
          issueLocationId={issueLocationId}
          unitLabel={unitLabel}
          locale={locale}
          pickMode={issuePickMode}
          optionId={issueOptionId}
          categoryId={issueCategoryId}
          title={issueTitle}
          blocksRoom={issueBlocks}
          priority={issuePriority}
          options={issueOptions}
          categories={issueCategories}
          onPickModeChange={(mode) => {
            setIssuePickMode(mode);
            applyIssueDefaults(
              mode,
              issueOptions,
              issueOptionId,
              issueCategoryId,
              issueCategories,
            );
          }}
          onOptionIdChange={(id, opt) => {
            setIssueOptionId(id);
            if (opt) {
              setIssueTitle(locale === "en" ? opt.nameEn : opt.nameBg);
              setIssueBlocks(opt.defaultBlocksRoom ?? false);
              setIssuePriority(asPriority(opt.defaultPriority));
            }
          }}
          onCategoryIdChange={setIssueCategoryId}
          onTitleChange={setIssueTitle}
          onBlocksRoomChange={setIssueBlocks}
          onPriorityChange={setIssuePriority}
          onCancel={() => {
            setIssueTitle("");
            openIssue(null);
          }}
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

      {repairsLocation && (
        <LocationRepairsPanel
          locationId={repairsLocation.id}
          locationLabel={`${repairsLocation.buildingCode} ${repairsLocation.number}`}
          locale={locale}
          canResolve={permissions.canResolve}
          busyIds={busyIds}
          beginBusy={beginBusy}
          endBusy={endBusy}
          setMessage={setMessage}
          setError={setError}
          onClose={() => openRepairs(null)}
          onChanged={refresh}
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
                <th>{unitLabelCap}</th>
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
                  busy={busyIds.has(loc.id)}
                  busyIds={busyIds}
                  detailLocationId={detailLocationId}
                  permissions={permissions}
                  canReassignEffective={canReassignEffective}
                  setDetailLocationId={openDetail}
                  beginBusy={beginBusy}
                  endBusy={endBusy}
                  setMessage={setMessage}
                  setError={setError}
                  onOpenIssue={openIssueForLocation}
                  onOpenRepairs={(id) => openRepairs(id)}
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
          busy={busyIds.has(detailLocation.id)}
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
