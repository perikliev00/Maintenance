/**
 * Compact DTO mappers and Prisma includes for operations live.
 */
import { locationWithBuildingInclude } from "../analytics/locationLabel";
// Import type(s) NeedsAttentionKind for typing without runtime cost.
import type { NeedsAttentionKind } from "../operationsLiveAttention";

/** Completions strip window (minutes). */
export const RECENTLY_COMPLETED_MINUTES = 60;
/** Audit feed lookback (hours). */
export const AUDIT_HOURS = 24;
/** Max audit rows in the live feed. */
export const AUDIT_LIMIT = 40;
/** Cap per needs-attention source query / page. */
export const NEEDS_ATTENTION_LIMIT = 50;

/**
 * Compact location DTO for live cards (building + floor flattened).
 * Avoids shipping full floor/building joins to the ops dashboard.
 */
export function locationPayload(location: {
  id: string;
  number: string;
  kind: string;
  floor: { number: number; building: { code: string } };
}) {
  return {
    id: location.id,
    number: location.number,
    kind: location.kind,
    buildingCode: location.floor.building.code,
    floor: location.floor.number,
  };
}

/**
 * Compact employee DTO for live cards.
 * Same shape used for session assignees and needs-attention rows.
 */
export function employeePayload(employee: {
  id: string;
  fullName: string;
  employeeNumber: string;
}) {
  return {
    id: employee.id,
    fullName: employee.fullName,
    employeeNumber: employee.employeeNumber,
  };
}

// Export locationInclude for reuse by other modules.
export const locationInclude = locationWithBuildingInclude;

// Export taskListInclude for reuse by other modules.
export const taskListInclude = {
  location: { include: locationInclude },
  assignedEmployee: true,
} as const;

// Declare type NeedsItem for callers and internals.
export type NeedsItem = {
  kind: NeedsAttentionKind;
  id: string;
  /** Stable i18n key; client localizes. Free-text ticket titles use "custom". */
  titleKey: "inspection_needed" | "past_due" | "custom";
  title: string;
  location: ReturnType<typeof locationPayload>;
  employee: ReturnType<typeof employeePayload> | null;
  dueAt: string | null;
  priority: string | null;
  status: string;
};

// Declare type AttentionPageMeta for callers and internals.
export type AttentionPageMeta = {
  total: number;
  returned: number;
  hasMore: boolean;
  nextCursor: string | null;
};
