/**
 * Hotel sectors: supervised location groups for data scope and ops routing.
 */
export type { SectorMembershipAuth } from "./membership";
export { assertLocationTransferAllowed } from "./membership";
export { listSectors, listMySectors, getSector } from "./queries";
export { createSector, updateSector, setSectorLocations } from "./commands";
