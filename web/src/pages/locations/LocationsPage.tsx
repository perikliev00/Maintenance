/**
 * Rooms / Common-areas operational board shell.
 * Data and form ownership live in useLocationsBoard / useLocationIssueForm.
 */
import { useCallback, useRef } from "react";
import { LoadingIndicator } from "../../components/LoadingIndicator";
import { ScopeHint } from "../../components/ScopeHint";
import { LocationDetailPanel } from "./audit";
import { EMPTY_ROOM_FILTERS } from "./filters";
import { IssueDialogHost } from "./issues";
import { boardT, type BoardLocale } from "./labels";
import { AssigneeToolbar, OverdueSessionsPanel } from "./lifecycle";
import { LocationRepairsPanel } from "./LocationRepairsPanel";
import { LocationRow } from "./locationRow";
import { ReassignDialog } from "./ReassignDialog";
import type { LocationsPageProps } from "./types";
import { useLocationIssueForm } from "./useLocationIssueForm";
import { useLocationsBoard } from "./useLocationsBoard";

export function LocationsPage({
  user,
  kind,
  publicSettings,
  locale: localeProp,
  focusLocationId = null,
  focusTaskId = null,
  focusSessionId = null,
  onFocusConsumed,
}: LocationsPageProps) {
  const locale: BoardLocale =
    localeProp ?? publicSettings?.interface.locale ?? "bg";
  const isCommonKind = kind === "common_area";
  const unitLabel = isCommonKind
    ? boardT(locale, "зона", "zone")
    : boardT(locale, "стая", "room");
  const unitLabelCap = isCommonKind
    ? boardT(locale, "Зона", "Zone")
    : boardT(locale, "Стая", "Room");
  const pageTitle = isCommonKind
    ? boardT(locale, "Общи части", "Common areas")
    : boardT(locale, "Стаи", "Rooms");
  const pageSubtitle = isCommonKind
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

  // Cross-hook overlay exclusivity (same ref pattern as TeamPage).
  const clearOtherOverlaysRef = useRef<() => void>(() => {});
  const closeIssueRef = useRef<() => void>(() => {});

  const clearOtherOverlays = useCallback(
    () => clearOtherOverlaysRef.current(),
    [],
  );
  const closeIssue = useCallback(() => closeIssueRef.current(), []);

  const issue = useLocationIssueForm({
    locale,
    clearOtherOverlays,
  });

  const board = useLocationsBoard({
    user,
    kind,
    locale,
    allowReceptionReassign,
    focusLocationId,
    focusTaskId,
    focusSessionId,
    onFocusConsumed,
    closeIssue,
  });

  clearOtherOverlaysRef.current = board.clearNonIssueOverlays;
  closeIssueRef.current = issue.closeIssue;

  return (
    <main className="content">
      <header className="page-header">
        <div>
          <h1>{pageTitle}</h1>
          <p>{pageSubtitle}</p>
          <ScopeHint user={user} />
        </div>
      </header>

      {board.owner && (
        <div className="owner-banner">
          {boardT(
            locale,
            `Собственик — пълен достъп до всички действия по ${
              board.isCommon ? "общите части" : "стаите"
            }`,
            `Owner — full access to all ${board.isCommon ? "common area" : "room"} actions`,
          )}
        </div>
      )}

      {board.canShowAssigneeToolbar && (
        <AssigneeToolbar
          locale={locale}
          assigneeId={board.assigneeId}
          setAssigneeId={board.setAssigneeId}
          housekeepers={board.housekeepers}
          refresh={board.refresh}
          liveAt={board.liveAt}
        />
      )}

      <div className="rooms-filters toolbar">
        <label>
          {boardT(locale, "Търсене", "Search")}
          <input
            value={board.filters.q}
            onChange={(e) => board.patchFilter("q", e.target.value)}
            placeholder={
              board.isCommon
                ? boardT(locale, "Име на зона", "Zone name")
                : boardT(locale, "Номер на стая", "Room number")
            }
          />
        </label>
        <label>
          {boardT(locale, "Сграда", "Building")}
          <select
            value={board.filters.building}
            onChange={(e) => board.patchFilter("building", e.target.value)}
          >
            <option value="">{boardT(locale, "Всички", "All")}</option>
            {board.buildingOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label>
          {boardT(locale, "Етаж", "Floor")}
          <select
            value={board.filters.floor}
            onChange={(e) => board.patchFilter("floor", e.target.value)}
          >
            <option value="">{boardT(locale, "Всички", "All")}</option>
            {board.floorOptions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label>
          {boardT(locale, "Сектор", "Sector")}
          <select
            value={board.filters.sector}
            onChange={(e) => board.patchFilter("sector", e.target.value)}
          >
            <option value="">{boardT(locale, "Всички", "All")}</option>
            {board.sectorOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {!board.isCommon && (
          <label>
            {boardT(locale, "Заетост", "Occupancy")}
            <select
              value={board.filters.occupancy}
              onChange={(e) => board.patchFilter("occupancy", e.target.value)}
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
            value={board.filters.readiness}
            onChange={(e) => board.patchFilter("readiness", e.target.value)}
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
            value={board.filters.assigneeId}
            onChange={(e) => board.patchFilter("assigneeId", e.target.value)}
          >
            <option value="">{boardT(locale, "Всички", "All")}</option>
            {board.housekeepers.map((hk) => (
              <option key={hk.id} value={hk.id}>
                {hk.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={board.filters.dirtyOnly}
            onChange={(e) => board.patchFilter("dirtyOnly", e.target.checked)}
          />
          {boardT(locale, "Мръсни", "Dirty")}
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={board.filters.awaitingInspection}
            onChange={(e) =>
              board.patchFilter("awaitingInspection", e.target.checked)
            }
          />
          {boardT(locale, "Чака проверка", "Awaiting inspection")}
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={board.filters.reworkOnly}
            onChange={(e) => board.patchFilter("reworkOnly", e.target.checked)}
          />
          {boardT(locale, "Преработка", "Rework")}
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={board.filters.activeRepairs}
            onChange={(e) =>
              board.patchFilter("activeRepairs", e.target.checked)
            }
          />
          {boardT(locale, "Активни ремонти", "Active repairs")}
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={board.filters.blockingRepairs}
            onChange={(e) =>
              board.patchFilter("blockingRepairs", e.target.checked)
            }
          />
          {boardT(locale, "Блокиращи ремонти", "Blocking repairs")}
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={board.filters.overdueOnly}
            onChange={(e) => board.patchFilter("overdueOnly", e.target.checked)}
            disabled={
              board.overdueState.status === "error" &&
              !board.overdueState.stale
            }
          />
          {boardT(locale, "Просрочени", "Overdue")}
        </label>
        <button
          type="button"
          className="ghost"
          onClick={() => board.setFilters(EMPTY_ROOM_FILTERS)}
        >
          {boardT(locale, "Изчисти филтри", "Clear filters")}
        </button>
      </div>

      {board.overdueFilterHint && (
        <div className="warn banner" role="status">
          {board.overdueFilterHint}
        </div>
      )}

      {board.canReviewOverdue && showOverdueBanner && (
        <OverdueSessionsPanel
          locale={locale}
          overdueSessionMinutes={
            publicSettings?.operations.overdueSessionMinutes ?? 240
          }
          overdueState={board.overdueState}
          unitLabel={unitLabel}
          unitLabelCap={unitLabelCap}
          busyIds={board.busyIds}
          beginBusy={board.beginBusy}
          endBusy={board.endBusy}
          setError={board.setError}
          setMessage={board.setMessage}
          refresh={board.refresh}
          onRetry={() => {
            void board.loadOverdue(new Set(board.locations.map((l) => l.id)));
          }}
        />
      )}

      {(board.error || issue.catalogError) && (
        <div className="error banner">{board.error ?? issue.catalogError}</div>
      )}
      {board.message && <div className="ok banner">{board.message}</div>}
      {board.refreshWarning && (
        <div className="warn banner" role="status">
          {board.refreshWarning}
        </div>
      )}

      {issue.issueLocationId && (
        <IssueDialogHost
          issueLocationId={issue.issueLocationId}
          unitLabel={unitLabel}
          locale={locale}
          pickMode={issue.issuePickMode}
          optionId={issue.issueOptionId}
          categoryId={issue.issueCategoryId}
          title={issue.issueTitle}
          blocksRoom={issue.issueBlocks}
          priority={issue.issuePriority}
          options={issue.issueOptions}
          categories={issue.issueCategories}
          onPickModeChange={issue.onPickModeChange}
          onOptionIdChange={issue.onOptionIdChange}
          onCategoryIdChange={issue.setIssueCategoryId}
          onTitleChange={issue.setIssueTitle}
          onBlocksRoomChange={issue.setIssueBlocks}
          onPriorityChange={issue.setIssuePriority}
          onCancel={issue.onCancelIssue}
          runAction={board.runAction}
          setMessage={board.setMessage}
          setError={board.setError}
          setIssueLocationId={issue.openIssue}
          setIssueTitle={issue.setIssueTitle}
        />
      )}

      {board.reassignLocation && (
        <ReassignDialog
          location={board.reassignLocation}
          locale={locale}
          canOverrideAvailability={board.canOverrideAvailability}
          onClose={() => board.openReassign(null)}
          onSuccess={(msg) => {
            board.setMessage(msg);
            void board.refresh();
          }}
          onError={board.setError}
        />
      )}

      {board.repairsLocation && (
        <LocationRepairsPanel
          locationId={board.repairsLocation.id}
          locationLabel={`${board.repairsLocation.buildingCode} ${board.repairsLocation.number}`}
          locale={locale}
          canResolve={board.permissions.canResolve}
          busyIds={board.busyIds}
          beginBusy={board.beginBusy}
          endBusy={board.endBusy}
          setMessage={board.setMessage}
          setError={board.setError}
          onClose={() => board.openRepairs(null)}
          onChanged={board.refresh}
        />
      )}

      {board.loading ? (
        <LoadingIndicator
          label={boardT(locale, "Зареждане…", "Loading…")}
        />
      ) : (
        <div className="table-wrap">
          <p className="muted">
            {board.filteredLocations.length} / {board.locations.length}{" "}
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
              {board.filteredLocations.map((loc) => (
                <LocationRow
                  key={loc.id}
                  location={loc}
                  user={user}
                  locale={locale}
                  isCommon={board.isCommon}
                  unitLabel={unitLabel}
                  unitLabelCap={unitLabelCap}
                  dueHours={dueHours}
                  assigneeId={board.assigneeId}
                  busy={board.busyIds.has(loc.id)}
                  busyIds={board.busyIds}
                  detailLocationId={board.detailLocationId}
                  permissions={board.permissions}
                  canReassignEffective={board.canReassignEffective}
                  setDetailLocationId={board.openDetail}
                  beginBusy={board.beginBusy}
                  endBusy={board.endBusy}
                  setMessage={board.setMessage}
                  setError={board.setError}
                  onOpenIssue={issue.openIssueForLocation}
                  onOpenRepairs={(id) => board.openRepairs(id)}
                  onReassignClick={board.openReassign}
                  runAction={board.runAction}
                  refresh={board.refresh}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {board.detailLocation && board.occupancyHandlers && (
        <LocationDetailPanel
          location={board.detailLocation}
          unitLabelCap={unitLabelCap}
          events={board.detailEvents}
          loading={board.detailLoading}
          auditError={board.detailAuditError}
          busy={board.busyIds.has(board.detailLocation.id)}
          canSetOccupancy={board.canSetOccupancy}
          canSetServiceStatus={board.canSetServiceStatus}
          onClose={() => board.openDetail(null)}
          onOccupancyChange={board.occupancyHandlers.onOccupancyChange}
          onServiceStatusChange={board.occupancyHandlers.onServiceStatusChange}
        />
      )}
    </main>
  );
}
