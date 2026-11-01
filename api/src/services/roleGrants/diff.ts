/**
 * Pure grant-set diffs used for permission.grant / permission.revoke audit rows.
 */
import { GrantKind } from "@prisma/client";

export type GrantChange = {
  kind: GrantKind;
  key: string;
  granted: boolean;
};

/** Compare current vs next panel/action sets into ordered grant/revoke changes. */
export function diffGrantSets(
  current: { panels: string[]; actions: string[] },
  next: { panels: string[]; actions: string[] },
): GrantChange[] {
  const panelSet = new Set(current.panels);
  const actionSet = new Set(current.actions);
  const nextPanelSet = new Set(next.panels);
  const nextActionSet = new Set(next.actions);
  const changes: GrantChange[] = [];

  for (const p of next.panels) {
    if (!panelSet.has(p)) {
      changes.push({ kind: GrantKind.panel, key: p, granted: true });
    }
  }
  for (const p of current.panels) {
    if (!nextPanelSet.has(p)) {
      changes.push({ kind: GrantKind.panel, key: p, granted: false });
    }
  }
  for (const a of next.actions) {
    if (!actionSet.has(a)) {
      changes.push({ kind: GrantKind.action, key: a, granted: true });
    }
  }
  for (const a of current.actions) {
    if (!nextActionSet.has(a)) {
      changes.push({ kind: GrantKind.action, key: a, granted: false });
    }
  }
  return changes;
}
