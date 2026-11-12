/**
 * Housekeeping tasks, sessions, inspections, and results REST helpers.
 * Start/complete that must work offline should use `../offline` queued wrappers;
 * those send `commandId` + optional `expectedVersion` for optimistic concurrency.
 */
import { apiGet, apiPost, buildQuery } from "./http";

// Export type alias for consumers.
export type OverdueSession = {
  // Field/property in this shape.
  sessionId: string;
  // Field/property in this shape.
  taskId: string;
  // Field/property in this shape.
  startedAt: string;
  // Field/property in this shape.
  elapsedMinutes: number;
  // Field/property in this shape.
  employee: { id: string; fullName: string; employeeNumber: string };
  // Field/property in this shape.
  room: { id: string; number: string; buildingCode: string; floor: number };
};

// Export type alias for consumers.
export type CleaningTaskRow = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  locationId: string;
  // Field/property in this shape.
  hotelDate: string;
  // Field/property in this shape.
  priority: string;
  // Field/property in this shape.
  status: string;
  // Field/property in this shape.
  version: number;
  // Field/property in this shape.
  assignedEmployeeId: string | null;
  // Field/property in this shape.
  shiftId?: string | null;
  // Field/property in this shape.
  reassignReason: string | null;
  // Field/property in this shape.
  location: {
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    number: string;
    // Field/property in this shape.
    kind: string;
    // Field/property in this shape.
    floor: { number: number; building: { code: string; name: string } };
  };
  // Field/property in this shape.
  assignedEmployee: {
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    fullName: string;
    // Field/property in this shape.
    employeeNumber: string;
  // Close multi-line construct with trailing syntax.
  } | null;
  // Field/property in this shape.
  shift?: {
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    code: string;
    // Field/property in this shape.
    nameBg: string;
    // Field/property in this shape.
    nameEn: string;
    // Field/property in this shape.
    startTime: string;
    // Field/property in this shape.
    endTime: string;
  // Close multi-line construct with trailing syntax.
  } | null;
  // Field/property in this shape.
  sessions: Array<{
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    employeeId: string;
    // Field/property in this shape.
    status: string;
    // Field/property in this shape.
    startedAt: string;
    // Field/property in this shape.
    finishedAt: string | null;
    // Field/property in this shape.
    notes: string | null;
  // Close multi-line construct with trailing syntax.
  }>;
  // Field/property in this shape.
  inspections: Array<{
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    result: string;
    // Field/property in this shape.
    findings: string | null;
    // Field/property in this shape.
    inspectedAt: string;
    // Field/property in this shape.
    inspector?: { id: string; fullName: string; employeeNumber: string };
  // Close multi-line construct with trailing syntax.
  }>;
};

/** Create a housekeeping task for a location on a hotel date. */
export async function createCleaningTask(input: {
  // Field/property in this shape.
  locationId: string;
  // Field/property in this shape.
  hotelDate: string;
  // Field/property in this shape.
  priority?: string;
  // Field/property in this shape.
  assignedEmployeeId?: string;
  // Field/property in this shape.
  shiftId?: string | null;
  // Field/property in this shape.
  dueAt?: string;
  // Field/property in this shape.
  serviceType?: CleaningServiceType;
// Open multi-line construct.
}) {
  // Return computed result to caller.
  return apiPost("/cleaning/tasks", input);
}

/**
 * Online start. Pass `expectedVersion` from the task row to detect concurrent
 * reassignment; omit only when the caller does not have a version yet.
 */
export async function startCleaningTask(taskId: string, expectedVersion?: number) {
  // Return computed result to caller.
  return apiPost(`/cleaning/tasks/${taskId}/start`, {
    // Field/property in this shape.
    commandId: crypto.randomUUID(),
    // List item in import/export/params.
    expectedVersion,
  });
}

/** Complete a running session; optional notes and optimistic version. */
export async function completeCleaningSession(
  // Field/property in this shape.
  sessionId: string,
  // Field/property in this shape.
  notes?: string,
  // Field/property in this shape.
  expectedVersion?: number,
// Open multi-line construct.
) {
  // Return computed result to caller.
  return apiPost(`/cleaning/sessions/${sessionId}/complete`, {
    // Field/property in this shape.
    commandId: crypto.randomUUID(),
    // Spread remaining fields/props.
    ...(notes?.trim() ? { notes: notes.trim() } : {}),
    // Spread remaining fields/props.
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  });
}

/** Cancel a running session without marking the room cleaned. */
export async function cancelCleaningSession(
  // Field/property in this shape.
  sessionId: string,
  // Field/property in this shape.
  notes?: string,
  // Field/property in this shape.
  expectedVersion?: number,
// Open multi-line construct.
) {
  // Return computed result to caller.
  return apiPost(`/cleaning/sessions/${sessionId}/cancel`, {
    // Field/property in this shape.
    commandId: crypto.randomUUID(),
    // Spread remaining fields/props.
    ...(notes?.trim() ? { notes: notes.trim() } : {}),
    // Spread remaining fields/props.
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  });
}

/** Supervisor inspection: approve or reject a completed task. */
export async function inspectCleaningTask(
  // Field/property in this shape.
  taskId: string,
  // Field/property in this shape.
  result: "approved" | "rejected",
  // Field/property in this shape.
  findings?: string,
  // Field/property in this shape.
  expectedVersion?: number,
// Open multi-line construct.
) {
  // Return computed result to caller.
  return apiPost(`/cleaning/tasks/${taskId}/inspect`, {
    // Field/property in this shape.
    commandId: crypto.randomUUID(),
    // List item in import/export/params.
    result,
    // List item in import/export/params.
    findings,
    // Spread remaining fields/props.
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  });
}

/** Reassign a task to another housekeeper; reason is required for audit. */
export async function reassignCleaningTask(
  // Field/property in this shape.
  taskId: string,
  // Field/property in this shape.
  assignedEmployeeId: string,
  // Field/property in this shape.
  reason: string,
  // Field/property in this shape.
  expectedVersion?: number,
  // Field/property in this shape.
  shiftId?: string | null,
  // Field/property in this shape.
  forceDespiteAvailability?: boolean,
// Open multi-line construct.
) {
  // Return computed result to caller.
  return apiPost(`/cleaning/tasks/${taskId}/reassign`, {
    // List item in import/export/params.
    assignedEmployeeId,
    // List item in import/export/params.
    reason,
    // List item in import/export/params.
    expectedVersion,
    // Spread remaining fields/props.
    ...(shiftId !== undefined ? { shiftId } : {}),
    // Spread remaining fields/props.
    ...(forceDespiteAvailability === true
      // Continue module logic.
      ? { forceDespiteAvailability: true }
      // Continue multi-line list/arguments.
      : {}),
  });
}

// Export type alias for consumers.
export type HousekeeperAvailabilityStatus =
  // Union/intersection type member.
  | "available"
  // Union/intersection type member.
  | "busy"
  // Union/intersection type member.
  | "on_break"
  // Union/intersection type member.
  | "off_shift"
  // Union/intersection type member.
  | "absent"
  // Union/intersection type member.
  | "unknown";

// Export type alias for consumers.
export type AvailableHousekeeper = {
  // Field/property in this shape.
  employeeId: string;
  // Field/property in this shape.
  fullName: string;
  // Field/property in this shape.
  employeeNumber: string;
  // Field/property in this shape.
  availabilityStatus: HousekeeperAvailabilityStatus;
  // Field/property in this shape.
  availabilityReasons: string[];
  // Field/property in this shape.
  currentShift: {
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    code: string;
    // Field/property in this shape.
    nameBg: string;
    // Field/property in this shape.
    nameEn: string;
    // Field/property in this shape.
    startTime: string;
    // Field/property in this shape.
    endTime: string;
  // Close multi-line construct with trailing syntax.
  } | null;
  // Field/property in this shape.
  currentRunningTask: {
    // Field/property in this shape.
    taskId: string;
    // Field/property in this shape.
    locationId: string;
    // Field/property in this shape.
    locationNumber: string;
  // Close multi-line construct with trailing syntax.
  } | null;
  // Field/property in this shape.
  assignedTaskCount: number;
  // Field/property in this shape.
  sectorEligibility: "hotel_wide";
  // Field/property in this shape.
  checkedAt: string;
};

// Export type alias for consumers.
export type AvailableHousekeepersResponse = {
  // Field/property in this shape.
  locationId: string;
  // Field/property in this shape.
  taskId: string | null;
  // Field/property in this shape.
  hotelDate: string;
  // Field/property in this shape.
  checkedAt: string;
  // Field/property in this shape.
  housekeepers: AvailableHousekeeper[];
};

/** Real-time housekeeper availability for the reassignment modal. */
export async function fetchAvailableHousekeepers(params: {
  // Field/property in this shape.
  locationId: string;
  // Field/property in this shape.
  taskId?: string;
// Open multi-line construct.
}): Promise<AvailableHousekeepersResponse> {
  // Return computed result to caller.
  return apiGet(
    // Open multi-line construct.
    `/cleaning/available-housekeepers${buildQuery({
      // Field/property in this shape.
      locationId: params.locationId,
      // Field/property in this shape.
      taskId: params.taskId,
    // Continue multi-line list/arguments.
    })}`,
  );
}

/** Sessions past the overdue threshold (Control / review surfaces). */
export async function fetchOverdueSessions(init?: {
  // Field/property in this shape.
  signal?: AbortSignal;
// Open multi-line construct.
}): Promise<OverdueSession[]> {
  // Return computed result to caller.
  return apiGet("/cleaning/sessions/review", init);
}

// Export type alias for consumers.
export type CleaningServiceType =
  // Union/intersection type member.
  | "stayover"
  // Union/intersection type member.
  | "departure"
  // Union/intersection type member.
  | "arrival"
  // Union/intersection type member.
  | "common_area";

// Export type alias for consumers.
export type CleaningResultsRow = {
  // Field/property in this shape.
  employeeId: string;
  // Field/property in this shape.
  fullName: string;
  // Field/property in this shape.
  employeeNumber: string;
  // Field/property in this shape.
  completedSessions: number;
  // Field/property in this shape.
  completedTasks: number;
  // Field/property in this shape.
  acceptedTasks: number;
  // Field/property in this shape.
  reworkEvents: number;
  // Field/property in this shape.
  anomalousSessions: number;
  // Field/property in this shape.
  distinctRooms: number;
  // Field/property in this shape.
  onTimePct: number | null;
  // Field/property in this shape.
  avgValidMinutes: number | null;
  // Field/property in this shape.
  totalValidSessionMinutes: number;
  // Field/property in this shape.
  totalExcludedSessionMinutes: number;
};

// Export type alias for consumers.
export type CleaningResultsResponse = {
  // Field/property in this shape.
  period: { from: string; to: string };
  // Field/property in this shape.
  summary: {
    // Field/property in this shape.
    housekeeperCount: number;
    // Field/property in this shape.
    completedSessions: number;
    // Field/property in this shape.
    completedTasks: number;
    // Field/property in this shape.
    acceptedTasks: number;
    // Field/property in this shape.
    reworkEvents: number;
    // Field/property in this shape.
    anomalousSessions: number;
    // Field/property in this shape.
    distinctRooms: number;
    // Field/property in this shape.
    onTimePct: number | null;
    // Field/property in this shape.
    productivity: number | null;
    // Field/property in this shape.
    totalValidSessionMinutes: number;
    // Field/property in this shape.
    totalExcludedSessionMinutes: number;
    // Field/property in this shape.
    byServiceType: Array<{ key: CleaningServiceType; count: number }>;
  };
  // Field/property in this shape.
  series: Array<{ hour: number; completedSessions: number }>;
  // Field/property in this shape.
  rows: CleaningResultsRow[];
  // Field/property in this shape.
  page: number;
  // Field/property in this shape.
  pageSize: number;
  // Field/property in this shape.
  total: number;
};

/**
 * Housekeeping productivity results for a date range (paginated rows + summary).
 * `serviceType` may be one value or a comma-joined list.
 */
export async function fetchCleaningResults(params: {
  // Field/property in this shape.
  from: string;
  // Field/property in this shape.
  to: string;
  // Field/property in this shape.
  page?: number;
  // Field/property in this shape.
  pageSize?: number;
  // Field/property in this shape.
  serviceType?: CleaningServiceType | CleaningServiceType[];
// Open multi-line construct.
}): Promise<CleaningResultsResponse> {
  // Mutable local binding.
  let serviceType: string | undefined;
  // Conditional branch for this case.
  if (params.serviceType) {
    // Local constant binding.
    const types = Array.isArray(params.serviceType)
      // Continue module logic.
      ? params.serviceType
      // Continue module logic.
      : [params.serviceType];
    // Conditional branch for this case.
    if (types.length) serviceType = types.join(",");
  }
  // Return computed result to caller.
  return apiGet(
    // Open multi-line construct.
    `/cleaning/results${buildQuery({
      // Field/property in this shape.
      from: params.from,
      // Field/property in this shape.
      to: params.to,
      // Field/property in this shape.
      page: params.page ?? 1,
      // Field/property in this shape.
      pageSize: params.pageSize ?? 25,
      // List item in import/export/params.
      serviceType,
    // Continue multi-line list/arguments.
    })}`,
  );
}
