/**
 * API shaping for maintenance tickets (legacy `category` alias).
 */
import type { TicketWithRelations } from "./types";

/**
 * Adds `category` as an alias of `categoryKey` for older clients.
 * Newer clients should prefer `categoryKey` / `categoryLabel*`.
 */
export function formatMaintenanceTicket<
  // Run next step: T extends { categoryKey: string; categoryLabelBg: string; ca…
  T extends { categoryKey: string; categoryLabelBg: string; categoryLabelEn: string },
// Run next step: >(ticket: T) {
>(ticket: T) {
  // Spread first so explicit `category` wins over any colliding field.
  return {
    // Run next step: ...ticket,
    ...ticket,
    // Legacy alias: older web clients still read `category` as the key string.
    category: ticket.categoryKey,
  };
}

/** Inferred DTO type for a fully-loaded ticket after {@link formatMaintenanceTicket}. */
export type FormattedMaintenanceTicket = ReturnType<
  // Run next step: typeof formatMaintenanceTicket<TicketWithRelations>
  typeof formatMaintenanceTicket<TicketWithRelations>
// Run next step: >;
>;
