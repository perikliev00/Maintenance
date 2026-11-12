/**
 * Pure housekeeping helpers shared by HousekeepingPage and unit tests.
 */

// Support the surrounding logic for this step.
export {
  // Declare type alias SaveRefreshOutcome.
  type SaveRefreshOutcome,
  // Support the surrounding logic for this step.
  classifySaveRefreshOutcome,
// Support the surrounding logic for this step.
} from "../saveRefresh";

/**
 * Supervisors with sectors.manage may edit owned sectors but must not create
 * (would expand data scope). Hotel-wide roles may create when manage is granted.
 */
export function canCreateSector(role: string, canManage: boolean): boolean {
  // Return early result or rendered output from this path.
  return canManage && role !== "supervisor";
}

/** Whether a new async result may apply for the currently edited sector id. */
export function shouldApplySectorSaveResult(input: {
  // Provide savingId field used by this structure.
  savingId: string | null;
  // Provide targetId field used by this structure.
  targetId: string | null;
// Support the surrounding logic for this step.
}): boolean {
  // Conditional branch for the case described by this guard.
  if (input.savingId == null) return false;
  // Conditional branch for the case described by this guard.
  if (input.targetId == null) return input.savingId === "__create__";
  // Return early result or rendered output from this path.
  return input.savingId === input.targetId;
}

/**
 * Independent resource load: one failure must not blank sibling resources (BUG-04).
 */
export function mergeIndependentLoadErrors(parts: {
  // Support the surrounding logic for this step.
  sectors?: string | null;
  // Support the surrounding logic for this step.
  shifts?: string | null;
  // Support the surrounding logic for this step.
  people?: string | null;
// Support the surrounding logic for this step.
}): string | null {
  // Filter items down to those relevant for this view.
  const messages = [parts.sectors, parts.shifts, parts.people].filter(
    // Support the surrounding logic for this step.
    (m): m is string => Boolean(m),
  );
  // Return early result or rendered output from this path.
  return messages.length ? messages.join(" · ") : null;
}

/** Catalog → sectors invalidation event name (BUG-10). */
export const HOUSEKEEPING_CATALOG_CHANGED = "housekeeping:catalog-changed";

// Export type definition for consumers of this module.
export type CatalogChangedDetail = { source: "catalog" };

/** True only for the catalog CustomEvent payload (not a bare Event of the same type). */
export function isCatalogChangedEvent(event: Event): boolean {
  // Conditional branch for the case described by this guard.
  if (event.type !== HOUSEKEEPING_CATALOG_CHANGED) return false;
  // Conditional branch for the case described by this guard.
  if (!(event instanceof CustomEvent)) return false;
  // Bind detail for use in the following logic.
  const detail = event.detail as CatalogChangedDetail | null;
  // Return early result or rendered output from this path.
  return detail?.source === "catalog";
}

// Export function catalogChangedEvent as part of this module's API.
export function catalogChangedEvent(): CustomEvent<CatalogChangedDetail> {
  // Return early result or rendered output from this path.
  return new CustomEvent(HOUSEKEEPING_CATALOG_CHANGED, {
    // Provide detail field used by this structure.
    detail: { source: "catalog" },
  });
}
