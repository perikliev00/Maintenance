/**
 * Load a location and assert the caller's data scope may access it.
 * Access is enforced before the full board load so denied requests have no
 * side effects from location reads that might later gain writes.
 */
import { LocationKind } from "@prisma/client";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module dependency for this service.
import {
  // Run next step: assertCanAccessLocation,
  assertCanAccessLocation,
  // Declare type DataScope for callers and internals.
  type DataScope,
// Run next step: } from "../dataScope";
} from "../dataScope";
// Import module ./crud for this service.
import { findLocationById } from "./crud";

/**
 * Assert data-scope access first, then fetch by id (optional kind / activeOnly).
 * Archived rooms return 404 when `activeOnly` is set.
 */
export async function loadScopedLocation(
  // Set scope on the structure being built.
  scope: DataScope,
  // Set id on the structure being built.
  id: string,
  // Run next step: opts?: {
  opts?: {
    // Run next step: kind?: LocationKind;
    kind?: LocationKind;
    // Run next step: activeOnly?: boolean;
    activeOnly?: boolean;
    // Run next step: notFoundMessage?: string;
    notFoundMessage?: string;
  },
// Run next step: ) {
) {
  // Caller-supplied message keeps room vs common-area wording consistent.
  const message = opts?.notFoundMessage ?? "Location not found";
  // Enforce sector / assignment data-scope before any full location load.
  await assertCanAccessLocation(scope, id);
  // Optional kind filter so room endpoints cannot load common areas by id.
  const location = await findLocationById(id, opts?.kind);
  // Branch when this condition holds so the right path runs.
  if (!location) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", message);
  }
  // Treat archived catalog rows as missing when the caller requires activeOnly.
  if (opts?.activeOnly && location.catalogStatus !== "active") {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", message);
  }
  // Return the computed result to the caller.
  return location;
}
