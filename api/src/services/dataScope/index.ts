/**
 * Role-based data scope: resolve caller scope, build Prisma where-clauses,
 * and assert entity access before mutations.
 */
export type { DataScope, DataScopeKind } from "./types";
// Re-export selected symbols for barrel consumers.
export { resolveDataScope } from "./resolve";
// Re-export selected symbols for barrel consumers.
export {
  sectorSnapshotForLocation,
  sectorSupervisorForSector,
} from "./sectorSnapshots";
// Re-export selected symbols for barrel consumers.
export {
  taskWhere,
  locationWhere,
  ticketWhere,
  sessionTaskWhere,
  sectorWhere,
  scopedLocationIdsFor,
} from "./where";
// Re-export selected symbols for barrel consumers.
export {
  assertCanAccessTask,
  assertCanAccessLocation,
  assertCanAccessTicket,
  assertCanAccessSession,
  assertCanAccessSector,
  assertLocationsInSectorScope,
  assertCanCreateSector,
} from "./assert";
