/** Audit event log fetch (display labels live in `../audit/labels`). */
import { apiGet, buildQuery } from "./http";

// Export type alias for consumers.
export type AuditEventRow = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  action: string;
  // Field/property in this shape.
  entityType: string;
  // Field/property in this shape.
  entityId: string;
  // Field/property in this shape.
  occurredAt: string;
  // Field/property in this shape.
  reason: string | null;
  // Field/property in this shape.
  before: unknown;
  // Field/property in this shape.
  after: unknown;
  // Field/property in this shape.
  locationId: string | null;
  // Field/property in this shape.
  summary: string | null;
  // Field/property in this shape.
  actor: { id: string; fullName: string; employeeNumber: string } | null;
};

/**
 * Fetch audit events with optional entity / location / actor / date filters.
 * Labels for `action` codes are resolved client-side via `../audit/labels`.
 */
export async function fetchAuditEvents(params?: {
  // Field/property in this shape.
  entityType?: string;
  // Field/property in this shape.
  entityId?: string;
  // Field/property in this shape.
  locationId?: string;
  // Field/property in this shape.
  actorEmployeeId?: string;
  // Field/property in this shape.
  action?: string;
  // Field/property in this shape.
  from?: string;
  // Field/property in this shape.
  to?: string;
  // Field/property in this shape.
  limit?: number;
// Open multi-line construct.
}): Promise<AuditEventRow[]> {
  // Return computed result to caller.
  return apiGet(
    // Open multi-line construct.
    `/audit-events${buildQuery({
      // Field/property in this shape.
      entityType: params?.entityType,
      // Field/property in this shape.
      entityId: params?.entityId,
      // Field/property in this shape.
      locationId: params?.locationId,
      // Field/property in this shape.
      actorEmployeeId: params?.actorEmployeeId,
      // Field/property in this shape.
      action: params?.action,
      // Field/property in this shape.
      from: params?.from,
      // Field/property in this shape.
      to: params?.to,
      // Field/property in this shape.
      limit: params?.limit,
    // Continue multi-line list/arguments.
    })}`,
  );
}
