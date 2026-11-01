/**
 * Pure helpers for ControlPage refresh, drafts, assignee defaults, and
 * section loading. Framework-free so node:test can lock BUG-01/02/05–10.
 */
import type { Role } from "../api/capabilities";

/** Create-task assignee: distinguish never-touched from explicit Unassigned (`""`). */
export type TaskAssigneeState =
  | { status: "uninitialized" }
  | { status: "chosen"; employeeId: string };

export function defaultTaskAssigneeIfNeeded(
  current: TaskAssigneeState,
  firstHousekeeperId: string | undefined,
): TaskAssigneeState {
  if (current.status === "chosen") return current;
  if (firstHousekeeperId) {
    return { status: "chosen", employeeId: firstHousekeeperId };
  }
  return { status: "chosen", employeeId: "" };
}

export function taskAssigneeSelectValue(state: TaskAssigneeState): string {
  return state.status === "chosen" ? state.employeeId : "";
}

/** Payload for createCleaningTask — empty string → omit assignee. */
export function assignedEmployeeIdPayload(
  state: TaskAssigneeState,
): string | undefined {
  if (state.status !== "chosen") return undefined;
  return state.employeeId || undefined;
}

export type PersonRoleRow = {
  userId: string | null;
  role: Role | null;
};

/** Last-known server roles keyed by userId. */
export function serverRolesFromPeople(
  people: readonly PersonRoleRow[],
): Record<string, Role> {
  const next: Record<string, Role> = {};
  for (const person of people) {
    if (person.userId && person.role) next[person.userId] = person.role;
  }
  return next;
}

export type RoleDraftConflict = {
  userId: string;
  draft: Role;
  server: Role;
};

/**
 * Merge server people into role drafts without wiping unsaved edits.
 * - Clean rows take the server role.
 * - Dirty rows keep the draft; if the server role also moved, report a conflict.
 * - `replaceUserIds` (just-saved) force-sync from server.
 * - Busy rows keep their draft even if clean on the previous snapshot.
 */
export function mergeRoleDraftsOnRefresh(input: {
  prevDrafts: Record<string, Role>;
  prevServerRoles: Record<string, Role>;
  nextPeople: readonly PersonRoleRow[];
  replaceUserIds?: ReadonlySet<string>;
  busyUserIds?: ReadonlySet<string>;
}): {
  drafts: Record<string, Role>;
  serverRoles: Record<string, Role>;
  conflicts: RoleDraftConflict[];
} {
  const serverRoles = serverRolesFromPeople(input.nextPeople);
  const drafts: Record<string, Role> = {};
  const conflicts: RoleDraftConflict[] = [];

  for (const [userId, serverRole] of Object.entries(serverRoles)) {
    const prevDraft = input.prevDrafts[userId];
    const prevServer = input.prevServerRoles[userId];
    const forceReplace = input.replaceUserIds?.has(userId) === true;
    const busy = input.busyUserIds?.has(userId) === true;

    if (forceReplace) {
      drafts[userId] = serverRole;
      continue;
    }

    const dirty =
      prevDraft !== undefined &&
      prevServer !== undefined &&
      prevDraft !== prevServer;

    if (busy || dirty) {
      const keep = prevDraft ?? serverRole;
      drafts[userId] = keep;
      if (
        dirty &&
        prevServer !== undefined &&
        serverRole !== prevServer &&
        keep !== serverRole
      ) {
        conflicts.push({ userId, draft: keep, server: serverRole });
      }
      continue;
    }

    drafts[userId] = serverRole;
  }

  return { drafts, serverRoles, conflicts };
}

export type PersonAssigneeRow = {
  id: string;
  role: Role | null;
  fullName: string;
};

/** Repair assign picker — independent of the Roles search filter. */
export function techniciansFromPeople(
  people: readonly PersonAssigneeRow[],
): PersonAssigneeRow[] {
  return people.filter(
    (p) => p.role === "technician" || p.role === "supervisor",
  );
}

export type ControlSectionKey =
  | "people"
  | "assignees"
  | "openTickets"
  | "recentTickets"
  | "rooms"
  | "housekeepers";

export type ControlLoadPlan = Record<ControlSectionKey, boolean>;

/** Which Control fetches to issue for the current capability set. */
export function controlLoadPlan(perms: {
  canChangeRole: boolean;
  canCreateCleaning: boolean;
  canWorkTickets: boolean;
}): ControlLoadPlan {
  return {
    people: perms.canChangeRole,
    assignees: perms.canWorkTickets,
    openTickets: perms.canWorkTickets,
    recentTickets: perms.canWorkTickets,
    rooms: perms.canCreateCleaning,
    housekeepers: perms.canCreateCleaning,
  };
}

export type SectionResult<T> =
  | { status: "ok"; data: T }
  | { status: "error"; message: string }
  | { status: "skipped" };

export function sectionFromSettled<T>(
  settled: PromiseSettledResult<T> | undefined,
  enabled: boolean,
): SectionResult<T> {
  if (!enabled) return { status: "skipped" };
  if (!settled) {
    return { status: "error", message: "Missing section result" };
  }
  if (settled.status === "fulfilled") {
    return { status: "ok", data: settled.value };
  }
  const reason = settled.reason;
  return {
    status: "error",
    message: reason instanceof Error ? reason.message : String(reason),
  };
}

/** Await an optional promise as a settled result without rejecting the parent. */
export async function settleOptional<T>(
  promise: Promise<T> | null,
): Promise<PromiseSettledResult<T> | undefined> {
  if (!promise) return undefined;
  try {
    return { status: "fulfilled", value: await promise };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

/** Stale HTTP responses must not clobber a newer refresh generation. */
export function shouldApplyControlRefresh(
  responseGen: number,
  currentGen: number,
): boolean {
  return responseGen === currentGen;
}

/**
 * After a confirmed mutation, a failed follow-up refresh must not look like
 * a failed write — keep the success message and surface a separate warning.
 */
export function mergeMutationAndRefresh(input: {
  successMessage: string;
  refreshError?: string | null;
}): { message: string; refreshWarning: string | null } {
  return {
    message: input.successMessage,
    refreshWarning: input.refreshError ?? null,
  };
}

export function formatRoleConflicts(
  conflicts: readonly RoleDraftConflict[],
  nameByUserId: Record<string, string>,
): string | null {
  if (conflicts.length === 0) return null;
  const names = conflicts.map(
    (c) => nameByUserId[c.userId] ?? c.userId,
  );
  return `Server role changed for: ${names.join(", ")}. Your unsaved choice was kept — review before saving.`;
}
