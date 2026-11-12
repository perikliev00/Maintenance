/** Snapshot payload for the operations live board (sessions + attention queue). */
import { apiGet, buildQuery } from "./http";

export type LiveBoardLocation = {
  id: string;
  number: string;
  kind: string;
  buildingCode: string;
  floor: number;
};

export type LiveBoardEmployee = {
  id: string;
  fullName: string;
  employeeNumber: string;
};

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
  titleKey?: "inspection_needed" | "past_due" | "custom";
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

export type AttentionPageMeta = {
  total: number;
  returned: number;
  hasMore: boolean;
  nextCursor: string | null;
};

export type OperationsLive = {
  updatedAt: string;
  overdueThresholdMinutes: number;
  anomalyThresholdMinutes: number;
  activeSessions: LiveActiveSession[];
  recentlyCompleted: LiveCompletedSession[];
  needsAttention: LiveNeedsAttention[];
  attention?: {
    awaitingInspection: AttentionPageMeta;
    pastDue: AttentionPageMeta;
    blockingTickets: AttentionPageMeta;
  };
  auditFeed: LiveAuditItem[];
  counts: {
    active: number;
    overdue: number;
    anomalies: number;
    awaitingInspection: number;
    blockingTickets: number;
  };
};

export type LiveAttentionPage = {
  kind: LiveNeedsAttention["kind"];
  items: LiveNeedsAttention[];
  total: number;
  returned: number;
  hasMore: boolean;
  nextCursor: string | null;
};

/**
 * One-shot live board snapshot (active sessions, attention queue, audit feed).
 */
export async function fetchOperationsLive(
  init?: { signal?: AbortSignal },
): Promise<OperationsLive> {
  return apiGet("/operations/live", init);
}

/** Next page of one needs-attention kind (does not reload the whole board). */
export async function fetchOperationsLiveAttention(params: {
  kind: LiveNeedsAttention["kind"];
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
}): Promise<LiveAttentionPage> {
  return apiGet(
    `/operations/live/attention${buildQuery({
      kind: params.kind,
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    })}`,
    { signal: params.signal },
  );
}
