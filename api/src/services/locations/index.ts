/**
 * Location catalog and live board: CRUD, occupancy/service status, scoped load.
 */
export { attachOpenIssueCounts, locationInclude } from "./types";
// Re-export selected symbols for barrel consumers.
export type { LocationForMap } from "./types";
// Re-export selected symbols for barrel consumers.
export { mapLocation } from "./format";
// Re-export selected symbols for barrel consumers.
export {
  resolveOrphanCleaningStatus,
  reconcileOrphanCleaningStatusLocked,
  reconcileOrphanCleaningStatusForLocation,
  healOrphanIfTaskCycleCurrent,
} from "./reconcileCleaningStatus";
// Re-export selected symbols for barrel consumers.
export { loadScopedLocation } from "./access";
// Re-export selected symbols for barrel consumers.
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
// Re-export selected symbols for barrel consumers.
export { archiveLocation, restoreLocation } from "./mutations";
// Re-export selected symbols for barrel consumers.
export { setLocationOccupancy, setLocationServiceStatus } from "./status";
