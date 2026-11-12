/**
 * Concurrent per-entity busy tracking for the Locations board.
 * Avoids a single busyId slot that clears when a parallel action finishes.
 */

/** Immutable add — no-op if already present. */
export function addBusyId(prev: ReadonlySet<string>, id: string): Set<string> {
  // Conditional branch for the case described by this guard.
  if (prev.has(id)) return new Set(prev);
  // Create a Set/Map for efficient membership or keyed lookup.
  const next = new Set(prev);
  // Invoke next.add to perform this step.
  next.add(id);
  // Return early result or rendered output from this path.
  return next;
}

/** Immutable remove — only clears the given id. */
export function removeBusyId(
  // Provide prev field used by this structure.
  prev: ReadonlySet<string>,
  // Provide id field used by this structure.
  id: string,
// Support the surrounding logic for this step.
): Set<string> {
  // Conditional branch for the case described by this guard.
  if (!prev.has(id)) return new Set(prev);
  // Create a Set/Map for efficient membership or keyed lookup.
  const next = new Set(prev);
  // Invoke next.delete to perform this step.
  next.delete(id);
  // Return early result or rendered output from this path.
  return next;
}

/** True when this entity already has an in-flight action. */
export function isBusy(busyIds: ReadonlySet<string>, id: string): boolean {
  // Return early result or rendered output from this path.
  return busyIds.has(id);
}
