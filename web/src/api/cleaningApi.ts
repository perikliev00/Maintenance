/**
 * Housekeeping tasks, sessions, inspections, and results REST helpers.
 * Start/complete that must work offline should use `../offline` queued wrappers;
 * those send `commandId` + optional `expectedVersion` for optimistic concurrency.
 */
import { apiGet, apiPost, buildQuery } from "./http";

export type OverdueSession = {
  sessionId: string;
  taskId: string;
  startedAt: string;
  elapsedMinutes: number;
  employee: { id: string; fullName: string; employeeNumber: string };
  room: { id: string; number: string; buildingCode: string; floor: number };
};

export type CleaningTaskRow = {
  id: string;
  locationId: string;
  hotelDate: string;
  priority: string;
  status: string;
  version: number;
  assignedEmployeeId: string | null;
  shiftId?: string | null;
  reassignReason: string | null;
  location: {
    id: string;
    number: string;
    kind: string;
    floor: { number: number; building: { code: string; name: string } };
  };
  assignedEmployee: {
    id: string;
    fullName: string;
    employeeNumber: string;
  } | null;
  shift?: {
    id: string;
    code: string;
    nameBg: string;
    nameEn: string;
    startTime: string;
    endTime: string;
  } | null;
  sessions: Array<{
    id: string;
    employeeId: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    notes: string | null;
  }>;
  inspections: Array<{
    id: string;
    result: string;
    findings: string | null;
    inspectedAt: string;
    inspector?: { id: string; fullName: string; employeeNumber: string };
  }>;
};

/** Create a housekeeping task for a location on a hotel date. */
export async function createCleaningTask(input: {
  locationId: string;
  hotelDate: string;
  priority?: string;
  assignedEmployeeId?: string;
  shiftId?: string | null;
  dueAt?: string;
  serviceType?: CleaningServiceType;
}) {
  return apiPost("/cleaning/tasks", input);
}

/**
 * Online start. Pass `expectedVersion` from the task row to detect concurrent
 * reassignment; omit only when the caller does not have a version yet.
 */
export async function startCleaningTask(taskId: string, expectedVersion?: number) {
  return apiPost(`/cleaning/tasks/${taskId}/start`, {
    commandId: crypto.randomUUID(),
    expectedVersion,
  });
}

/** Complete a running session; optional notes and optimistic version. */
export async function completeCleaningSession(
  sessionId: string,
  notes?: string,
  expectedVersion?: number,
) {
  return apiPost(`/cleaning/sessions/${sessionId}/complete`, {
    commandId: crypto.randomUUID(),
    ...(notes?.trim() ? { notes: notes.trim() } : {}),
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  });
}

/** Cancel a running session without marking the room cleaned. */
export async function cancelCleaningSession(
  sessionId: string,
  notes?: string,
  expectedVersion?: number,
) {
  return apiPost(`/cleaning/sessions/${sessionId}/cancel`, {
    commandId: crypto.randomUUID(),
    ...(notes?.trim() ? { notes: notes.trim() } : {}),
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  });
}

/** Supervisor inspection: approve or reject a completed task. */
export async function inspectCleaningTask(
  taskId: string,
  result: "approved" | "rejected",
  findings?: string,
  expectedVersion?: number,
) {
  return apiPost(`/cleaning/tasks/${taskId}/inspect`, {
    commandId: crypto.randomUUID(),
    result,
    findings,
    ...(expectedVersion !== undefined ? { expectedVersion } : {}),
  });
}

/** Reassign a task to another housekeeper; reason is required for audit. */
export async function reassignCleaningTask(
  taskId: string,
  assignedEmployeeId: string,
  reason: string,
  expectedVersion?: number,
  shiftId?: string | null,
  forceDespiteAvailability?: boolean,
) {
  return apiPost(`/cleaning/tasks/${taskId}/reassign`, {
    assignedEmployeeId,
    reason,
    expectedVersion,
    ...(shiftId !== undefined ? { shiftId } : {}),
    ...(forceDespiteAvailability === true
      ? { forceDespiteAvailability: true }
      : {}),
  });
}

export type HousekeeperAvailabilityStatus =
  | "available"
  | "busy"
  | "on_break"
  | "off_shift"
  | "absent"
  | "unknown";

export type AvailableHousekeeper = {
  employeeId: string;
  fullName: string;
  employeeNumber: string;
  availabilityStatus: HousekeeperAvailabilityStatus;
  availabilityReasons: string[];
  currentShift: {
    id: string;
    code: string;
    nameBg: string;
    nameEn: string;
    startTime: string;
    endTime: string;
  } | null;
  currentRunningTask: {
    taskId: string;
    locationId: string;
    locationNumber: string;
  } | null;
  assignedTaskCount: number;
  sectorEligibility: "hotel_wide";
  checkedAt: string;
};

export type AvailableHousekeepersResponse = {
  locationId: string;
  taskId: string | null;
  hotelDate: string;
  checkedAt: string;
  housekeepers: AvailableHousekeeper[];
};

/** Real-time housekeeper availability for the reassignment modal. */
export async function fetchAvailableHousekeepers(params: {
  locationId: string;
  taskId?: string;
}): Promise<AvailableHousekeepersResponse> {
  return apiGet(
    `/cleaning/available-housekeepers${buildQuery({
      locationId: params.locationId,
      taskId: params.taskId,
    })}`,
  );
}

/** Sessions past the overdue threshold (Control / review surfaces). */
export async function fetchOverdueSessions(init?: {
  signal?: AbortSignal;
}): Promise<OverdueSession[]> {
  return apiGet("/cleaning/sessions/review", init);
}

export type CleaningServiceType =
  | "stayover"
  | "departure"
  | "arrival"
  | "common_area";

export type CleaningResultsRow = {
  employeeId: string;
  fullName: string;
  employeeNumber: string;
  completedSessions: number;
  completedTasks: number;
  acceptedTasks: number;
  reworkEvents: number;
  anomalousSessions: number;
  distinctRooms: number;
  onTimePct: number | null;
  avgValidMinutes: number | null;
  totalValidSessionMinutes: number;
  totalExcludedSessionMinutes: number;
};

export type CleaningResultsResponse = {
  period: { from: string; to: string };
  summary: {
    housekeeperCount: number;
    completedSessions: number;
    completedTasks: number;
    acceptedTasks: number;
    reworkEvents: number;
    anomalousSessions: number;
    distinctRooms: number;
    onTimePct: number | null;
    productivity: number | null;
    totalValidSessionMinutes: number;
    totalExcludedSessionMinutes: number;
    byServiceType: Array<{ key: CleaningServiceType; count: number }>;
  };
  series: Array<{ hour: number; completedSessions: number }>;
  rows: CleaningResultsRow[];
  page: number;
  pageSize: number;
  total: number;
};

/**
 * Housekeeping productivity results for a date range (paginated rows + summary).
 * `serviceType` may be one value or a comma-joined list.
 */
export async function fetchCleaningResults(params: {
  from: string;
  to: string;
  page?: number;
  pageSize?: number;
  serviceType?: CleaningServiceType | CleaningServiceType[];
}): Promise<CleaningResultsResponse> {
  let serviceType: string | undefined;
  if (params.serviceType) {
    const types = Array.isArray(params.serviceType)
      ? params.serviceType
      : [params.serviceType];
    if (types.length) serviceType = types.join(",");
  }
  return apiGet(
    `/cleaning/results${buildQuery({
      from: params.from,
      to: params.to,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 25,
      serviceType,
    })}`,
  );
}
