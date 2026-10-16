/**
 * Sanitize grant replace input: drop unknown keys and keep permissions panel
 * in lockstep with permissions.manage.
 */
import {
  type Action,
  type Panel,
  isAction,
  isPanel,
} from "../../permissions";
import type { RoleGrants } from "./cache";

/**
 * Deduplicate known panels/actions. permissions.manage implies the permissions
 * panel; without the action the panel is stripped so UI cannot open a dead end.
 */
export function normalizePanelsActions(
  panelsIn: string[],
  actionsIn: string[],
): RoleGrants {
  // Keep only known action keys; drop typos / stale clients silently.
  const actions = Array.from(
    new Set(actionsIn.filter(isAction)),
  ) as Action[];
  // Same for panels — unknown strings never reach RoleGrant rows.
  let panels = Array.from(new Set(panelsIn.filter(isPanel))) as Panel[];

  // permissions.manage without the panel would hide the UI that needs the action.
  const hasManage = actions.includes("permissions.manage");
  // Auto-add the permissions panel when manage is granted.
  if (hasManage && !panels.includes("permissions")) {
    panels = [...panels, "permissions"];
  }
  // Without manage, strip the panel so nav cannot open a dead permissions screen.
  if (!hasManage) {
    panels = panels.filter((p) => p !== "permissions");
  }

  // Return the sanitized, deduplicated grant sets for replaceRoleGrants.
  return { panels, actions };
}
