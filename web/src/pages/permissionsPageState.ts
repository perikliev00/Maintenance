/**
 * Pure helpers for PermissionsPage draft merge, save phases, and history UI.
 */
import type { SaveRefreshOutcome } from "../saveRefresh";

// Export type definition for consumers of this module.
export type RoleGrantDraft = { panels: string[]; actions: string[] };

// Export type definition for consumers of this module.
export type HistoryUiStatus = "idle" | "loading" | "success" | "empty" | "error";

// Export type definition for consumers of this module.
export type SaveFeedback =
  // Support the surrounding logic for this step.
  | { kind: "ok"; text: string }
  // Support the surrounding logic for this step.
  | {
      // Provide kind field used by this structure.
      kind: Extract<SaveRefreshOutcome, "saved_refresh_failed">;
      // Provide text field used by this structure.
      text: string;
    }
  // Support the surrounding logic for this step.
  | { kind: "conflict"; text: string }
  // Support the surrounding logic for this step.
  | { kind: "error"; text: string };

// Define function sortedCopy and its behavior.
function sortedCopy(values: string[]): string[] {
  // Return early result or rendered output from this path.
  return [...values].sort();
}

/** True when draft panels/actions differ from the server snapshot. */
export function isRoleDraftDirty(
  // Provide draft field used by this structure.
  draft: RoleGrantDraft | undefined,
  // Provide server field used by this structure.
  server: RoleGrantDraft | undefined,
// Support the surrounding logic for this step.
): boolean {
  // Bind d for use in the following logic.
  const d = draft ?? { panels: [], actions: [] };
  // Bind s for use in the following logic.
  const s = server ?? { panels: [], actions: [] };
  // Return the JSX/UI tree for this render path.
  return (
    // Invoke JSON.stringify to perform this step.
    JSON.stringify(sortedCopy(d.panels)) !==
      // Invoke JSON.stringify to perform this step.
      JSON.stringify(sortedCopy(s.panels)) ||
    // Invoke JSON.stringify to perform this step.
    JSON.stringify(sortedCopy(d.actions)) !==
      // Invoke JSON.stringify to perform this step.
      JSON.stringify(sortedCopy(s.actions))
  );
}

/** Server state a draft was started from; `version` is the CAS token to save with. */
export type RoleBase = { version: number; grants: RoleGrantDraft };

// Export type definition for consumers of this module.
export type RoleBases = Record<string, RoleBase>;

// Define function copyGrants and its behavior.
function copyGrants(g: RoleGrantDraft | undefined): RoleGrantDraft {
  // Return early result or rendered output from this path.
  return { panels: [...(g?.panels ?? [])], actions: [...(g?.actions ?? [])] };
}

/**
 * After a full matrix fetch. A role with local edits (draft differs from the
 * server grants it was based on) keeps BOTH its draft and its own base version,
 * so a newer remote version surfaces as a conflict instead of being adopted.
 * Untouched roles — and `takeRemoteRole` (explicit reconcile) — rebase onto the
 * fresh server grants and version.
 */
export function reconcileMatrixIntoDraft(
  // Provide prevDraft field used by this structure.
  prevDraft: Record<string, RoleGrantDraft>,
  // Provide prevBases field used by this structure.
  prevBases: RoleBases,
  // Provide data field used by this structure.
  data: {
    // Provide byRole field used by this structure.
    byRole: Record<string, RoleGrantDraft>;
    // Provide versions field used by this structure.
    versions: Record<string, number>;
    // Provide roles field used by this structure.
    roles: string[];
  },
  // Support the surrounding logic for this step.
  takeRemoteRole?: string,
// Support the surrounding logic for this step.
): { draft: Record<string, RoleGrantDraft>; bases: RoleBases } {
  // Initialize an object holding related fields.
  const draft: Record<string, RoleGrantDraft> = {};
  // Initialize an object holding related fields.
  const bases: RoleBases = {};
  // Iterate a collection or counted range.
  for (const role of data.roles) {
    // Bind prevBase for use in the following logic.
    const prevBase = prevBases[role];
    // Bind prev for use in the following logic.
    const prev = prevDraft[role];
    // Bind keepLocal for use in the following logic.
    const keepLocal =
      // Support the surrounding logic for this step.
      role !== takeRemoteRole &&
      // Support the surrounding logic for this step.
      prev !== undefined &&
      // Support the surrounding logic for this step.
      prevBase !== undefined &&
      // Invoke isRoleDraftDirty to perform this step.
      isRoleDraftDirty(prev, prevBase.grants);
    // Conditional branch for the case described by this guard.
    if (keepLocal) {
      // Support the surrounding logic for this step.
      draft[role] = prev;
      // Support the surrounding logic for this step.
      bases[role] = prevBase;
    // Support the surrounding logic for this step.
    } else {
      // Bind remote for use in the following logic.
      const remote = copyGrants(data.byRole[role]);
      // Support the surrounding logic for this step.
      draft[role] = remote;
      // Support the surrounding logic for this step.
      bases[role] = {
        // Provide version field used by this structure.
        version: data.versions[role] ?? 1,
        // Provide grants field used by this structure.
        grants: copyGrants(remote),
      };
    }
  }
  // Return early result or rendered output from this path.
  return { draft, bases };
}

/** True when the draft's base version is not the current remote version. */
export function isRoleConflict(
  // Provide base field used by this structure.
  base: RoleBase | undefined,
  // Provide remoteVersion field used by this structure.
  remoteVersion: number | undefined,
// Support the surrounding logic for this step.
): boolean {
  // Return the JSX/UI tree for this render path.
  return (
    // Support the surrounding logic for this step.
    base !== undefined &&
    // Support the surrounding logic for this step.
    remoteVersion !== undefined &&
    // Support the surrounding logic for this step.
    base.version !== remoteVersion
  );
}
/** Apply a successful PUT result to one role without wiping other drafts. */
export function applySavedRoleToDraft(
  // Provide prev field used by this structure.
  prev: Record<string, RoleGrantDraft>,
  // Provide role field used by this structure.
  role: string,
  // Provide saved field used by this structure.
  saved: RoleGrantDraft,
// Support the surrounding logic for this step.
): Record<string, RoleGrantDraft> {
  // Return early result or rendered output from this path.
  return {
    // Spread prior fields/items so overrides can layer cleanly.
    ...prev,
    // Support the surrounding logic for this step.
    [role]: {
      // Provide panels field used by this structure.
      panels: [...saved.panels],
      // Provide actions field used by this structure.
      actions: [...saved.actions],
    },
  };
}

/** Track concurrent in-flight saves without clobbering sibling roles. */
export function addSavingRole(
  // Provide current field used by this structure.
  current: ReadonlySet<string>,
  // Provide role field used by this structure.
  role: string,
// Support the surrounding logic for this step.
): Set<string> {
  // Create a Set/Map for efficient membership or keyed lookup.
  const next = new Set(current);
  // Invoke next.add to perform this step.
  next.add(role);
  // Return early result or rendered output from this path.
  return next;
}

// Export function removeSavingRole as part of this module's API.
export function removeSavingRole(
  // Provide current field used by this structure.
  current: ReadonlySet<string>,
  // Provide role field used by this structure.
  role: string,
// Support the surrounding logic for this step.
): Set<string> {
  // Create a Set/Map for efficient membership or keyed lookup.
  const next = new Set(current);
  // Invoke next.delete to perform this step.
  next.delete(role);
  // Return early result or rendered output from this path.
  return next;
}

// Export function historyStatusFromResult as part of this module's API.
export function historyStatusFromResult(
  // Provide ok field used by this structure.
  ok: boolean,
  // Provide rowCount field used by this structure.
  rowCount: number,
// Support the surrounding logic for this step.
): HistoryUiStatus {
  // Conditional branch for the case described by this guard.
  if (!ok) return "error";
  // Return early result or rendered output from this path.
  return rowCount === 0 ? "empty" : "success";
}

// Export function saveFeedbackForPutSuccess as part of this module's API.
export function saveFeedbackForPutSuccess(roleLabel: string): SaveFeedback {
  // Return early result or rendered output from this path.
  return {
    // Provide kind field used by this structure.
    kind: "ok",
    // Provide text field used by this structure.
    text: `Запазени права за ${roleLabel}`,
  };
}

// Export function saveFeedbackForRefreshFailure as part of this module's API.
export function saveFeedbackForRefreshFailure(
  // Provide roleLabel field used by this structure.
  roleLabel: string,
// Support the surrounding logic for this step.
): SaveFeedback {
  // Return early result or rendered output from this path.
  return {
    // Provide kind field used by this structure.
    kind: "saved_refresh_failed",
    // Provide text field used by this structure.
    text: `Правата за ${roleLabel} са записани, но обновяването на екрана/сесията не успя. Презаредете матрицата, без да записвате отново.`,
  };
}

// Export function saveFeedbackForConflict as part of this module's API.
export function saveFeedbackForConflict(): SaveFeedback {
  // Return early result or rendered output from this path.
  return {
    // Provide kind field used by this structure.
    kind: "conflict",
    // Provide text field used by this structure.
    text: "Матрицата е променена от друг администратор. Презаредете и опитайте отново.",
  };
}

/** Save blocked locally: the role changed remotely since this draft was started. */
export function saveFeedbackForDraftConflict(roleLabel: string): SaveFeedback {
  // Return early result or rendered output from this path.
  return {
    // Provide kind field used by this structure.
    kind: "conflict",
    // Provide text field used by this structure.
    text: `Правата за ${roleLabel} са променени от друг администратор, след като започнахте редакцията. Приемете сървърната версия (или презаредете), за да продължите.`,
  };
}
