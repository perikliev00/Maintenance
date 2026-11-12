/**
 * Concurrent per-entity busy tracking for the Locations board.
 * Avoids a single busyId slot that clears when a parallel action finishes.
 */

/** Immutable add — no-op if already present. */
export function addBusyId(prev: ReadonlySet<string>, id: string): Set<string> {
  if (prev.has(id)) return new Set(prev);
  const next = new Set(prev);
  next.add(id);
  return next;
}

/** Immutable remove — only clears the given id. */
export function removeBusyId(
  prev: ReadonlySet<string>,
  id: string,
): Set<string> {
  if (!prev.has(id)) return new Set(prev);
  const next = new Set(prev);
  next.delete(id);
  return next;
}

/** True when this entity already has an in-flight action. */
export function isBusy(busyIds: ReadonlySet<string>, id: string): boolean {
  return busyIds.has(id);
}
