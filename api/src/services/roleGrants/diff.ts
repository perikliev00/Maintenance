/**
 * Pure grant-set diffs used for permission.grant / permission.revoke audit rows.
 */
import { GrantKind } from "@prisma/client";

// Declare type GrantChange for callers and internals.
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
  // Capture panel set for use in this scope.
  const panelSet = new Set(current.panels);
  // Capture action set for use in this scope.
  const actionSet = new Set(current.actions);
  // Capture next panel set for use in this scope.
  const nextPanelSet = new Set(next.panels);
  // Capture next action set for use in this scope.
  const nextActionSet = new Set(next.actions);
  const changes: GrantChange[] = [];

  // Iterate items to apply the same logic to each entry.
  for (const p of next.panels) {
    if (!panelSet.has(p)) {
      // Append an entry to the accumulating collection.
      changes.push({ kind: GrantKind.panel, key: p, granted: true });
    }
  }
  // Iterate items to apply the same logic to each entry.
  for (const p of current.panels) {
    if (!nextPanelSet.has(p)) {
      // Append an entry to the accumulating collection.
      changes.push({ kind: GrantKind.panel, key: p, granted: false });
    }
  }
  // Iterate items to apply the same logic to each entry.
  for (const a of next.actions) {
    if (!actionSet.has(a)) {
      // Append an entry to the accumulating collection.
      changes.push({ kind: GrantKind.action, key: a, granted: true });
    }
  }
  // Iterate items to apply the same logic to each entry.
  for (const a of current.actions) {
    if (!nextActionSet.has(a)) {
      // Append an entry to the accumulating collection.
      changes.push({ kind: GrantKind.action, key: a, granted: false });
    }
  }
  return changes;
}
