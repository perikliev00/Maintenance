import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

export type AttendanceScope = "month" | "today" | "week" | "review";

export type AttendanceInterval = {
  id: string;
  employeeId: string;
  employee: {
    id: string;
    fullName: string;
    employeeNumber: string;
    department: string | null;
  };
  hotelDate: string;
  startedAt: string;
  endedAt: string | null;
  breakMinutes: number;
  workedMinutes: number | null;
  status: "open" | "closed" | "needs_review" | "adjusted";
  anomalyFlags: string[];
  startEventId: string | null;
  endEventId: string | null;
  adjustments: Array<{
    id: string;
    status: "pending" | "approved" | "rejected";
    reason: string;
    proposedStartedAt: string | null;
    proposedEndedAt: string | null;
    proposedBreakMinutes: number | null;
    requestedBy: { id: string; fullName: string; employeeNumber: string };
    reviewedBy: { id: string; fullName: string; employeeNumber: string } | null;
    createdAt: string;
    reviewedAt: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
};

export async function fetchAttendanceIntervals(params?: {
  scope?: AttendanceScope;
  month?: string;
  department?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}): Promise<{
  intervals: AttendanceInterval[];
  total: number;
  nextCursor: string | null;
  limit: number;
  maxClockSkewSeconds: number | null;
}> {
  const search = new URLSearchParams();
  if (params?.scope) search.set("scope", params.scope);
  if (params?.month) search.set("month", params.month);
  if (params?.department) search.set("department", params.department);
  if (params?.q) search.set("q", params.q);
  if (params?.limit != null) search.set("limit", String(params.limit));
  if (params?.cursor) search.set("cursor", params.cursor);
  const qs = search.toString();
  const res = await apiFetch(
    `${API_BASE}/attendance/intervals${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() },
  );
  return parseJson(res);
}

export async function downloadAttendanceCsv(params?: {
  scope?: AttendanceScope;
  month?: string;
  department?: string;
  q?: string;
}): Promise<{ truncated: boolean; total: number | null }> {
  const search = new URLSearchParams();
  if (params?.scope) search.set("scope", params.scope);
  if (params?.month) search.set("month", params.month);
  if (params?.department) search.set("department", params.department);
  if (params?.q) search.set("q", params.q);
  const qs = search.toString();
  const res = await apiFetch(
    `${API_BASE}/attendance/export.csv${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { message?: string }).message ?? `Export failed (${res.status})`,
    );
  }
  const truncated =
    res.headers.get("X-Attendance-Truncated")?.toLowerCase() === "true";
  const totalRaw = res.headers.get("X-Attendance-Total");
  const totalParsed = totalRaw != null ? Number(totalRaw) : NaN;
  const total = Number.isFinite(totalParsed) ? totalParsed : null;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "attendance.csv";
  a.click();
  URL.revokeObjectURL(url);
  return { truncated, total };
}

export async function requestAttendanceAdjustment(body: {
  intervalId: string;
  reason: string;
  proposedStartedAt?: string;
  proposedEndedAt?: string;
  proposedBreakMinutes?: number;
}) {
  const res = await apiFetch(`${API_BASE}/attendance/adjustments`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function reviewAttendanceAdjustment(
  id: string,
  body: { decision: "approved" | "rejected"; reason?: string },
) {
  const res = await apiFetch(`${API_BASE}/attendance/adjustments/${id}/review`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  return parseJson(res);
}
