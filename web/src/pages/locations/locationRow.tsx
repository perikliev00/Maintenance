/**
 * Single Locations board row: status pills, issues summary, and lifecycle actions.
 * Each action is gated by its exact capability — no OR bleed.
 */
import type { AuthUser, Room } from "../../api/client";
import { IssuesCell, ReportIssueButton } from "./issues";
import {
  LifecycleActions,
  TaskInfoCell,
  TaskPriorityDueCell,
} from "./lifecycle";
import {
  boardT,
  cleaningLabel,
  nextActionLabel,
  occupancyLabel,
  readinessLabel,
  reasonLabel,
  serviceLabel,
  type BoardLocale,
} from "./labels";
import type { LocationPagePermissions } from "./permissions";

type LocationRowProps = {
  location: Room;
  user: AuthUser;
  locale: BoardLocale;
  isCommon: boolean;
  unitLabel: string;
  unitLabelCap: string;
  dueHours: number;
  assigneeId: string;
  busyId: string | null;
  detailLocationId: string | null;
  permissions: LocationPagePermissions;
  canReassignEffective: boolean;
  setDetailLocationId: (id: string | null) => void;
  setBusyId: (id: string | null) => void;
  setMessage: (message: string | null) => void;
  setError: (error: string | null) => void;
  setIssueLocationId: (id: string | null) => void;
  setIssueTitle: (title: string) => void;
  setIssueBlocks: (blocks: boolean) => void;
  onReassignClick: (location: Room) => void;
  runAction: (locationId: string, action: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
};

export function LocationRow({
  location: loc,
  user,
  locale,
  isCommon,
  unitLabel,
  unitLabelCap,
  dueHours,
  assigneeId,
  busyId,
  detailLocationId,
  permissions,
  canReassignEffective,
  setDetailLocationId,
  setBusyId,
  setMessage,
  setError,
  setIssueLocationId,
  setIssueTitle,
  setIssueBlocks,
  onReassignClick,
  runAction,
  refresh,
}: LocationRowProps) {
  const {
    owner,
    canMarkDirty,
    canCreateTask,
    canStart,
    canComplete,
    canInspect,
    canReportIssue,
    canResolve,
  } = permissions;
  const busy = busyId === loc.id;
  const task = loc.activeTask;
  const isMyRunning = task?.runningSession?.employeeId === user.employeeId;
  const canStartThis =
    canStart &&
    task &&
    (task.status === "assigned" || task.status === "rework") &&
    !task.runningSession &&
    (owner ||
      user.role === "supervisor" ||
      !task.assignee ||
      task.assignee.id === user.employeeId);
  const canCompleteThis =
    canComplete &&
    task?.runningSession &&
    (owner || user.role === "supervisor" || isMyRunning);

  return (
    <tr
      className={`location-row-clickable${
        detailLocationId === loc.id ? " location-row-selected" : ""
      }`}
      onClick={() => setDetailLocationId(loc.id)}
    >
      <td>
        <strong>
          {loc.buildingCode} {loc.number}
        </strong>
        <div className="muted small">
          {boardT(locale, "Етаж", "Floor")} {loc.floor}
          {loc.sector ? ` · ${loc.sector.code}` : ""}
        </div>
      </td>
      <td>
        <span className={`pill ready-${loc.readiness}`}>
          {readinessLabel(locale, loc.readiness)}
        </span>
        {loc.readinessReasons.length > 0 && (
          <div className="reasons">
            {loc.readinessReasons.map((r) => reasonLabel(locale, r)).join(", ")}
          </div>
        )}
      </td>
      <td>
        {task?.assignee ? (
          <span>
            {task.assignee.fullName}
            <div className="muted small">{task.assignee.employeeNumber}</div>
          </span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td>
        <span className={`pill cleaning-${loc.cleaningStatus}`}>
          {cleaningLabel(locale, loc.cleaningStatus)}
        </span>
        {!isCommon && (
          <div className="muted small">
            {occupancyLabel(locale, loc.occupancy)} ·{" "}
            {serviceLabel(locale, loc.serviceStatus)}
          </div>
        )}
        {isCommon && (
          <div className="muted small">
            {serviceLabel(locale, loc.serviceStatus)}
          </div>
        )}
      </td>
      <td>
        <span className="next-action">
          {nextActionLabel(locale, loc)}
        </span>
        <TaskPriorityDueCell task={task} />
      </td>
      <IssuesCell
        location={loc}
        busy={busy}
        canResolve={canResolve}
        locale={locale}
        setBusyId={setBusyId}
        setMessage={setMessage}
        setError={setError}
        refresh={refresh}
      />
      <TaskInfoCell task={task} />
      <td>
        <LifecycleActions
          location={loc}
          busy={busy}
          canMarkDirty={canMarkDirty}
          canCreateTask={canCreateTask}
          canInspect={canInspect}
          canReassign={canReassignEffective}
          canStartThis={canStartThis}
          canCompleteThis={canCompleteThis}
          isCommon={isCommon}
          unitLabel={unitLabel}
          unitLabelCap={unitLabelCap}
          dueHours={dueHours}
          assigneeId={assigneeId}
          reassignLabel={boardT(locale, "Преназначи", "Reassign")}
          markDirtyLabel={boardT(locale, "Маркирай като мръсна", "Mark dirty")}
          createTaskLabel={boardT(locale, "Създай задача", "Create task")}
          runAction={runAction}
          setMessage={setMessage}
          setError={setError}
          onReassignClick={onReassignClick}
          reportIssueButton={
            canReportIssue ? (
              <ReportIssueButton
                busy={busy}
                locationId={loc.id}
                label={boardT(locale, "Докладвай проблем", "Report issue")}
                setIssueLocationId={setIssueLocationId}
                setIssueTitle={setIssueTitle}
                setIssueBlocks={setIssueBlocks}
              />
            ) : null
          }
        />
      </td>
    </tr>
  );
}
