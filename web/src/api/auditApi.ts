/** Audit event log fetch (display labels live in `../audit/labels`). */
import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

export type AuditEventRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
  reason: string | null;
  before: unknown;
  after: unknown;
  locationId: string | null;
  summary: string | null;
  actor: { id: string; fullName: string; employeeNumber: string } | null;
};

/**
 * Fetch audit events with optional entity / location / actor / date filters.
 * Labels for `action` codes are resolved client-side via `../audit/labels`.
 */
export async function fetchAuditEvents(params?: {
  entityType?: string;
  entityId?: string;
  locationId?: string;
  actorEmployeeId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<AuditEventRow[]> {
  // Build optional query string; empty params → unfiltered list (server-capped).
  const search = new URLSearchParams();
  if (params?.entityType) search.set("entityType", params.entityType);
  if (params?.entityId) search.set("entityId", params.entityId);
  if (params?.locationId) search.set("locationId", params.locationId);
  if (params?.actorEmployeeId)
    search.set("actorEmployeeId", params.actorEmployeeId);
  if (params?.action) search.set("action", params.action);
  if (params?.from) search.set("from", params.from);
  if (params?.to) search.set("to", params.to);
  if (params?.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  const res = await apiFetch(
    `${API_BASE}/audit-events${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() },
  );
  return parseJson(res);
}
