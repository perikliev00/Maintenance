/** Snapshot payload for the operations live board (sessions + attention queue). */
import { apiGet, buildQuery } from "./http";

// Export type alias for consumers.
export type LiveBoardLocation = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  number: string;
  // Field/property in this shape.
  kind: string;
  // Field/property in this shape.
  buildingCode: string;
  // Field/property in this shape.
  floor: number;
};

// Export type alias for consumers.
export type LiveBoardEmployee = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  fullName: string;
  // Field/property in this shape.
  employeeNumber: string;
};

// Export type alias for consumers.
export type LiveActiveSession = {
  // Field/property in this shape.
  sessionId: string;
  // Field/property in this shape.
  taskId: string;
  // Field/property in this shape.
  startedAt: string;
  // Field/property in this shape.
  elapsedMinutes: number;
  // Field/property in this shape.
  overdue: boolean;
  // Field/property in this shape.
  anomaly: boolean;
  // Field/property in this shape.
  employee: LiveBoardEmployee;
  // Field/property in this shape.
  location: LiveBoardLocation;
};

// Export type alias for consumers.
export type LiveCompletedSession = {
  // Field/property in this shape.
  sessionId: string;
  // Field/property in this shape.
  taskId: string;
  // Field/property in this shape.
  startedAt: string;
  // Field/property in this shape.
  finishedAt: string;
  // Field/property in this shape.
  durationMinutes: number;
  // Field/property in this shape.
  employee: LiveBoardEmployee;
  // Field/property in this shape.
  location: LiveBoardLocation;
};

// Export type alias for consumers.
export type LiveNeedsAttention = {
  // Field/property in this shape.
  kind: "awaiting_inspection" | "past_due" | "blocking_ticket";
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  titleKey?: "inspection_needed" | "past_due" | "custom";
  // Field/property in this shape.
  title: string;
  // Field/property in this shape.
  location: LiveBoardLocation;
  // Field/property in this shape.
  employee: LiveBoardEmployee | null;
  // Field/property in this shape.
  dueAt: string | null;
  // Field/property in this shape.
  priority: string | null;
  // Field/property in this shape.
  status: string;
};

// Export type alias for consumers.
export type LiveAuditItem = {
  // Field/property in this shape.
  at: string;
  // Field/property in this shape.
  type: string;
  // Field/property in this shape.
  summary: string;
  // Field/property in this shape.
  locationNumber: string | null;
  // Field/property in this shape.
  entityId: string;
  // Field/property in this shape.
  actorName?: string | null;
};

// Export type alias for consumers.
export type AttentionPageMeta = {
  // Field/property in this shape.
  total: number;
  // Field/property in this shape.
  returned: number;
  // Field/property in this shape.
  hasMore: boolean;
  // Field/property in this shape.
  nextCursor: string | null;
};

// Export type alias for consumers.
export type OperationsLive = {
  // Field/property in this shape.
  updatedAt: string;
  // Field/property in this shape.
  overdueThresholdMinutes: number;
  // Field/property in this shape.
  anomalyThresholdMinutes: number;
  // Field/property in this shape.
  activeSessions: LiveActiveSession[];
  // Field/property in this shape.
  recentlyCompleted: LiveCompletedSession[];
  // Field/property in this shape.
  needsAttention: LiveNeedsAttention[];
  // Field/property in this shape.
  attention?: {
    // Field/property in this shape.
    awaitingInspection: AttentionPageMeta;
    // Field/property in this shape.
    pastDue: AttentionPageMeta;
    // Field/property in this shape.
    blockingTickets: AttentionPageMeta;
  };
  // Field/property in this shape.
  auditFeed: LiveAuditItem[];
  // Field/property in this shape.
  counts: {
    // Field/property in this shape.
    active: number;
    // Field/property in this shape.
    overdue: number;
    // Field/property in this shape.
    anomalies: number;
    // Field/property in this shape.
    awaitingInspection: number;
    // Field/property in this shape.
    blockingTickets: number;
  };
};

// Export type alias for consumers.
export type LiveAttentionPage = {
  // Field/property in this shape.
  kind: LiveNeedsAttention["kind"];
  // Field/property in this shape.
  items: LiveNeedsAttention[];
  // Field/property in this shape.
  total: number;
  // Field/property in this shape.
  returned: number;
  // Field/property in this shape.
  hasMore: boolean;
  // Field/property in this shape.
  nextCursor: string | null;
};

/**
 * One-shot live board snapshot (active sessions, attention queue, audit feed).
 */
export async function fetchOperationsLive(
  // Field/property in this shape.
  init?: { signal?: AbortSignal },
// Open multi-line construct.
): Promise<OperationsLive> {
  // Return computed result to caller.
  return apiGet("/operations/live", init);
}

/** Next page of one needs-attention kind (does not reload the whole board). */
export async function fetchOperationsLiveAttention(params: {
  // Field/property in this shape.
  kind: LiveNeedsAttention["kind"];
  // Field/property in this shape.
  cursor?: string | null;
  // Field/property in this shape.
  limit?: number;
  // Field/property in this shape.
  signal?: AbortSignal;
// Open multi-line construct.
}): Promise<LiveAttentionPage> {
  // Return computed result to caller.
  return apiGet(
    // Open multi-line construct.
    `/operations/live/attention${buildQuery({
      // Field/property in this shape.
      kind: params.kind,
      // Field/property in this shape.
      cursor: params.cursor ?? undefined,
      // Field/property in this shape.
      limit: params.limit,
    // Continue multi-line list/arguments.
    })}`,
    // Continue multi-line list/arguments.
    { signal: params.signal },
  );
}
