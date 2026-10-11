import { AppError } from "../../errors";
import type { Tx } from "./types";

export async function lockTicket(tx: Tx, ticketId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "MaintenanceTicket" WHERE id = ${ticketId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new AppError(404, "not_found", "Ticket not found");
  }
}

export async function loadLockedTicket(tx: Tx, ticketId: string) {
  await lockTicket(tx, ticketId);
  const ticket = await tx.maintenanceTicket.findUnique({
    where: { id: ticketId },
  });
  if (!ticket) {
    throw new AppError(404, "not_found", "Ticket not found");
  }
  return ticket;
}
