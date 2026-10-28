/**
 * Load a location and assert the caller's data scope may access it.
 * Access is enforced before the full board load so denied requests have no
 * side effects from location reads that might later gain writes.
 */
import { LocationKind } from "@prisma/client";
import { AppError } from "../../errors";
import {
  assertCanAccessLocation,
  type DataScope,
} from "../dataScope";
import { findLocationById } from "./crud";

/**
 * Assert data-scope access first, then fetch by id (optional kind / activeOnly).
 * Archived rooms return 404 when `activeOnly` is set.
 */
export async function loadScopedLocation(
  scope: DataScope,
  id: string,
  opts?: {
    kind?: LocationKind;
    activeOnly?: boolean;
    notFoundMessage?: string;
  },
) {
  // Caller-supplied message keeps room vs common-area wording consistent.
  const message = opts?.notFoundMessage ?? "Location not found";
  // Enforce sector / assignment data-scope before any full location load.
  await assertCanAccessLocation(scope, id);
  // Optional kind filter so room endpoints cannot load common areas by id.
  const location = await findLocationById(id, opts?.kind);
  if (!location) {
    throw new AppError(404, "not_found", message);
  }
  // Treat archived catalog rows as missing when the caller requires activeOnly.
  if (opts?.activeOnly && location.catalogStatus !== "active") {
    throw new AppError(404, "not_found", message);
  }
  return location;
}
