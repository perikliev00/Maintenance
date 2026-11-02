import { useBusyMutation } from "../../hooks/useBusyMutation";

/**
 * Shared busy guard for sector, shift, and roster mutations on HousekeepingPage.
 * Thin alias over useBusyMutation so save-vs-refresh semantics stay consistent
 * with location/issue catalogs.
 */
export function useHousekeepingBusy() {
  return useBusyMutation();
}
