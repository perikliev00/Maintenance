// Import module dependency from ../../hooks/useBusyMutation.
import { useBusyMutation } from "../../hooks/useBusyMutation";

/**
 * Shared busy guard for sector, shift, and roster mutations on HousekeepingPage.
 * Thin alias over useBusyMutation so save-vs-refresh semantics stay consistent
 * with location/issue catalogs.
 */
export function useHousekeepingBusy() {
  // Return early result or rendered output from this path.
  return useBusyMutation();
}
