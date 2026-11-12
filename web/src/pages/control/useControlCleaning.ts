/**
 * Control cleaning-task section: room + housekeeper pickers and the create
 * form (room, assignee, priority).
 *
 * Refresh scope: `load` reloads rooms and housekeepers only. Defaults are
 * seeded once — first room, and the first housekeeper while the assignee is
 * still `uninitialized` — so a refresh never overrides an explicit choice
 * (including explicit Unassigned). Creating a task refreshes this section only.
 * Missing `cleaning.create` skips fetches without affecting People or Tickets.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  createCleaningTask,
  fetchHousekeepers,
  fetchRooms,
  todayHotelDate,
  type Room,
} from "../../api/client";
import { executeMutationWithRefresh } from "../../saveRefresh";
import {
  assignedEmployeeIdPayload,
  defaultTaskAssigneeIfNeeded,
  sectionFromSettled,
  settleOptional,
  shouldApplyControlRefresh,
  type ControlSectionErrors,
  type SectionLoadResult,
  type TaskAssigneeState,
} from "../controlPageState";
import type { ControlFeedback, ReportLoad } from "./controlBoardTypes";

type HousekeeperOption = {
  id: string;
  fullName: string;
  employeeNumber: string;
};

const SCOPE = ["rooms", "housekeepers"] as const;

type Options = {
  /** `controlLoadPlan` slots for this section. */
  plan: { rooms: boolean; housekeepers: boolean };
  canCreate: boolean;
  feedback: ControlFeedback;
  reportLoad: ReportLoad;
};

// Export function useControlCleaning as part of this module's API.
export function useControlCleaning({
  plan,
  canCreate,
  feedback: { setError, setMessage, setRefreshWarning },
  reportLoad,
}: Options) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [housekeepers, setHousekeepers] = useState<HousekeeperOption[]>([]);
  const [taskRoomId, setTaskRoomId] = useState("");
  const [taskAssignee, setTaskAssignee] = useState<TaskAssigneeState>({
    status: "uninitialized",
  });
  const [taskPriority, setTaskPriority] = useState("normal");
  const [creatingTask, setCreatingTask] = useState(false);

  const revisionRef = useRef(0);
  const taskRoomIdRef = useRef(taskRoomId);
  taskRoomIdRef.current = taskRoomId;

  useEffect(
    () => () => {
      // Unmount: late responses become stale.
      revisionRef.current++;
    },
    [],
  );

  const load = useCallback(async (): Promise<SectionLoadResult> => {
    const revision = ++revisionRef.current;
    if (!plan.rooms && !plan.housekeepers) {
      return { status: "done", scope: [], errors: {} };
    }

    const [roomsSettled, hkSettled] = await Promise.all([
      settleOptional(plan.rooms ? fetchRooms() : null),
      settleOptional(plan.housekeepers ? fetchHousekeepers() : null),
    ]);
    if (!shouldApplyControlRefresh(revision, revisionRef.current)) {
      return { status: "stale" };
    }

    const errors: ControlSectionErrors = {};
    const roomsResult = sectionFromSettled(roomsSettled, plan.rooms);
    const hkResult = sectionFromSettled(hkSettled, plan.housekeepers);

    if (roomsResult.status === "ok") {
      setRooms(roomsResult.data);
      if (!taskRoomIdRef.current && roomsResult.data[0]) {
        setTaskRoomId(roomsResult.data[0].id);
      }
    } else if (roomsResult.status === "error") {
      errors.rooms = roomsResult.message;
    }

    if (hkResult.status === "ok") {
      setHousekeepers(hkResult.data);
      setTaskAssignee((prev) =>
        defaultTaskAssigneeIfNeeded(prev, hkResult.data[0]?.id),
      );
    } else if (hkResult.status === "error") {
      errors.housekeepers = hkResult.message;
    }

    const done: SectionLoadResult = { status: "done", scope: SCOPE, errors };
    reportLoad(done);
    return done;
  }, [plan.rooms, plan.housekeepers, reportLoad]);

  const onCreateTask = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!taskRoomId || !canCreate) return;
      setCreatingTask(true);
      setError(null);
      setMessage(null);
      setRefreshWarning(null);
      try {
        const due = new Date();
        due.setHours(due.getHours() + 4);
        const result = await executeMutationWithRefresh(
          () =>
            createCleaningTask({
              locationId: taskRoomId,
              hotelDate: todayHotelDate(),
              priority: taskPriority,
              assignedEmployeeId: assignedEmployeeIdPayload(taskAssignee),
              dueAt: due.toISOString(),
            }),
          async () => {
            await load();
          },
        );
        if (!result.ok) {
          setError(result.error || "Failed to create task");
          return;
        }
        setMessage("Cleaning task created");
        if (result.outcome === "saved_refresh_failed") {
          setRefreshWarning(result.refreshError ?? "Failed to refresh");
        } else {
          setRefreshWarning(null);
        }
      } finally {
        setCreatingTask(false);
      }
    },
    [
      canCreate,
      load,
      setError,
      setMessage,
      setRefreshWarning,
      taskAssignee,
      taskPriority,
      taskRoomId,
    ],
  );

  return {
    rooms,
    housekeepers,
    taskRoomId,
    setTaskRoomId,
    taskAssignee,
    setTaskAssignee,
    taskPriority,
    setTaskPriority,
    creatingTask,
    onCreateTask,
    load,
  };
}
