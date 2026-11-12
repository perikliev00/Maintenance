/**
 * Role-based data scope: resolve caller scope, build Prisma where-clauses,
 * and assert entity access before mutations.
 */
export type { DataScope, DataScopeKind } from "./types";
// Re-export selected symbols for barrel consumers.
export { resolveDataScope } from "./resolve";
// Re-export selected symbols for barrel consumers.
export {
  // Run next step: sectorSnapshotForLocation,
  sectorSnapshotForLocation,
  // Run next step: sectorSupervisorForSector,
  sectorSupervisorForSector,
// Run next step: } from "./sectorSnapshots";
} from "./sectorSnapshots";
// Re-export selected symbols for barrel consumers.
export {
  // Run next step: taskWhere,
  taskWhere,
  // Run next step: locationWhere,
  locationWhere,
  // Run next step: ticketWhere,
  ticketWhere,
  // Run next step: sessionTaskWhere,
  sessionTaskWhere,
  // Run next step: sectorWhere,
  sectorWhere,
  // Run next step: scopedLocationIdsFor,
  scopedLocationIdsFor,
// Run next step: } from "./where";
} from "./where";
// Re-export selected symbols for barrel consumers.
export {
  // Run next step: assertCanAccessTask,
  assertCanAccessTask,
  // Run next step: assertCanAccessLocation,
  assertCanAccessLocation,
  // Run next step: assertCanAccessTicket,
  assertCanAccessTicket,
  // Run next step: assertCanAccessSession,
  assertCanAccessSession,
  // Run next step: assertCanAccessSector,
  assertCanAccessSector,
  // Run next step: assertLocationsInSectorScope,
  assertLocationsInSectorScope,
  // Run next step: assertCanCreateSector,
  assertCanCreateSector,
// Run next step: } from "./assert";
} from "./assert";
