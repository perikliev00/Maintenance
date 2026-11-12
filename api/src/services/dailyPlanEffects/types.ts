/**
 * Shared types for plan-entry side effects and departure room-effect jobs.
 */
import {
  // Carry this field through the payload or query.
  CleaningStatus,
  // Carry this field through the payload or query.
  LocationKind,
  // Carry this field through the payload or query.
  Occupancy,
// Execute: } from "@prisma/client";
} from "@prisma/client";
// Type-only import from ../db/types used by dailyPlanEffects/types.ts.
import type { Tx } from "../db/types";

// Expose selected types from this module.
export type { Tx };

/** Minimal location fields needed to apply plan effects. */
export type LocationRow = {
  // Carry this field through the payload or query.
  id: string;
  // Carry this field through the payload or query.
  kind: LocationKind;
  // Carry this field through the payload or query.
  catalogStatus: string;
  // Carry this field through the payload or query.
  cleaningStatus: CleaningStatus;
  // Carry this field through the payload or query.
  occupancy: Occupancy;
};

/** How the plan entry interacted with cleaning work for the room/date. */
export type TaskEffect = "created" | "linked" | "bumped" | "skipped";

/** Summary of occupancy/dirty/task outcomes from {@link applyPlanEntryEffects}. */
export type PlanEffects = {
  // Field value required by this payload or query.
  occupancy: "vacant" | null;
  // Carry this field through the payload or query.
  dirty: boolean;
  // Carry this field through the payload or query.
  task: TaskEffect;
  // Field value required by this payload or query.
  cleaningTaskId: string | null;
  // Carry this field through the payload or query.
  roomEffectsApplied: boolean;
};

/** Counts from a batch departure room-effects run. */
export type DepartureRoomEffectsResult = {
  // Carry this field through the payload or query.
  hotelDate: string;
  // Carry this field through the payload or query.
  applied: number;
  // Carry this field through the payload or query.
  skipped: number;
  // Carry this field through the payload or query.
  deferred: number;
  // Carry this field through the payload or query.
  deferredEntryIds: string[];
  // Carry this field through the payload or query.
  total: number;
};

/**
 * apply = vacant+dirty; protect = newer stay proven; defer = wait for confirm.
 */
export type DepartureRoomEffectsDecision = "apply" | "protect" | "defer";
