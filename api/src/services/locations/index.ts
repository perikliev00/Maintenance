/**
 * Location catalog and live board: CRUD, occupancy/service status, scoped load.
 */
export { attachOpenIssueCounts, locationInclude } from "./types";
export type { LocationForMap } from "./types";
export { mapLocation } from "./format";
export {
  resolveOrphanCleaningStatus,
  reconcileOrphanCleaningStatusLocked,
  reconcileOrphanCleaningStatusForLocation,
  healOrphanIfTaskCycleCurrent,
} from "./reconcileCleaningStatus";
export { loadScopedLocation } from "./access";
export {
  DEFAULT_ACTIVE_LOCATION_LIMIT,
  MAX_ACTIVE_LOCATION_LIMIT,
  resolveActiveLocationLimit,
  findActiveLocations,
  findLocationById,
  getLocationHierarchy,
  listLocationsCatalog,
  resolveCatalogListWhere,
  catalogOrderBy,
  createLocation,
  updateLocation,
} from "./crud";
export { archiveLocation, restoreLocation } from "./mutations";
export { setLocationOccupancy, setLocationServiceStatus } from "./status";
