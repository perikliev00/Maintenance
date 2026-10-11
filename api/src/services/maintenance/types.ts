import { Priority, Prisma } from "@prisma/client";

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

export type CreateMaintenanceTicketInput = {
  locationId: string;
  title?: string;
  issueOptionId?: string;
  categoryId?: string;
  priority?: Priority;
  blocksRoom: boolean;
  reportedByEmployeeId: string;
  commandId?: string;
  dueAt?: Date;
};

export type TicketEventPayload = Prisma.InputJsonValue | undefined;
