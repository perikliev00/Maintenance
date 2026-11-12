/**
 * Pure grant-set diffs used for permission.grant / permission.revoke audit rows.
 */
import { GrantKind } from "@prisma/client";

// Declare type GrantChange for callers and internals.
export type GrantChange = {
  // Set kind on the structure being built.
  kind: GrantKind;
  // Set key on the structure being built.
  key: string;
  // Set granted on the structure being built.
  granted: boolean;
};

/** Compare current vs next panel/action sets into ordered grant/revoke changes. */
export function diffGrantSets(
  // Set current on the structure being built.
  current: { panels: string[]; actions: string[] },
  // Set next on the structure being built.
  next: { panels: string[]; actions: string[] },
// Run next step: ): GrantChange[] {
): GrantChange[] {
  // Capture panel set for use in this scope.
  const panelSet = new Set(current.panels);
  // Capture action set for use in this scope.
  const actionSet = new Set(current.actions);
  // Capture next panel set for use in this scope.
  const nextPanelSet = new Set(next.panels);
  // Capture next action set for use in this scope.
  const nextActionSet = new Set(next.actions);
  // Capture changes for use in this scope.
  const changes: GrantChange[] = [];

  // Iterate items to apply the same logic to each entry.
  for (const p of next.panels) {
    // Branch when this condition holds so the right path runs.
    if (!panelSet.has(p)) {
      // Append an entry to the accumulating collection.
      changes.push({ kind: GrantKind.panel, key: p, granted: true });
    }
  }
  // Iterate items to apply the same logic to each entry.
  for (const p of current.panels) {
    // Branch when this condition holds so the right path runs.
    if (!nextPanelSet.has(p)) {
      // Append an entry to the accumulating collection.
      changes.push({ kind: GrantKind.panel, key: p, granted: false });
    }
  }
  // Iterate items to apply the same logic to each entry.
  for (const a of next.actions) {
    // Branch when this condition holds so the right path runs.
    if (!actionSet.has(a)) {
      // Append an entry to the accumulating collection.
      changes.push({ kind: GrantKind.action, key: a, granted: true });
    }
  }
  // Iterate items to apply the same logic to each entry.
  for (const a of current.actions) {
    // Branch when this condition holds so the right path runs.
    if (!nextActionSet.has(a)) {
      // Append an entry to the accumulating collection.
      changes.push({ kind: GrantKind.action, key: a, granted: false });
    }
  }
  // Return the computed result to the caller.
  return changes;
}
