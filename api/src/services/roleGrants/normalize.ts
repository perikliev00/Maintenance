import {
  type Action,
  type Panel,
  isAction,
  isPanel,
} from "../../permissions";
import type { RoleGrants } from "./cache";

export function normalizePanelsActions(
  panelsIn: string[],
  actionsIn: string[],
): RoleGrants {
  const actions = Array.from(
    new Set(actionsIn.filter(isAction)),
  ) as Action[];
  let panels = Array.from(new Set(panelsIn.filter(isPanel))) as Panel[];

  const hasManage = actions.includes("permissions.manage");
  if (hasManage && !panels.includes("permissions")) {
    panels = [...panels, "permissions"];
  }
  if (!hasManage) {
    panels = panels.filter((p) => p !== "permissions");
  }

  return { panels, actions };
}
