/**
 * Pure helpers for PermissionsPage draft merge, save phases, and history UI.
 */
export type RoleGrantDraft = { panels: string[]; actions: string[] };

export type HistoryUiStatus = "idle" | "loading" | "success" | "empty" | "error";

export type SaveFeedback =
  | { kind: "ok"; text: string }
  | { kind: "saved_refresh_failed"; text: string }
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

/**
 * After a full matrix fetch: keep dirty drafts for roles other than
 * `replacedRole` (the role just saved or conflict-reloaded).
 */
export function mergeMatrixIntoDraft(
  prev: Record<string, RoleGrantDraft>,
  byRole: Record<string, RoleGrantDraft>,
  roles: string[],
  replacedRole?: string,
): Record<string, RoleGrantDraft> {
  const next: Record<string, RoleGrantDraft> = {};
  for (const role of roles) {
    const server = {
      panels: [...(byRole[role]?.panels ?? [])],
      actions: [...(byRole[role]?.actions ?? [])],
    };
    if (
      replacedRole &&
      role !== replacedRole &&
      isRoleDraftDirty(prev[role], byRole[role])
    ) {
      next[role] = prev[role]!;
    } else {
      next[role] = server;
    }
  }
  return next;
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
