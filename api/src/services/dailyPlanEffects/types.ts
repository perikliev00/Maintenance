import {
  CleaningStatus,
  LocationKind,
  Occupancy,
  Prisma,
} from "@prisma/client";

export type Tx = Prisma.TransactionClient;

export type LocationRow = {
  id: string;
  kind: LocationKind;
  catalogStatus: string;
  cleaningStatus: CleaningStatus;
  occupancy: Occupancy;
};

export type TaskEffect = "created" | "linked" | "bumped" | "skipped";

export type PlanEffects = {
  occupancy: "vacant" | null;
  dirty: boolean;
  task: TaskEffect;
  cleaningTaskId: string | null;
  roomEffectsApplied: boolean;
};

export type DepartureRoomEffectsResult = {
  hotelDate: string;
  applied: number;
  skipped: number;
  deferred: number;
  deferredEntryIds: string[];
  total: number;
};

export type DepartureRoomEffectsDecision = "apply" | "protect" | "defer";
