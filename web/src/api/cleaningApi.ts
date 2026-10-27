/**
 * Housekeeping tasks, sessions, inspections, and results REST helpers.
 * Start/complete that must work offline should use `../offline` queued wrappers;
 * those send `commandId` + optional `expectedVersion` for optimistic concurrency.
 */
import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

export type OverdueSession = {
  sessionId: string;
  taskId: string;
  startedAt: string;
  elapsedMinutes: number;
  employee: { id: string; fullName: string; employeeNumber: string };
  room: { id: string; number: string; buildingCode: string; floor: number };
};

/** List cleaning tasks; `mine` scopes to the current employee. */
export async function fetchCleaningTasks(params?: {
  mine?: boolean;
  hotelDate?: string;
  status?: string;
}): Promise<CleaningTaskRow[]> {
  const search = new URLSearchParams();
  // Branch: conditional gate.
  if (params?.mine) search.set("mine", "1");
  // Branch: conditional gate.
  if (params?.hotelDate) search.set("hotelDate", params.hotelDate);
  // Branch: conditional gate.
  if (params?.status) search.set("status", params.status);
  // Optional query suffix.
  const qs = search.toString();
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/cleaning/tasks${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}

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
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/cleaning/tasks`, {
    method: "POST",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify(input),
  });
  // Return value / early exit.
  return parseJson(res);
}

/**
 * Online start. Pass `expectedVersion` from the task row to detect concurrent
 * reassignment; omit only when the caller does not have a version yet.
 */
export async function startCleaningTask(taskId: string, expectedVersion?: number) {
  // Fresh commandId for online-only path (offline wrappers supply their own).
  const res = await apiFetch(`${API_BASE}/cleaning/tasks/${taskId}/start`, {
    method: "POST",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      expectedVersion,
    }),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Complete a running session; optional notes and optimistic version. */
export async function completeCleaningSession(
  sessionId: string,
  notes?: string,
  expectedVersion?: number,
) {
  // Omit empty notes; include expectedVersion only when the caller has one.
  const res = await apiFetch(`${API_BASE}/cleaning/sessions/${sessionId}/complete`, {
    method: "POST",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      ...(notes?.trim() ? { notes: notes.trim() } : {}),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    }),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Cancel a running session without marking the room cleaned. */
export async function cancelCleaningSession(
  sessionId: string,
  notes?: string,
  expectedVersion?: number,
) {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/cleaning/sessions/${sessionId}/cancel`, {
    method: "POST",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      ...(notes?.trim() ? { notes: notes.trim() } : {}),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    }),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Supervisor inspection: approve or reject a completed task. */
export async function inspectCleaningTask(
  taskId: string,
  result: "approved" | "rejected",
  findings?: string,
  expectedVersion?: number,
) {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/cleaning/tasks/${taskId}/inspect`, {
    method: "POST",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      result,
      findings,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    }),
  });
  // Return value / early exit.
  return parseJson(res);
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
  // Only send shiftId when the caller explicitly wants to change/clear it.
  const res = await apiFetch(`${API_BASE}/cleaning/tasks/${taskId}/reassign`, {
    method: "POST",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify({
      assignedEmployeeId,
      reason,
      expectedVersion,
      ...(shiftId !== undefined ? { shiftId } : {}),
      ...(forceDespiteAvailability === true
        ? { forceDespiteAvailability: true }
        : {}),
    }),
  });
  // Return value / early exit.
  return parseJson(res);
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
  const search = new URLSearchParams();
  search.set("locationId", params.locationId);
  if (params.taskId) search.set("taskId", params.taskId);
  const res = await apiFetch(
    `${API_BASE}/cleaning/available-housekeepers?${search.toString()}`,
    { headers: authHeaders() },
  );
  return parseJson(res);
}

/** Sessions past the overdue threshold (Control / review surfaces). */
export async function fetchOverdueSessions(init?: {
  signal?: AbortSignal;
}): Promise<OverdueSession[]> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/cleaning/sessions/review`, {
    headers: authHeaders(),
    signal: init?.signal,
  });
  // Return value / early exit.
  return parseJson(res);
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
  // Build query string.
  const q = new URLSearchParams({
    from: params.from,
    to: params.to,
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 25),
  });
  // Normalize single vs array service types into one comma-separated query param.
  if (params.serviceType) {
    const types = Array.isArray(params.serviceType)
      ? params.serviceType
      : [params.serviceType];
    // Branch: conditional gate.
    if (types.length) q.set("serviceType", types.join(","));
  }
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/cleaning/results?${q}`, {
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}
