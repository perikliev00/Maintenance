/**
 * Role-based data scope: resolve caller scope, build Prisma where-clauses,
 * and assert entity access before mutations.
 */
export type { DataScope, DataScopeKind } from "./types";
export { resolveDataScope } from "./resolve";
export {
  sectorSnapshotForLocation,
  sectorSupervisorForSector,
} from "./sectorSnapshots";
export {
  taskWhere,
  locationWhere,
  ticketWhere,
  sessionTaskWhere,
  sectorWhere,
  scopedLocationIdsFor,
} from "./where";
export {
  assertCanAccessTask,
  assertCanAccessLocation,
  assertCanAccessTicket,
  assertCanAccessSession,
  assertCanAccessSector,
  assertLocationsInSectorScope,
  assertCanCreateSector,
} from "./assert";
