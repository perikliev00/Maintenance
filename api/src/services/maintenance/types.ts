/**
 * Shared Prisma types and include shape for maintenance ticket reads/writes.
 */
import { Priority, Prisma } from "@prisma/client";

/** Standard relations loaded with every ticket mutation / list response. */
export const ticketInclude = {
  location: { include: { floor: { include: { building: true } } } },
  reportedBy: true,
  assignee: true,
  resolvedBy: true,
  closedBy: true,
  issueOption: true,
} as const;

export type Tx = Prisma.TransactionClient;

export type TicketWithRelations = Prisma.MaintenanceTicketGetPayload<{
  include: typeof ticketInclude;
}>;

/** Create payload: provide issueOptionId XOR categoryId (validated in create). */
export type CreateMaintenanceTicketInput = {
  locationId: string;
  title?: string;
  /** Optional clarification; canonical issue name stays in title. */
  description?: string | null;
  issueOptionId?: string;
  categoryId?: string;
  priority?: Priority;
  /**
   * When omitted, catalog `defaultBlocksRoom` is applied (else false).
   * Explicit false always wins over catalog default.
   */
  blocksRoom?: boolean;
  reportedByEmployeeId: string;
  /** Client command id for offline/idempotent create (unique on ticket). */
  commandId?: string;
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

export type TicketEventPayload = Prisma.InputJsonValue | undefined;
