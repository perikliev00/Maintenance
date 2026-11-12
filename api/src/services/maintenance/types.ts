/**
 * Shared Prisma types and include shape for maintenance ticket reads/writes.
 */
import { Priority, Prisma } from "@prisma/client";
// Import type(s) Tx for typing without runtime cost.
import type { Tx } from "../db/types";

/** Standard relations loaded with every ticket mutation / list response. */
export const ticketInclude = {
  // Set location on the structure being built.
  location: { include: { floor: { include: { building: true } } } },
  // Set reportedBy on the structure being built.
  reportedBy: true,
  // Set assignee on the structure being built.
  assignee: true,
  // Set resolvedBy on the structure being built.
  resolvedBy: true,
  // Set closedBy on the structure being built.
  closedBy: true,
  // Set issueOption on the structure being built.
  issueOption: true,
// Run next step: } as const;
} as const;

// Re-export selected symbols for barrel consumers.
export type { Tx };

// Declare type TicketWithRelations for callers and internals.
export type TicketWithRelations = Prisma.MaintenanceTicketGetPayload<{
  // Set include on the structure being built.
  include: typeof ticketInclude;
// Run next step: }>;
}>;

/** Create payload: provide issueOptionId XOR categoryId (validated in create). */
export type CreateMaintenanceTicketInput = {
  // Set locationId on the structure being built.
  locationId: string;
  // Run next step: title?: string;
  title?: string;
  /** Optional clarification; canonical issue name stays in title. */
  description?: string | null;
  // Run next step: issueOptionId?: string;
  issueOptionId?: string;
  // Run next step: categoryId?: string;
  categoryId?: string;
  // Run next step: priority?: Priority;
  priority?: Priority;
  /**
   * When omitted, catalog `defaultBlocksRoom` is applied (else false).
   * Explicit false always wins over catalog default.
   */
  blocksRoom?: boolean;
  // Set reportedByEmployeeId on the structure being built.
  reportedByEmployeeId: string;
  /** Client command id for offline/idempotent create (unique on ticket). */
  commandId?: string;
  // Run next step: dueAt?: Date;
  dueAt?: Date;
  /** Testable clock; defaults to wall clock. */
  now?: Date;
  /** Create a second active ticket despite an exact duplicate. */
  allowDuplicate?: boolean;
  /** Required when allowDuplicate is true; stored in audit. */
  duplicateOverrideReason?: string | null;
  /** Proceed despite a probable (similar) duplicate warning. */
  confirmSimilar?: boolean;
};

// Declare type TicketEventPayload for callers and internals.
export type TicketEventPayload = Prisma.InputJsonValue | undefined;
