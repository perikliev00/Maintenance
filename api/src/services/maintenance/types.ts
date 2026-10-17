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
  issueOptionId?: string;
  categoryId?: string;
  priority?: Priority;
  blocksRoom: boolean;
  reportedByEmployeeId: string;
  /** Client command id for offline/idempotent create (unique on ticket). */
  commandId?: string;
  dueAt?: Date;
  /** Testable clock; defaults to wall clock. */
  now?: Date;
};

export type TicketEventPayload = Prisma.InputJsonValue | undefined;
