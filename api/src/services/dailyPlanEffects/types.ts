/**
 * Shared types for plan-entry side effects and departure room-effect jobs.
 */
import {
  CleaningStatus,
  LocationKind,
  Occupancy,
  Prisma,
} from "@prisma/client";

export type Tx = Prisma.TransactionClient;

/** Minimal location fields needed to apply plan effects. */
export type LocationRow = {
  id: string;
  kind: LocationKind;
  catalogStatus: string;
  cleaningStatus: CleaningStatus;
  occupancy: Occupancy;
};

/** How the plan entry interacted with cleaning work for the room/date. */
export type TaskEffect = "created" | "linked" | "bumped" | "skipped";

/** Summary of occupancy/dirty/task outcomes from {@link applyPlanEntryEffects}. */
export type PlanEffects = {
  occupancy: "vacant" | null;
  dirty: boolean;
  task: TaskEffect;
  cleaningTaskId: string | null;
  roomEffectsApplied: boolean;
};

/** Counts from a batch departure room-effects run. */
export type DepartureRoomEffectsResult = {
  hotelDate: string;
  applied: number;
  skipped: number;
  deferred: number;
  deferredEntryIds: string[];
  total: number;
};

/**
 * apply = vacant+dirty; protect = newer stay proven; defer = wait for confirm.
 */
export type DepartureRoomEffectsDecision = "apply" | "protect" | "defer";
