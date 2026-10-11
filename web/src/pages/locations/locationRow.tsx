import type { AuthUser, Room } from "../../api/client";
import { IssuesCell, ReportIssueButton } from "./issues";
import {
  LifecycleActions,
  TaskInfoCell,
  TaskPriorityDueCell,
} from "./lifecycle";
import { OccupancyCell } from "./occupancy";
import type { LocationPagePermissions } from "./permissions";

type LocationRowProps = {
  location: Room;
  user: AuthUser;
  isCommon: boolean;
  unitLabel: string;
  unitLabelCap: string;
  dueHours: number;
  assigneeId: string;
  busyId: string | null;
  detailLocationId: string | null;
  permissions: LocationPagePermissions;
  setDetailLocationId: (id: string | null) => void;
  setBusyId: (id: string | null) => void;
  setMessage: (message: string | null) => void;
  setError: (error: string | null) => void;
  setIssueLocationId: (id: string | null) => void;
  setIssueTitle: (title: string) => void;
  setIssueBlocks: (blocks: boolean) => void;
  runAction: (locationId: string, action: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
};

export function LocationRow({
  location: loc,
  user,
  isCommon,
  unitLabel,
  unitLabelCap,
  dueHours,
  assigneeId,
  busyId,
  detailLocationId,
  permissions,
  setDetailLocationId,
  setBusyId,
  setMessage,
  setError,
  setIssueLocationId,
  setIssueTitle,
  setIssueBlocks,
  runAction,
  refresh,
}: LocationRowProps) {
  const { owner, canManage, canWork, canInspect, canResolve } = permissions;
  const busy = busyId === loc.id;
  const task = loc.activeTask;
  const isMyRunning = task?.runningSession?.employeeId === user.employeeId;
  const canStartThis =
    canWork &&
    task &&
    (task.status === "assigned" || task.status === "rework") &&
    !task.runningSession &&
    (owner ||
      user.role === "supervisor" ||
      !task.assignee ||
      task.assignee.id === user.employeeId);
  const canCompleteThis =
    canWork &&
    task?.runningSession &&
    (owner || user.role === "supervisor" || isMyRunning);

  return (
    <tr
      className={`location-row-clickable${
        detailLocationId === loc.id ? " location-row-selected" : ""
      }`}
      onClick={() => setDetailLocationId(loc.id)}
    >
      <td>{loc.number}</td>
      <td>{loc.buildingCode}</td>
      <td>{loc.floor}</td>
      <td>
        {loc.sector ? (
          <span title={loc.sector.nameBg}>{loc.sector.code}</span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <OccupancyCell isCommon={isCommon} occupancy={loc.occupancy} />
      <td>
        <span className={`pill service-${loc.serviceStatus}`}>
          {loc.serviceStatus}
        </span>
      </td>
      <td>
        <span className={`pill cleaning-${loc.cleaningStatus}`}>
          {loc.cleaningStatus}
        </span>
      </td>
      <TaskPriorityDueCell task={task} />
      <td>
        <span className={`pill ready-${loc.readiness}`}>{loc.readiness}</span>
        {loc.readinessReasons.length > 0 && (
          <div className="reasons">{loc.readinessReasons.join(", ")}</div>
        )}
      </td>
      <IssuesCell
        location={loc}
        busy={busy}
        canResolve={canResolve}
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
          canManage={canManage}
          canInspect={canInspect}
          canStartThis={canStartThis}
          canCompleteThis={canCompleteThis}
          isCommon={isCommon}
          unitLabel={unitLabel}
          unitLabelCap={unitLabelCap}
          dueHours={dueHours}
          assigneeId={assigneeId}
          runAction={runAction}
          setMessage={setMessage}
          setError={setError}
          reportIssueButton={
            <ReportIssueButton
              busy={busy}
              locationId={loc.id}
              setIssueLocationId={setIssueLocationId}
              setIssueTitle={setIssueTitle}
              setIssueBlocks={setIssueBlocks}
            />
          }
        />
      </td>
    </tr>
  );
}
