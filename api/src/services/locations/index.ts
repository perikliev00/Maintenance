/**
 * Location catalog and live board: CRUD, occupancy/service status, scoped load.
 */
export { locationInclude } from "./types";
export type { LocationForMap } from "./types";
export { mapLocation } from "./format";
export { loadScopedLocation } from "./access";
export {
  findActiveLocations,
  findLocationById,
  findLocationByQrToken,
  locationQrPayload,
  getLocationHierarchy,
  listLocationsCatalog,
  createLocation,
  updateLocation,
  archiveLocation,
  restoreLocation,
} from "./crud";
export { setLocationOccupancy, setLocationServiceStatus } from "./status";
