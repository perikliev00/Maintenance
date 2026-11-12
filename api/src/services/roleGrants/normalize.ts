/**
 * Sanitize grant replace input: drop unknown keys and keep permissions panel
 * in lockstep with permissions.manage.
 */
import {
  // Declare type Action for callers and internals.
  type Action,
  // Declare type Panel for callers and internals.
  type Panel,
  // Run next step: isAction,
  isAction,
  // Run next step: isPanel,
  isPanel,
// Run next step: } from "../../permissions";
} from "../../permissions";
// Import type(s) RoleGrants for typing without runtime cost.
import type { RoleGrants } from "./cache";

/**
 * Deduplicate known panels/actions. permissions.manage implies the permissions
 * panel; without the action the panel is stripped so UI cannot open a dead end.
 */
export function normalizePanelsActions(
  // Set panelsIn on the structure being built.
  panelsIn: string[],
  // Set actionsIn on the structure being built.
  actionsIn: string[],
// Run next step: ): RoleGrants {
): RoleGrants {
  // Keep only known action keys; drop typos / stale clients silently.
  const actions = Array.from(
    // Run next step: new Set(actionsIn.filter(isAction)),
    new Set(actionsIn.filter(isAction)),
  // Run next step: ) as Action[];
  ) as Action[];
  // Same for panels — unknown strings never reach RoleGrant rows.
  let panels = Array.from(new Set(panelsIn.filter(isPanel))) as Panel[];

  // permissions.manage without the panel would hide the UI that needs the action.
  const hasManage = actions.includes("permissions.manage");
  // Auto-add the permissions panel when manage is granted.
  if (hasManage && !panels.includes("permissions")) {
    // Update panels as control flow progresses.
    panels = [...panels, "permissions"];
  }
  // Without manage, strip the panel so nav cannot open a dead permissions screen.
  if (!hasManage) {
    // Update panels as control flow progresses.
    panels = panels.filter((p) => p !== "permissions");
  }

  // Return the sanitized, deduplicated grant sets for replaceRoleGrants.
  return { panels, actions };
}
