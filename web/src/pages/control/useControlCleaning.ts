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
  // Support the surrounding logic for this step.
  useCallback,
  // Support the surrounding logic for this step.
  useEffect,
  // Support the surrounding logic for this step.
  useRef,
  // Support the surrounding logic for this step.
  useState,
  // Declare type alias FormEvent.
  type FormEvent,
// Support the surrounding logic for this step.
} from "react";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  createCleaningTask,
  // Support the surrounding logic for this step.
  fetchHousekeepers,
  // Support the surrounding logic for this step.
  fetchRooms,
  // Support the surrounding logic for this step.
  todayHotelDate,
  // Declare type alias Room.
  type Room,
// Support the surrounding logic for this step.
} from "../../api/client";
// Import module dependency from ../../saveRefresh.
import { executeMutationWithRefresh } from "../../saveRefresh";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  assignedEmployeeIdPayload,
  // Support the surrounding logic for this step.
  defaultTaskAssigneeIfNeeded,
  // Support the surrounding logic for this step.
  sectionFromSettled,
  // Support the surrounding logic for this step.
  settleOptional,
  // Support the surrounding logic for this step.
  shouldApplyControlRefresh,
  // Declare type alias ControlSectionErrors.
  type ControlSectionErrors,
  // Declare type alias SectionLoadResult.
  type SectionLoadResult,
  // Declare type alias TaskAssigneeState.
  type TaskAssigneeState,
// Support the surrounding logic for this step.
} from "../controlPageState";
// Import type-only dependency for typing without runtime cost.
import type { ControlFeedback, ReportLoad } from "./controlBoardTypes";

// Declare type alias HousekeeperOption.
type HousekeeperOption = {
  // Provide id field used by this structure.
  id: string;
  // Provide fullName field used by this structure.
  fullName: string;
  // Provide employeeNumber field used by this structure.
  employeeNumber: string;
};

// Initialize an array used by subsequent logic.
const SCOPE = ["rooms", "housekeepers"] as const;

// Declare type alias Options.
type Options = {
  /** `controlLoadPlan` slots for this section. */
  plan: { rooms: boolean; housekeepers: boolean };
  // Provide canCreate field used by this structure.
  canCreate: boolean;
  // Provide feedback field used by this structure.
  feedback: ControlFeedback;
  // Provide reportLoad field used by this structure.
  reportLoad: ReportLoad;
};

// Export function useControlCleaning as part of this module's API.
export function useControlCleaning({
  // Support the surrounding logic for this step.
  plan,
  // Support the surrounding logic for this step.
  canCreate,
  // Provide feedback field used by this structure.
  feedback: { setError, setMessage, setRefreshWarning },
  // Support the surrounding logic for this step.
  reportLoad,
// Support the surrounding logic for this step.
}: Options) {
  // React state slot for local UI/data that can change over time.
  const [rooms, setRooms] = useState<Room[]>([]);
  // React state slot for local UI/data that can change over time.
  const [housekeepers, setHousekeepers] = useState<HousekeeperOption[]>([]);
  // React state slot for local UI/data that can change over time.
  const [taskRoomId, setTaskRoomId] = useState("");
  // React state slot for local UI/data that can change over time.
  const [taskAssignee, setTaskAssignee] = useState<TaskAssigneeState>({
    // Provide status field used by this structure.
    status: "uninitialized",
  });
  // React state slot for local UI/data that can change over time.
  const [taskPriority, setTaskPriority] = useState("normal");
  // React state slot for local UI/data that can change over time.
  const [creatingTask, setCreatingTask] = useState(false);

  // Hold a mutable ref that persists across renders without re-render.
  const revisionRef = useRef(0);
  // Hold a mutable ref that persists across renders without re-render.
  const taskRoomIdRef = useRef(taskRoomId);
  // Support the surrounding logic for this step.
  taskRoomIdRef.current = taskRoomId;

  // Run side effects after render when dependencies change.
  useEffect(
    // Support the surrounding logic for this step.
    () => () => {
      // Unmount: late responses become stale.
      revisionRef.current++;
    },
    // Support the surrounding logic for this step.
    [],
  );

  // Memoize callback identity for stable child/effect deps.
  const load = useCallback(async (): Promise<SectionLoadResult> => {
    // Bind revision for use in the following logic.
    const revision = ++revisionRef.current;
    // Conditional branch for the case described by this guard.
    if (!plan.rooms && !plan.housekeepers) {
      // Return early result or rendered output from this path.
      return { status: "done", scope: [], errors: {} };
    }

    // Bind a local value for the following logic.
    const [roomsSettled, hkSettled] = await Promise.all([
      // Invoke settleOptional to perform this step.
      settleOptional(plan.rooms ? fetchRooms() : null),
      // Invoke settleOptional to perform this step.
      settleOptional(plan.housekeepers ? fetchHousekeepers() : null),
    // Support the surrounding logic for this step.
    ]);
    // Conditional branch for the case described by this guard.
    if (!shouldApplyControlRefresh(revision, revisionRef.current)) {
      // Return early result or rendered output from this path.
      return { status: "stale" };
    }

    // Initialize an object holding related fields.
    const errors: ControlSectionErrors = {};
    // Bind roomsResult for use in the following logic.
    const roomsResult = sectionFromSettled(roomsSettled, plan.rooms);
    // Bind hkResult for use in the following logic.
    const hkResult = sectionFromSettled(hkSettled, plan.housekeepers);

    // Conditional branch for the case described by this guard.
    if (roomsResult.status === "ok") {
      // Update React state so the UI reflects the new value.
      setRooms(roomsResult.data);
      // Conditional branch for the case described by this guard.
      if (!taskRoomIdRef.current && roomsResult.data[0]) {
        // Update React state so the UI reflects the new value.
        setTaskRoomId(roomsResult.data[0].id);
      }
    // Support the surrounding logic for this step.
    } else if (roomsResult.status === "error") {
      // Support the surrounding logic for this step.
      errors.rooms = roomsResult.message;
    }

    // Conditional branch for the case described by this guard.
    if (hkResult.status === "ok") {
      // Update React state so the UI reflects the new value.
      setHousekeepers(hkResult.data);
      // Update React state so the UI reflects the new value.
      setTaskAssignee((prev) =>
        // Invoke defaultTaskAssigneeIfNeeded to perform this step.
        defaultTaskAssigneeIfNeeded(prev, hkResult.data[0]?.id),
      );
    // Support the surrounding logic for this step.
    } else if (hkResult.status === "error") {
      // Support the surrounding logic for this step.
      errors.housekeepers = hkResult.message;
    }

    // Initialize an object holding related fields.
    const done: SectionLoadResult = { status: "done", scope: SCOPE, errors };
    // Invoke reportLoad to perform this step.
    reportLoad(done);
    // Return early result or rendered output from this path.
    return done;
  // Support the surrounding logic for this step.
  }, [plan.rooms, plan.housekeepers, reportLoad]);

  // Memoize callback identity for stable child/effect deps.
  const onCreateTask = useCallback(
    // Support the surrounding logic for this step.
    async (e: FormEvent) => {
      // Invoke e.preventDefault to perform this step.
      e.preventDefault();
      // Conditional branch for the case described by this guard.
      if (!taskRoomId || !canCreate) return;
      // Update React state so the UI reflects the new value.
      setCreatingTask(true);
      // Update React state so the UI reflects the new value.
      setError(null);
      // Update React state so the UI reflects the new value.
      setMessage(null);
      // Update React state so the UI reflects the new value.
      setRefreshWarning(null);
      // Begin guarded block to catch runtime failures.
      try {
        // Bind due for use in the following logic.
        const due = new Date();
        // Invoke due.setHours to perform this step.
        due.setHours(due.getHours() + 4);
        // Bind result for use in the following logic.
        const result = await executeMutationWithRefresh(
          // Support the surrounding logic for this step.
          () =>
            // Invoke createCleaningTask to perform this step.
            createCleaningTask({
              // Provide locationId field used by this structure.
              locationId: taskRoomId,
              // Provide hotelDate field used by this structure.
              hotelDate: todayHotelDate(),
              // Provide priority field used by this structure.
              priority: taskPriority,
              // Provide assignedEmployeeId field used by this structure.
              assignedEmployeeId: assignedEmployeeIdPayload(taskAssignee),
              // Provide dueAt field used by this structure.
              dueAt: due.toISOString(),
            }),
          // Support the surrounding logic for this step.
          async () => {
            // Wait for an async operation before continuing.
            await load();
          },
        );
        // Conditional branch for the case described by this guard.
        if (!result.ok) {
          // Update React state so the UI reflects the new value.
          setError(result.error || "Failed to create task");
          // Return early result or rendered output from this path.
          return;
        }
        // Update React state so the UI reflects the new value.
        setMessage("Cleaning task created");
        // Conditional branch for the case described by this guard.
        if (result.outcome === "saved_refresh_failed") {
          // Update React state so the UI reflects the new value.
          setRefreshWarning(result.refreshError ?? "Failed to refresh");
        // Support the surrounding logic for this step.
        } else {
          // Update React state so the UI reflects the new value.
          setRefreshWarning(null);
        }
      // Support the surrounding logic for this step.
      } finally {
        // Update React state so the UI reflects the new value.
        setCreatingTask(false);
      }
    },
    [
      // Support the surrounding logic for this step.
      canCreate,
      // Support the surrounding logic for this step.
      load,
      // Support the surrounding logic for this step.
      setError,
      // Support the surrounding logic for this step.
      setMessage,
      // Support the surrounding logic for this step.
      setRefreshWarning,
      // Support the surrounding logic for this step.
      taskAssignee,
      // Support the surrounding logic for this step.
      taskPriority,
      // Support the surrounding logic for this step.
      taskRoomId,
    ],
  );

  // Return early result or rendered output from this path.
  return {
    // Support the surrounding logic for this step.
    rooms,
    // Support the surrounding logic for this step.
    housekeepers,
    // Support the surrounding logic for this step.
    taskRoomId,
    // Support the surrounding logic for this step.
    setTaskRoomId,
    // Support the surrounding logic for this step.
    taskAssignee,
    // Support the surrounding logic for this step.
    setTaskAssignee,
    // Support the surrounding logic for this step.
    taskPriority,
    // Support the surrounding logic for this step.
    setTaskPriority,
    // Support the surrounding logic for this step.
    creatingTask,
    // Support the surrounding logic for this step.
    onCreateTask,
    // Support the surrounding logic for this step.
    load,
  };
}
