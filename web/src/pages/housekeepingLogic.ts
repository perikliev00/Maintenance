/**
 * Pure housekeeping helpers shared by HousekeepingPage and unit tests.
 */

export type SaveRefreshOutcome =
  | "saved"
  | "save_failed"
  | "saved_refresh_failed";

/** Classify mutation vs list-refresh results (BUG-09). */
export function classifySaveRefreshOutcome(input: {
  saveOk: boolean;
  refreshOk: boolean;
}): SaveRefreshOutcome {
  if (!input.saveOk) return "save_failed";
  if (!input.refreshOk) return "saved_refresh_failed";
  return "saved";
}

/**
 * Supervisors with sectors.manage may edit owned sectors but must not create
 * (would expand data scope). Hotel-wide roles may create when manage is granted.
 */
export function canCreateSector(role: string, canManage: boolean): boolean {
  return canManage && role !== "supervisor";
}

/** Whether a new async result may apply for the currently edited sector id. */
export function shouldApplySectorSaveResult(input: {
  savingId: string | null;
  targetId: string | null;
}): boolean {
  if (input.savingId == null) return false;
  if (input.targetId == null) return input.savingId === "__create__";
  return input.savingId === input.targetId;
}

/**
 * Independent resource load: one failure must not blank sibling resources (BUG-04).
 */
export function mergeIndependentLoadErrors(parts: {
  sectors?: string | null;
  shifts?: string | null;
  people?: string | null;
}): string | null {
  const messages = [parts.sectors, parts.shifts, parts.people].filter(
    (m): m is string => Boolean(m),
  );
  return messages.length ? messages.join(" · ") : null;
}

/** Catalog → sectors invalidation event name (BUG-10). */
export const HOUSEKEEPING_CATALOG_CHANGED = "housekeeping:catalog-changed";

export type CatalogChangedDetail = { source: "catalog" };

/** True only for the catalog CustomEvent payload (not a bare Event of the same type). */
export function isCatalogChangedEvent(event: Event): boolean {
  if (event.type !== HOUSEKEEPING_CATALOG_CHANGED) return false;
  if (!(event instanceof CustomEvent)) return false;
  const detail = event.detail as CatalogChangedDetail | null;
  return detail?.source === "catalog";
}

export function catalogChangedEvent(): CustomEvent<CatalogChangedDetail> {
  return new CustomEvent(HOUSEKEEPING_CATALOG_CHANGED, {
    detail: { source: "catalog" },
  });
}
