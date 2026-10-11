import type { TicketWithRelations } from "./types";

export function formatMaintenanceTicket<
  T extends { categoryKey: string; categoryLabelBg: string; categoryLabelEn: string },
>(ticket: T) {
  return {
    ...ticket,
    category: ticket.categoryKey,
  };
}

export type FormattedMaintenanceTicket = ReturnType<
  typeof formatMaintenanceTicket<TicketWithRelations>
>;
