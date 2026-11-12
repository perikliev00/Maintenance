/** Attendance intervals, CSV export, and adjustment request/review. */
import { API_BASE, apiFetch, apiGet, apiPost, authHeaders, buildQuery } from "./http";

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
  return apiGet(
    `/attendance/intervals${buildQuery({
      scope: params?.scope,
      month: params?.month,
      department: params?.department,
      q: params?.q,
      limit: params?.limit,
      cursor: params?.cursor,
    })}`,
  );
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
  const res = await apiFetch(
    `${API_BASE}/attendance/export.csv${buildQuery({
      scope: params?.scope,
      month: params?.month,
      department: params?.department,
      q: params?.q,
    })}`,
    { headers: authHeaders() },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Abort with an error for the caller.
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

/** Submit a proposed time correction for an interval (pending until review). */
export async function requestAttendanceAdjustment(body: {
  intervalId: string;
  reason: string;
  proposedStartedAt?: string;
  proposedEndedAt?: string;
  proposedBreakMinutes?: number;
}) {
  return apiPost("/attendance/adjustments", body);
}

/** Approve or reject a pending adjustment (manager / attendance review). */
export async function reviewAttendanceAdjustment(
  id: string,
  body: { decision: "approved" | "rejected"; reason?: string },
) {
  return apiPost(`/attendance/adjustments/${id}/review`, body);
}
