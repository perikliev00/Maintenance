/**
 * Side effects of daily plan entries: occupancy/dirty bumps, task create/link,
 * and deferred departure confirmation when stay evidence is ambiguous.
 */
export { parseHotelDate, formatHotelDate } from "./hotelDate";
// Expose selected types from this module.
export type {
  // Carry this field through the payload or query.
  DepartureRoomEffectsResult,
  // Carry this field through the payload or query.
  DepartureRoomEffectsDecision,
// Execute: } from "./types";
} from "./types";
// Expose selected symbols from this module.
export {
  // Carry this field through the payload or query.
  classifyDepartureRoomEffects,
  // Carry this field through the payload or query.
  applyDepartureRoomEffects,
  // Carry this field through the payload or query.
  ensureDepartureRoomEffects,
// Execute: } from "./departure";
} from "./departure";
// Re-export symbols from ./applyEntry for callers.
export { applyPlanEntryEffects } from "./applyEntry";
