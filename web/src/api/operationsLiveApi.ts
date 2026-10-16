/** Snapshot payload for the operations live board (sessions + attention queue). */
import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

// Module export.
export type LiveBoardLocation = {
  id: string;
  number: string;
  kind: string;
  buildingCode: string;
  floor: number;
};

// Module export.
export type LiveBoardEmployee = {
  id: string;
  fullName: string;
  employeeNumber: string;
};

// Module export.
export type LiveActiveSession = {
  sessionId: string;
  taskId: string;
  startedAt: string;
  elapsedMinutes: number;
  overdue: boolean;
  anomaly: boolean;
  employee: LiveBoardEmployee;
  location: LiveBoardLocation;
};

// Module export.
export type LiveCompletedSession = {
  sessionId: string;
  taskId: string;
  startedAt: string;
  finishedAt: string;
  durationMinutes: number;
  employee: LiveBoardEmployee;
  location: LiveBoardLocation;
};

export type LiveNeedsAttention = {
  kind: "awaiting_inspection" | "past_due" | "blocking_ticket";
  id: string;
  title: string;
  location: LiveBoardLocation;
  employee: LiveBoardEmployee | null;
  dueAt: string | null;
  priority: string | null;
  status: string;
};

export type LiveAuditItem = {
  at: string;
  type: string;
  summary: string;
  locationNumber: string | null;
  entityId: string;
  actorName?: string | null;
};

export type OperationsLive = {
  updatedAt: string;
  overdueThresholdMinutes: number;
  anomalyThresholdMinutes: number;
  activeSessions: LiveActiveSession[];
  recentlyCompleted: LiveCompletedSession[];
  needsAttention: LiveNeedsAttention[];
  auditFeed: LiveAuditItem[];
  counts: {
    active: number;
    overdue: number;
    anomalies: number;
    awaitingInspection: number;
    blockingTickets: number;
  };
};

/**
 * One-shot live board snapshot (active sessions, attention queue, audit feed).
 * Prefer SSE via `liveEvents` for continuous updates; this is the initial load.
 */
export async function fetchOperationsLive(): Promise<OperationsLive> {
  // Initial board load; continuous updates come from `subscribeLiveEvents`.
  const res = await apiFetch(`${API_BASE}/operations/live`, {
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}
