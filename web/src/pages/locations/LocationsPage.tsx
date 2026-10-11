import { useCallback, useEffect, useState } from "react";
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
import { IssueDialogHost } from "./issues";
import { AssigneeToolbar, OverdueSessionsPanel } from "./lifecycle";
import { LocationRow } from "./locationRow";
import { makeOccupancyHandlers, OccupancyHeaderCell } from "./occupancy";
import { locationPagePermissions } from "./permissions";
import type { LocationsPageProps } from "./types";

export function LocationsPage({
  user,
  kind,
  publicSettings,
}: LocationsPageProps) {
  const isCommon = kind === "common_area";
  const unitLabel = isCommon ? "зона" : "стая";
  const unitLabelCap = isCommon ? "Зона" : "Room";
  const pageTitle = isCommon ? "Общи части" : "Rooms";
  const pageSubtitle = isCommon
    ? "Почистване, инспекция и проблеми по общи части (без заетост)"
    : "Readiness, cleaning workflow и blocking issues";
  const showOverdueBanner =
    publicSettings?.flags.show_overdue_banner !== false;
  const dueHours = publicSettings?.operations.defaultTaskDueHours ?? 4;

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
  const [issueBlocks, setIssueBlocks] = useState(true);
  const [detailLocationId, setDetailLocationId] = useState<string | null>(null);

  const permissions = locationPagePermissions(user, isCommon);
  const {
    owner,
    canManage,
    canReviewOverdue,
    canSetOccupancy,
    canSetServiceStatus,
  } = permissions;

  const { detailEvents, detailLoading, detailAuditError } =
    useLocationAudit(detailLocationId);

  const detailLocation = detailLocationId
    ? (locations.find((l) => l.id === detailLocationId) ?? null)
    : null;

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
        }
        if (cats[0]) setIssueCategoryId(cats[0].id);
        if (canManage) {
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
  }, [canManage, canReviewOverdue, isCommon]);

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
          Собственик — пълен достъп до всички действия по{" "}
          {isCommon ? "общите части" : "стаите"}
        </div>
      )}
      {canManage && (
        <AssigneeToolbar
          assigneeId={assigneeId}
          setAssigneeId={setAssigneeId}
          housekeepers={housekeepers}
          refresh={refresh}
          liveAt={liveAt}
        />
      )}

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
            }
          }}
          onCategoryIdChange={setIssueCategoryId}
          onTitleChange={setIssueTitle}
          onBlocksRoomChange={setIssueBlocks}
          onCancel={() => setIssueLocationId(null)}
          runAction={runAction}
          setMessage={setMessage}
          setIssueLocationId={setIssueLocationId}
          setIssueTitle={setIssueTitle}
        />
      )}

      {loading ? (
        <p className="muted">
          Loading {isCommon ? "common areas" : "rooms"}…
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{unitLabelCap}</th>
                <th>Building</th>
                <th>Floor</th>
                <th>Sector</th>
                <OccupancyHeaderCell isCommon={isCommon} />
                <th>Service</th>
                <th>Cleaning</th>
                <th>Priority / Due</th>
                <th>Readiness</th>
                <th>Issues</th>
                <th>Task</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((loc) => (
                <LocationRow
                  key={loc.id}
                  location={loc}
                  user={user}
                  isCommon={isCommon}
                  unitLabel={unitLabel}
                  unitLabelCap={unitLabelCap}
                  dueHours={dueHours}
                  assigneeId={assigneeId}
                  busyId={busyId}
                  detailLocationId={detailLocationId}
                  permissions={permissions}
                  setDetailLocationId={setDetailLocationId}
                  setBusyId={setBusyId}
                  setMessage={setMessage}
                  setError={setError}
                  setIssueLocationId={setIssueLocationId}
                  setIssueTitle={setIssueTitle}
                  setIssueBlocks={setIssueBlocks}
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
          onClose={() => setDetailLocationId(null)}
          onOccupancyChange={occupancyHandlers.onOccupancyChange}
          onServiceStatusChange={occupancyHandlers.onServiceStatusChange}
        />
      )}
    </main>
  );
}
