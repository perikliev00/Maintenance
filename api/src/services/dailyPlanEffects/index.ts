/**
 * Side effects of daily plan entries: occupancy/dirty bumps, task create/link,
 * and deferred departure confirmation when stay evidence is ambiguous.
 */
export { parseHotelDate, formatHotelDate } from "./hotelDate";
// Expose selected types from this module.
export type {
  DepartureRoomEffectsResult,
  DepartureRoomEffectsDecision,
// Execute: } from "./types";
} from "./types";
// Expose selected symbols from this module.
export {
  classifyDepartureRoomEffects,
  applyDepartureRoomEffects,
  ensureDepartureRoomEffects,
// Execute: } from "./departure";
} from "./departure";
// Re-export symbols from ./applyEntry for callers.
export { applyPlanEntryEffects } from "./applyEntry";
