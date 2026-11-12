/** Audit event log fetch (display labels live in `../audit/labels`). */
import { apiGet, buildQuery } from "./http";

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
  return apiGet(
    `/audit-events${buildQuery({
      entityType: params?.entityType,
      entityId: params?.entityId,
      locationId: params?.locationId,
      actorEmployeeId: params?.actorEmployeeId,
      action: params?.action,
      from: params?.from,
      to: params?.to,
      limit: params?.limit,
    })}`,
  );
}
