/** Attendance intervals, CSV export, and adjustment request/review. */
import { API_BASE, apiFetch, apiGet, apiPost, authHeaders, buildQuery } from "./http";

// Export type alias for consumers.
export type AttendanceScope = "month" | "today" | "week" | "review";

// Export type alias for consumers.
export type AttendanceInterval = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  employeeId: string;
  // Field/property in this shape.
  employee: {
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    fullName: string;
    // Field/property in this shape.
    employeeNumber: string;
    // Field/property in this shape.
    department: string | null;
  };
  // Field/property in this shape.
  hotelDate: string;
  // Field/property in this shape.
  startedAt: string;
  // Field/property in this shape.
  endedAt: string | null;
  // Field/property in this shape.
  breakMinutes: number;
  // Field/property in this shape.
  workedMinutes: number | null;
  // Field/property in this shape.
  status: "open" | "closed" | "needs_review" | "adjusted";
  // Field/property in this shape.
  anomalyFlags: string[];
  // Field/property in this shape.
  startEventId: string | null;
  // Field/property in this shape.
  endEventId: string | null;
  // Field/property in this shape.
  adjustments: Array<{
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    status: "pending" | "approved" | "rejected";
    // Field/property in this shape.
    reason: string;
    // Field/property in this shape.
    proposedStartedAt: string | null;
    // Field/property in this shape.
    proposedEndedAt: string | null;
    // Field/property in this shape.
    proposedBreakMinutes: number | null;
    // Field/property in this shape.
    requestedBy: { id: string; fullName: string; employeeNumber: string };
    // Field/property in this shape.
    reviewedBy: { id: string; fullName: string; employeeNumber: string } | null;
    // Field/property in this shape.
    createdAt: string;
    // Field/property in this shape.
    reviewedAt: string | null;
  // Close multi-line construct with trailing syntax.
  }>;
  // Field/property in this shape.
  createdAt: string;
  // Field/property in this shape.
  updatedAt: string;
};

/**
 * Paginated attendance intervals for a scope (month/today/week/review).
 * `maxClockSkewSeconds` comes from ops settings for client clock warnings.
 */
export async function fetchAttendanceIntervals(params?: {
  // Field/property in this shape.
  scope?: AttendanceScope;
  // Field/property in this shape.
  month?: string;
  // Field/property in this shape.
  department?: string;
  // Field/property in this shape.
  q?: string;
  // Field/property in this shape.
  limit?: number;
  // Field/property in this shape.
  cursor?: string;
// Open multi-line construct.
}): Promise<{
  // Field/property in this shape.
  intervals: AttendanceInterval[];
  // Field/property in this shape.
  total: number;
  // Field/property in this shape.
  nextCursor: string | null;
  // Field/property in this shape.
  limit: number;
  // Field/property in this shape.
  maxClockSkewSeconds: number | null;
// Open multi-line construct.
}> {
  // Return computed result to caller.
  return apiGet(
    // Open multi-line construct.
    `/attendance/intervals${buildQuery({
      // Field/property in this shape.
      scope: params?.scope,
      // Field/property in this shape.
      month: params?.month,
      // Field/property in this shape.
      department: params?.department,
      // Field/property in this shape.
      q: params?.q,
      // Field/property in this shape.
      limit: params?.limit,
      // Field/property in this shape.
      cursor: params?.cursor,
    // Continue multi-line list/arguments.
    })}`,
  );
}

/**
 * Trigger a browser download of attendance CSV.
 * Truncation / total come from response headers (large exports may be capped).
 */
export async function downloadAttendanceCsv(params?: {
  // Field/property in this shape.
  scope?: AttendanceScope;
  // Field/property in this shape.
  month?: string;
  // Field/property in this shape.
  department?: string;
  // Field/property in this shape.
  q?: string;
// Open multi-line construct.
}): Promise<{ truncated: boolean; total: number | null }> {
  // Local constant binding.
  const res = await apiFetch(
    // Open multi-line construct.
    `${API_BASE}/attendance/export.csv${buildQuery({
      // Field/property in this shape.
      scope: params?.scope,
      // Field/property in this shape.
      month: params?.month,
      // Field/property in this shape.
      department: params?.department,
      // Field/property in this shape.
      q: params?.q,
    // Continue multi-line list/arguments.
    })}`,
    // Invoke helper or pass arguments.
    { headers: authHeaders() },
  );
  // Conditional branch for this case.
  if (!res.ok) {
    // Local constant binding.
    const body = await res.json().catch(() => ({}));
    // Abort with an error for the caller.
    throw new Error(
      // Invoke helper or pass arguments.
      (body as { message?: string }).message ?? `Export failed (${res.status})`,
    );
  }
  // Local constant binding.
  const truncated =
    // Assign value for subsequent use.
    res.headers.get("X-Attendance-Truncated")?.toLowerCase() === "true";
  // Local constant binding.
  const totalRaw = res.headers.get("X-Attendance-Total");
  // Local constant binding.
  const totalParsed = totalRaw != null ? Number(totalRaw) : NaN;
  // Local constant binding.
  const total = Number.isFinite(totalParsed) ? totalParsed : null;
  // Local constant binding.
  const blob = await res.blob();
  // Local constant binding.
  const url = URL.createObjectURL(blob);
  // Local constant binding.
  const a = document.createElement("a");
  // Assign value for subsequent use.
  a.href = url;
  // Assign value for subsequent use.
  a.download = "attendance.csv";
  // Invoke helper or pass arguments.
  a.click();
  // Invoke helper or pass arguments.
  URL.revokeObjectURL(url);
  // Return computed result to caller.
  return { truncated, total };
}

/** Submit a proposed time correction for an interval (pending until review). */
export async function requestAttendanceAdjustment(body: {
  // Field/property in this shape.
  intervalId: string;
  // Field/property in this shape.
  reason: string;
  // Field/property in this shape.
  proposedStartedAt?: string;
  // Field/property in this shape.
  proposedEndedAt?: string;
  // Field/property in this shape.
  proposedBreakMinutes?: number;
// Open multi-line construct.
}) {
  // Return computed result to caller.
  return apiPost("/attendance/adjustments", body);
}

/** Approve or reject a pending adjustment (manager / attendance review). */
export async function reviewAttendanceAdjustment(
  // Field/property in this shape.
  id: string,
  // Field/property in this shape.
  body: { decision: "approved" | "rejected"; reason?: string },
// Open multi-line construct.
) {
  // Return computed result to caller.
  return apiPost(`/attendance/adjustments/${id}/review`, body);
}
