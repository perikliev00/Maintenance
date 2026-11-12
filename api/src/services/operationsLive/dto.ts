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
  // Set id on the structure being built.
  id: string;
  // Set number on the structure being built.
  number: string;
  // Set kind on the structure being built.
  kind: string;
  // Set floor on the structure being built.
  floor: { number: number; building: { code: string } };
// Run next step: }) {
}) {
  // Return the computed result to the caller.
  return {
    // Set id on the structure being built.
    id: location.id,
    // Set number on the structure being built.
    number: location.number,
    // Set kind on the structure being built.
    kind: location.kind,
    // Set buildingCode on the structure being built.
    buildingCode: location.floor.building.code,
    // Set floor on the structure being built.
    floor: location.floor.number,
  };
}

/**
 * Compact employee DTO for live cards.
 * Same shape used for session assignees and needs-attention rows.
 */
export function employeePayload(employee: {
  // Set id on the structure being built.
  id: string;
  // Set fullName on the structure being built.
  fullName: string;
  // Set employeeNumber on the structure being built.
  employeeNumber: string;
// Run next step: }) {
}) {
  // Return the computed result to the caller.
  return {
    // Set id on the structure being built.
    id: employee.id,
    // Set fullName on the structure being built.
    fullName: employee.fullName,
    // Set employeeNumber on the structure being built.
    employeeNumber: employee.employeeNumber,
  };
}

// Export locationInclude for reuse by other modules.
export const locationInclude = locationWithBuildingInclude;

// Export taskListInclude for reuse by other modules.
export const taskListInclude = {
  // Set location on the structure being built.
  location: { include: locationInclude },
  // Set assignedEmployee on the structure being built.
  assignedEmployee: true,
// Run next step: } as const;
} as const;

// Declare type NeedsItem for callers and internals.
export type NeedsItem = {
  // Set kind on the structure being built.
  kind: NeedsAttentionKind;
  // Set id on the structure being built.
  id: string;
  /** Stable i18n key; client localizes. Free-text ticket titles use "custom". */
  titleKey: "inspection_needed" | "past_due" | "custom";
  // Set title on the structure being built.
  title: string;
  // Set location on the structure being built.
  location: ReturnType<typeof locationPayload>;
  // Set employee on the structure being built.
  employee: ReturnType<typeof employeePayload> | null;
  // Set dueAt on the structure being built.
  dueAt: string | null;
  // Set priority on the structure being built.
  priority: string | null;
  // Set status on the structure being built.
  status: string;
};

// Declare type AttentionPageMeta for callers and internals.
export type AttentionPageMeta = {
  // Set total on the structure being built.
  total: number;
  // Set returned on the structure being built.
  returned: number;
  // Set hasMore on the structure being built.
  hasMore: boolean;
  // Set nextCursor on the structure being built.
  nextCursor: string | null;
};
