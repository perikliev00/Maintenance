/**
 * Pure helpers for PermissionsPage draft merge, save phases, and history UI.
 */
import type { SaveRefreshOutcome } from "../saveRefresh";

export type RoleGrantDraft = { panels: string[]; actions: string[] };

export type HistoryUiStatus = "idle" | "loading" | "success" | "empty" | "error";

export type SaveFeedback =
  | { kind: "ok"; text: string }
  | {
      kind: Extract<SaveRefreshOutcome, "saved_refresh_failed">;
      text: string;
    }
  | { kind: "conflict"; text: string }
  | { kind: "error"; text: string };

function sortedCopy(values: string[]): string[] {
  return [...values].sort();
}

/** True when draft panels/actions differ from the server snapshot. */
export function isRoleDraftDirty(
  draft: RoleGrantDraft | undefined,
  server: RoleGrantDraft | undefined,
): boolean {
  const d = draft ?? { panels: [], actions: [] };
  const s = server ?? { panels: [], actions: [] };
  return (
    JSON.stringify(sortedCopy(d.panels)) !==
      JSON.stringify(sortedCopy(s.panels)) ||
    JSON.stringify(sortedCopy(d.actions)) !==
      JSON.stringify(sortedCopy(s.actions))
  );
}

/** Server state a draft was started from; `version` is the CAS token to save with. */
export type RoleBase = { version: number; grants: RoleGrantDraft };

export type RoleBases = Record<string, RoleBase>;

function copyGrants(g: RoleGrantDraft | undefined): RoleGrantDraft {
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
  prevDraft: Record<string, RoleGrantDraft>,
  prevBases: RoleBases,
  data: {
    byRole: Record<string, RoleGrantDraft>;
    versions: Record<string, number>;
    roles: string[];
  },
  takeRemoteRole?: string,
): { draft: Record<string, RoleGrantDraft>; bases: RoleBases } {
  const draft: Record<string, RoleGrantDraft> = {};
  const bases: RoleBases = {};
  for (const role of data.roles) {
    const prevBase = prevBases[role];
    const prev = prevDraft[role];
    const keepLocal =
      role !== takeRemoteRole &&
      prev !== undefined &&
      prevBase !== undefined &&
      isRoleDraftDirty(prev, prevBase.grants);
    if (keepLocal) {
      draft[role] = prev;
      bases[role] = prevBase;
    } else {
      const remote = copyGrants(data.byRole[role]);
      draft[role] = remote;
      bases[role] = {
        version: data.versions[role] ?? 1,
        grants: copyGrants(remote),
      };
    }
  }
  return { draft, bases };
}

/** True when the draft's base version is not the current remote version. */
export function isRoleConflict(
  base: RoleBase | undefined,
  remoteVersion: number | undefined,
): boolean {
  return (
    base !== undefined &&
    remoteVersion !== undefined &&
    base.version !== remoteVersion
  );
}
/** Apply a successful PUT result to one role without wiping other drafts. */
export function applySavedRoleToDraft(
  prev: Record<string, RoleGrantDraft>,
  role: string,
  saved: RoleGrantDraft,
): Record<string, RoleGrantDraft> {
  return {
    ...prev,
    [role]: {
      panels: [...saved.panels],
      actions: [...saved.actions],
    },
  };
}

/** Track concurrent in-flight saves without clobbering sibling roles. */
export function addSavingRole(
  current: ReadonlySet<string>,
  role: string,
): Set<string> {
  const next = new Set(current);
  next.add(role);
  return next;
}

export function removeSavingRole(
  current: ReadonlySet<string>,
  role: string,
): Set<string> {
  const next = new Set(current);
  next.delete(role);
  return next;
}

export function historyStatusFromResult(
  ok: boolean,
  rowCount: number,
): HistoryUiStatus {
  if (!ok) return "error";
  return rowCount === 0 ? "empty" : "success";
}

export function saveFeedbackForPutSuccess(roleLabel: string): SaveFeedback {
  return {
    kind: "ok",
    text: `Запазени права за ${roleLabel}`,
  };
}

export function saveFeedbackForRefreshFailure(
  roleLabel: string,
): SaveFeedback {
  return {
    kind: "saved_refresh_failed",
    text: `Правата за ${roleLabel} са записани, но обновяването на екрана/сесията не успя. Презаредете матрицата, без да записвате отново.`,
  };
}

export function saveFeedbackForConflict(): SaveFeedback {
  return {
    kind: "conflict",
    text: "Матрицата е променена от друг администратор. Презаредете и опитайте отново.",
  };
}

/** Save blocked locally: the role changed remotely since this draft was started. */
export function saveFeedbackForDraftConflict(roleLabel: string): SaveFeedback {
  return {
    kind: "conflict",
    text: `Правата за ${roleLabel} са променени от друг администратор, след като започнахте редакцията. Приемете сървърната версия (или презаредете), за да продължите.`,
  };
}
