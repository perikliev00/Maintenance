import { Prisma, TicketStatus } from "@prisma/client";
import { AppError } from "../../errors";
import { ticketInclude, type Tx } from "./types";

export async function claimTicketUpdate(
  tx: Tx,
  ticketId: string,
  fromStatuses: TicketStatus[],
  data: Prisma.MaintenanceTicketUncheckedUpdateManyInput,
  invalidMessage: (status: TicketStatus) => string,
) {
  const claimed = await tx.maintenanceTicket.updateMany({
    where: { id: ticketId, status: { in: fromStatuses } },
    data,
  });
  if (claimed.count === 0) {
    const current = await tx.maintenanceTicket.findUnique({
      where: { id: ticketId },
    });
    if (!current) {
      throw new AppError(404, "not_found", "Ticket not found");
    }
    throw new AppError(409, "invalid_state", invalidMessage(current.status));
  }
  return tx.maintenanceTicket.findUniqueOrThrow({
    where: { id: ticketId },
    include: ticketInclude,
  });
}
