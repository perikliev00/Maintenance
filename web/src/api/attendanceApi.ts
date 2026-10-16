/** Attendance intervals, CSV export, and adjustment request/review. */
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

/**
 * Paginated attendance intervals for a scope (month/today/week/review).
 * `maxClockSkewSeconds` comes from ops settings for client clock warnings.
 */
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
  // Optional filters + cursor pagination.
  const search = new URLSearchParams();
  // Branch: conditional gate.
  if (params?.scope) search.set("scope", params.scope);
  // Branch: conditional gate.
  if (params?.month) search.set("month", params.month);
  // Branch: conditional gate.
  if (params?.department) search.set("department", params.department);
  // Branch: conditional gate.
  if (params?.q) search.set("q", params.q);
  // Branch: conditional gate.
  if (params?.limit != null) search.set("limit", String(params.limit));
  // Branch: conditional gate.
  if (params?.cursor) search.set("cursor", params.cursor);
  // Optional query suffix.
  const qs = search.toString();
  // Authenticated HTTP request.
  const res = await apiFetch(
    `${API_BASE}/attendance/intervals${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() },
  );
  // Return value / early exit.
  return parseJson(res);
}

/**
 * Trigger a browser download of attendance CSV.
 * Truncation / total come from response headers (large exports may be capped).
 */
export async function downloadAttendanceCsv(params?: {
  scope?: AttendanceScope;
  month?: string;
  department?: string;
  q?: string;
}): Promise<{ truncated: boolean; total: number | null }> {
  // Same filters as the intervals list (no cursor — full export for the scope).
  const search = new URLSearchParams();
  // Branch: conditional gate.
  if (params?.scope) search.set("scope", params.scope);
  // Branch: conditional gate.
  if (params?.month) search.set("month", params.month);
  // Branch: conditional gate.
  if (params?.department) search.set("department", params.department);
  // Branch: conditional gate.
  if (params?.q) search.set("q", params.q);
  // Optional query suffix.
  const qs = search.toString();
  // Authenticated HTTP request.
  const res = await apiFetch(
    `${API_BASE}/attendance/export.csv${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() },
  );
  // CSV path bypasses parseJson — surface API message on failure.
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Throw error path.
    throw new Error(
      (body as { message?: string }).message ?? `Export failed (${res.status})`,
    );
  }
  // Truncation / total are signaled via custom headers, not the body.
  const truncated =
    res.headers.get("X-Attendance-Truncated")?.toLowerCase() === "true";
  const totalRaw = res.headers.get("X-Attendance-Total");
  const totalParsed = totalRaw != null ? Number(totalRaw) : NaN;
  const total = Number.isFinite(totalParsed) ? totalParsed : null;
  // Trigger a browser download without navigating away.
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "attendance.csv";
  a.click();
  URL.revokeObjectURL(url);
  // Return value / early exit.
  return { truncated, total };
}

/** Submit a proposed time correction for an interval (pending until review). */
export async function requestAttendanceAdjustment(body: {
  intervalId: string;
  reason: string;
  proposedStartedAt?: string;
  proposedEndedAt?: string;
  proposedBreakMinutes?: number;
}) {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/attendance/adjustments`, {
    method: "POST",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify(body),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Approve or reject a pending adjustment (manager / attendance review). */
export async function reviewAttendanceAdjustment(
  id: string,
  body: { decision: "approved" | "rejected"; reason?: string },
) {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/attendance/adjustments/${id}/review`, {
    method: "POST",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify(body),
  });
  // Return value / early exit.
  return parseJson(res);
}
