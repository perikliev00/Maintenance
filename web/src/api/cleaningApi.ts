import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

export type OverdueSession = {
  sessionId: string;
  taskId: string;
  startedAt: string;
  elapsedMinutes: number;
  employee: { id: string; fullName: string; employeeNumber: string };
  room: { id: string; number: string; buildingCode: string; floor: number };
};

export async function fetchCleaningTasks(params?: {
  mine?: boolean;
  hotelDate?: string;
  status?: string;
}): Promise<CleaningTaskRow[]> {
  const search = new URLSearchParams();
  if (params?.mine) search.set("mine", "1");
  if (params?.hotelDate) search.set("hotelDate", params.hotelDate);
  if (params?.status) search.set("status", params.status);
  const qs = search.toString();
  const res = await apiFetch(`${API_BASE}/cleaning/tasks${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
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

export async function createCleaningTask(input: {
  locationId: string;
  hotelDate: string;
  priority?: string;
  assignedEmployeeId?: string;
  shiftId?: string | null;
  dueAt?: string;
  serviceType?: CleaningServiceType;
}) {
  const res = await apiFetch(`${API_BASE}/cleaning/tasks`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function startCleaningTask(taskId: string, expectedVersion?: number) {
  const res = await apiFetch(`${API_BASE}/cleaning/tasks/${taskId}/start`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      expectedVersion,
    }),
  });
  return parseJson(res);
}

export async function completeCleaningSession(
  sessionId: string,
  notes?: string,
  expectedVersion?: number,
) {
  const res = await apiFetch(`${API_BASE}/cleaning/sessions/${sessionId}/complete`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      ...(notes?.trim() ? { notes: notes.trim() } : {}),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    }),
  });
  return parseJson(res);
}

export async function cancelCleaningSession(
  sessionId: string,
  notes?: string,
  expectedVersion?: number,
) {
  const res = await apiFetch(`${API_BASE}/cleaning/sessions/${sessionId}/cancel`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      ...(notes?.trim() ? { notes: notes.trim() } : {}),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    }),
  });
  return parseJson(res);
}

export async function inspectCleaningTask(
  taskId: string,
  result: "approved" | "rejected",
  findings?: string,
  expectedVersion?: number,
) {
  const res = await apiFetch(`${API_BASE}/cleaning/tasks/${taskId}/inspect`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      result,
      findings,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    }),
  });
  return parseJson(res);
}

export async function reassignCleaningTask(
  taskId: string,
  assignedEmployeeId: string,
  reason: string,
  expectedVersion?: number,
  shiftId?: string | null,
) {
  const res = await apiFetch(`${API_BASE}/cleaning/tasks/${taskId}/reassign`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      assignedEmployeeId,
      reason,
      expectedVersion,
      ...(shiftId !== undefined ? { shiftId } : {}),
    }),
  });
  return parseJson(res);
}

export async function fetchOverdueSessions(init?: {
  signal?: AbortSignal;
}): Promise<OverdueSession[]> {
  const res = await apiFetch(`${API_BASE}/cleaning/sessions/review`, {
    headers: authHeaders(),
    signal: init?.signal,
  });
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

export async function fetchCleaningResults(params: {
  from: string;
  to: string;
  page?: number;
  pageSize?: number;
  serviceType?: CleaningServiceType | CleaningServiceType[];
}): Promise<CleaningResultsResponse> {
  const q = new URLSearchParams({
    from: params.from,
    to: params.to,
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 25),
  });
  if (params.serviceType) {
    const types = Array.isArray(params.serviceType)
      ? params.serviceType
      : [params.serviceType];
    if (types.length) q.set("serviceType", types.join(","));
  }
  const res = await apiFetch(`${API_BASE}/cleaning/results?${q}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}
