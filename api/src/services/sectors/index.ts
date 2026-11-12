/**
 * Hotel sectors: supervised location groups for data scope and ops routing.
 */
export type { SectorMembershipAuth } from "./membership";
// Re-export selected symbols for barrel consumers.
export { assertLocationTransferAllowed } from "./membership";
// Re-export selected symbols for barrel consumers.
export { listSectors, listMySectors, getSector } from "./queries";
// Re-export selected symbols for barrel consumers.
export {
  createSector,
  saveSector,
  setSectorLocations,
} from "./commands";
// Re-export selected symbols for barrel consumers.
export {
  setSectorMutationTestHooks,
  resetSectorMutationTestHooks,
} from "./testHooks";
// Re-export selected symbols for barrel consumers.
export {
  normalizeSectorFields,
  assertValidSectorFields,
  normalizeLocationIds,
} from "./validation";
