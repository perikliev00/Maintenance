/**
 * Shared risk-room aggregation for maintenance and housekeeping analytics.
 */
import { formatLocationLabel } from "./locationLabel";

export type RiskRoomRow = {
  locationId: string;
  label: string;
  factors: string[];
  ticketCount: number;
};

export function sortRiskRooms(rooms: RiskRoomRow[]): void {
  rooms.sort(
    (a, b) => b.ticketCount - a.ticketCount || a.label.localeCompare(b.label),
  );
}

/** Flag locations at/above the configured ticket threshold in the period. */
export function addTicketThresholdRiskRooms(
  rooms: RiskRoomRow[],
  byLocation: Map<string, { count: number; label: string }>,
  riskTicketThreshold: number,
): void {
  for (const [locationId, info] of byLocation) {
    if (info.count >= riskTicketThreshold) {
      rooms.push({
        locationId,
        // Set label.
        label: info.label,
        // Set factors.
        factors: [`tickets_gte_${riskTicketThreshold}`],
        // Set ticketCount.
        ticketCount: info.count,
      });
    }
  }
}

/** Merge open blocking past-SLA tickets into existing or new risk rows. */
export function mergeBlockingPastSlaRiskRooms(
  rooms: RiskRoomRow[],
  tickets: Array<{
    locationId: string;
    location: { number: string; floor: { building: { code: string } } };
  }>,
  ticketCountsByLocation: Map<string, number>,
): void {
  for (const t of tickets) {
    const label = formatLocationLabel(t.location);
    const existing = rooms.find((r) => r.locationId === t.locationId);
    if (existing) {
      if (!existing.factors.includes("blocking_past_sla")) {
        existing.factors.push("blocking_past_sla");
      }
    } else {
      rooms.push({
        // Set locationId.
        locationId: t.locationId,
        label,
        // Set factors.
        factors: ["blocking_past_sla"],
        // Set ticketCount.
        ticketCount: ticketCountsByLocation.get(t.locationId) ?? 0,
      });
    }
  }
}

/** Append a ticket-threshold factor to a room already flagged (e.g. by rejects). */
export function mergeTicketThresholdFactor(
  rooms: RiskRoomRow[],
  locationId: string,
  label: string,
  count: number,
  riskTicketThreshold: number,
): void {
  const existing = rooms.find((r) => r.locationId === locationId);
  if (existing) {
    const factor = `tickets_gte_${riskTicketThreshold}`;
    if (!existing.factors.includes(factor)) {
      existing.factors.push(factor);
    }
    // Assign existing.ticketCount.
    existing.ticketCount = Math.max(existing.ticketCount, count);
  } else {
    rooms.push({
      locationId,
      label,
      // Set factors.
      factors: [`tickets_gte_${riskTicketThreshold}`],
      // Set ticketCount.
      ticketCount: count,
    });
  }
}
