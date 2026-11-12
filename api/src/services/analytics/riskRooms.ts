/**
 * Shared risk-room aggregation for maintenance and housekeeping analytics.
 */
import { formatLocationLabel } from "./locationLabel";

// Public type RiskRoomRow for callers of this service.
export type RiskRoomRow = {
  // Field locationId on this type/payload.
  locationId: string;
  // Field label on this type/payload.
  label: string;
  // Time field factors.
  factors: string[];
  // Field ticketCount on this type/payload.
  ticketCount: number;
};

// Exported helper sortRiskRooms.
export function sortRiskRooms(rooms: RiskRoomRow[]): void {
  // Support the surrounding control flow.
  rooms.sort(
    // Support the surrounding control flow.
    (a, b) => b.ticketCount - a.ticketCount || a.label.localeCompare(b.label),
  );
}

/** Flag locations at/above the configured ticket threshold in the period. */
export function addTicketThresholdRiskRooms(
  // Param rooms required by this function.
  rooms: RiskRoomRow[],
  // Param byLocation required by this function.
  byLocation: Map<string, { count: number; label: string }>,
  // Param riskTicketThreshold required by this function.
  riskTicketThreshold: number,
): void {
  // Iterate key/value pairs.
  for (const [locationId, info] of byLocation) {
    // Threshold/size gate.
    if (info.count >= riskTicketThreshold) {
      // Support the surrounding control flow.
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
  // Param rooms required by this function.
  rooms: RiskRoomRow[],
  // Param tickets required by this function.
  tickets: Array<{
    // Param locationId required by this function.
    locationId: string;
    // Param location required by this function.
    location: { number: string; floor: { building: { code: string } } };
  // Support the surrounding control flow.
  }>,
  // Param ticketCountsByLocation required by this function.
  ticketCountsByLocation: Map<string, number>,
): void {
  // Iterate items for aggregation or writes.
  for (const t of tickets) {
    // Local label used below.
    const label = formatLocationLabel(t.location);
    // Local existing used below.
    const existing = rooms.find((r) => r.locationId === t.locationId);
    // Conditional path for this guard.
    if (existing) {
      // Membership check before acting.
      if (!existing.factors.includes("blocking_past_sla")) {
        // Support the surrounding control flow.
        existing.factors.push("blocking_past_sla");
      }
    // Support the surrounding control flow.
    } else {
      // Support the surrounding control flow.
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
  // Param rooms required by this function.
  rooms: RiskRoomRow[],
  // Param locationId required by this function.
  locationId: string,
  // Param label required by this function.
  label: string,
  // Param count required by this function.
  count: number,
  // Param riskTicketThreshold required by this function.
  riskTicketThreshold: number,
): void {
  // Local existing used below.
  const existing = rooms.find((r) => r.locationId === locationId);
  // Conditional path for this guard.
  if (existing) {
    // Local factor used below.
    const factor = `tickets_gte_${riskTicketThreshold}`;
    // Membership check before acting.
    if (!existing.factors.includes(factor)) {
      // Support the surrounding control flow.
      existing.factors.push(factor);
    }
    // Assign existing.ticketCount.
    existing.ticketCount = Math.max(existing.ticketCount, count);
  // Support the surrounding control flow.
  } else {
    // Support the surrounding control flow.
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
