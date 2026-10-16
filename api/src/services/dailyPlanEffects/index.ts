/**
 * Side effects of daily plan entries: occupancy/dirty bumps, task create/link,
 * and deferred departure confirmation when stay evidence is ambiguous.
 */
export { parseHotelDate, formatHotelDate } from "./hotelDate";
export type {
  DepartureRoomEffectsResult,
  DepartureRoomEffectsDecision,
} from "./types";
export {
  classifyDepartureRoomEffects,
  applyDepartureRoomEffects,
  ensureDepartureRoomEffects,
} from "./departure";
export { applyPlanEntryEffects } from "./applyEntry";
