/**
 * Hotel sectors: supervised location groups for data scope and ops routing.
 */
export type { SectorMembershipAuth } from "./membership";
export { assertLocationTransferAllowed } from "./membership";
export { listSectors, listMySectors, getSector } from "./queries";
export {
  createSector,
  updateSector,
  saveSector,
  setSectorLocations,
} from "./commands";
export {
  setSectorMutationTestHooks,
  resetSectorMutationTestHooks,
} from "./testHooks";
export {
  normalizeSectorFields,
  assertValidSectorFields,
  normalizeLocationIds,
} from "./validation";
