/**
 * Pure helpers for ControlPage refresh, drafts, assignee defaults, and
 * section loading. Framework-free so node:test can lock BUG-01/02/05–10.
 */
import type { Role } from "../api/capabilities";
// Import module dependency from ../saveRefresh.
import { mergeSavedWithRefreshFailure } from "../saveRefresh";

/** Create-task assignee: distinguish never-touched from explicit Unassigned (`""`). */
export type TaskAssigneeState =
  // Support the surrounding logic for this step.
  | { status: "uninitialized" }
  // Support the surrounding logic for this step.
  | { status: "chosen"; employeeId: string };

// Export function defaultTaskAssigneeIfNeeded as part of this module's API.
export function defaultTaskAssigneeIfNeeded(
  // Provide current field used by this structure.
  current: TaskAssigneeState,
  // Provide firstHousekeeperId field used by this structure.
  firstHousekeeperId: string | undefined,
// Support the surrounding logic for this step.
): TaskAssigneeState {
  // Conditional branch for the case described by this guard.
  if (current.status === "chosen") return current;
  // Conditional branch for the case described by this guard.
  if (firstHousekeeperId) {
    // Return early result or rendered output from this path.
    return { status: "chosen", employeeId: firstHousekeeperId };
  }
  // Return early result or rendered output from this path.
  return { status: "chosen", employeeId: "" };
}

// Export function taskAssigneeSelectValue as part of this module's API.
export function taskAssigneeSelectValue(state: TaskAssigneeState): string {
  // Return early result or rendered output from this path.
  return state.status === "chosen" ? state.employeeId : "";
}

/** Payload for createCleaningTask — empty string → omit assignee. */
export function assignedEmployeeIdPayload(
  // Provide state field used by this structure.
  state: TaskAssigneeState,
// Support the surrounding logic for this step.
): string | undefined {
  // Conditional branch for the case described by this guard.
  if (state.status !== "chosen") return undefined;
  // Return early result or rendered output from this path.
  return state.employeeId || undefined;
}

// Export type definition for consumers of this module.
export type PersonRoleRow = {
  // Provide userId field used by this structure.
  userId: string | null;
  // Provide role field used by this structure.
  role: Role | null;
};

/** Last-known server roles keyed by userId. */
export function serverRolesFromPeople(
  // Provide people field used by this structure.
  people: readonly PersonRoleRow[],
// Support the surrounding logic for this step.
): Record<string, Role> {
  // Initialize an object holding related fields.
  const next: Record<string, Role> = {};
  // Iterate a collection or counted range.
  for (const person of people) {
    // Conditional branch for the case described by this guard.
    if (person.userId && person.role) next[person.userId] = person.role;
  }
  // Return early result or rendered output from this path.
  return next;
}

// Export type definition for consumers of this module.
export type RoleDraftConflict = {
  // Provide userId field used by this structure.
  userId: string;
  // Provide draft field used by this structure.
  draft: Role;
  // Provide server field used by this structure.
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
  // Provide prevDrafts field used by this structure.
  prevDrafts: Record<string, Role>;
  // Provide prevServerRoles field used by this structure.
  prevServerRoles: Record<string, Role>;
  // Provide nextPeople field used by this structure.
  nextPeople: readonly PersonRoleRow[];
  // Support the surrounding logic for this step.
  replaceUserIds?: ReadonlySet<string>;
  // Support the surrounding logic for this step.
  busyUserIds?: ReadonlySet<string>;
// Support the surrounding logic for this step.
}): {
  // Provide drafts field used by this structure.
  drafts: Record<string, Role>;
  // Provide serverRoles field used by this structure.
  serverRoles: Record<string, Role>;
  // Provide conflicts field used by this structure.
  conflicts: RoleDraftConflict[];
// Support the surrounding logic for this step.
} {
  // Bind serverRoles for use in the following logic.
  const serverRoles = serverRolesFromPeople(input.nextPeople);
  // Initialize an object holding related fields.
  const drafts: Record<string, Role> = {};
  // Initialize an array used by subsequent logic.
  const conflicts: RoleDraftConflict[] = [];

  // Iterate a collection or counted range.
  for (const [userId, serverRole] of Object.entries(serverRoles)) {
    // Bind prevDraft for use in the following logic.
    const prevDraft = input.prevDrafts[userId];
    // Bind prevServer for use in the following logic.
    const prevServer = input.prevServerRoles[userId];
    // Bind forceReplace for use in the following logic.
    const forceReplace = input.replaceUserIds?.has(userId) === true;
    // Bind busy for use in the following logic.
    const busy = input.busyUserIds?.has(userId) === true;

    // Conditional branch for the case described by this guard.
    if (forceReplace) {
      // Support the surrounding logic for this step.
      drafts[userId] = serverRole;
      // Skip to the next loop iteration.
      continue;
    }

    // Bind dirty for use in the following logic.
    const dirty =
      // Support the surrounding logic for this step.
      prevDraft !== undefined &&
      // Support the surrounding logic for this step.
      prevServer !== undefined &&
      // Support the surrounding logic for this step.
      prevDraft !== prevServer;

    // Conditional branch for the case described by this guard.
    if (busy || dirty) {
      // Bind keep for use in the following logic.
      const keep = prevDraft ?? serverRole;
      // Support the surrounding logic for this step.
      drafts[userId] = keep;
      // Conditional branch for the case described by this guard.
      if (
        // Support the surrounding logic for this step.
        dirty &&
        // Support the surrounding logic for this step.
        prevServer !== undefined &&
        // Support the surrounding logic for this step.
        serverRole !== prevServer &&
        // Support the surrounding logic for this step.
        keep !== serverRole
      // Support the surrounding logic for this step.
      ) {
        // Invoke conflicts.push to perform this step.
        conflicts.push({ userId, draft: keep, server: serverRole });
      }
      // Skip to the next loop iteration.
      continue;
    }

    // Support the surrounding logic for this step.
    drafts[userId] = serverRole;
  }

  // Return early result or rendered output from this path.
  return { drafts, serverRoles, conflicts };
}

// Export type definition for consumers of this module.
export type PersonAssigneeRow = {
  // Provide id field used by this structure.
  id: string;
  // Provide role field used by this structure.
  role: Role | null;
  // Provide fullName field used by this structure.
  fullName: string;
};

/** Repair assign picker — independent of the Roles search filter. */
export function techniciansFromPeople(
  // Provide people field used by this structure.
  people: readonly PersonAssigneeRow[],
// Support the surrounding logic for this step.
): PersonAssigneeRow[] {
  // Return early result or rendered output from this path.
  return people.filter(
    // Support the surrounding logic for this step.
    (p) => p.role === "technician" || p.role === "supervisor",
  );
}

// Export type definition for consumers of this module.
export type ControlSectionKey =
  // Support the surrounding logic for this step.
  | "people"
  // Support the surrounding logic for this step.
  | "assignees"
  // Support the surrounding logic for this step.
  | "openTickets"
  // Support the surrounding logic for this step.
  | "recentTickets"
  // Support the surrounding logic for this step.
  | "rooms"
  // Support the surrounding logic for this step.
  | "housekeepers";

// Export type definition for consumers of this module.
export type ControlLoadPlan = Record<ControlSectionKey, boolean>;

/** Which Control fetches to issue for the current capability set. */
export function controlLoadPlan(perms: {
  // Provide canChangeRole field used by this structure.
  canChangeRole: boolean;
  // Provide canCreateCleaning field used by this structure.
  canCreateCleaning: boolean;
  // Provide canWorkTickets field used by this structure.
  canWorkTickets: boolean;
// Support the surrounding logic for this step.
}): ControlLoadPlan {
  // Return early result or rendered output from this path.
  return {
    // Provide people field used by this structure.
    people: perms.canChangeRole,
    // Provide assignees field used by this structure.
    assignees: perms.canWorkTickets,
    // Provide openTickets field used by this structure.
    openTickets: perms.canWorkTickets,
    // Provide recentTickets field used by this structure.
    recentTickets: perms.canWorkTickets,
    // Provide rooms field used by this structure.
    rooms: perms.canCreateCleaning,
    // Provide housekeepers field used by this structure.
    housekeepers: perms.canCreateCleaning,
  };
}

// Export type definition for consumers of this module.
export type SectionResult<T> =
  // Support the surrounding logic for this step.
  | { status: "ok"; data: T }
  // Support the surrounding logic for this step.
  | { status: "error"; message: string }
  // Support the surrounding logic for this step.
  | { status: "skipped" };

// Export function sectionFromSettled as part of this module's API.
export function sectionFromSettled<T>(
  // Provide settled field used by this structure.
  settled: PromiseSettledResult<T> | undefined,
  // Provide enabled field used by this structure.
  enabled: boolean,
// Support the surrounding logic for this step.
): SectionResult<T> {
  // Conditional branch for the case described by this guard.
  if (!enabled) return { status: "skipped" };
  // Conditional branch for the case described by this guard.
  if (!settled) {
    // Return early result or rendered output from this path.
    return { status: "error", message: "Missing section result" };
  }
  // Conditional branch for the case described by this guard.
  if (settled.status === "fulfilled") {
    // Return early result or rendered output from this path.
    return { status: "ok", data: settled.value };
  }
  // Bind reason for use in the following logic.
  const reason = settled.reason;
  // Return early result or rendered output from this path.
  return {
    // Provide status field used by this structure.
    status: "error",
    // Provide message field used by this structure.
    message: reason instanceof Error ? reason.message : String(reason),
  };
}

/** Await an optional promise as a settled result without rejecting the parent. */
export async function settleOptional<T>(
  // Provide promise field used by this structure.
  promise: Promise<T> | null,
// Support the surrounding logic for this step.
): Promise<PromiseSettledResult<T> | undefined> {
  // Conditional branch for the case described by this guard.
  if (!promise) return undefined;
  // Begin guarded block to catch runtime failures.
  try {
    // Return early result or rendered output from this path.
    return { status: "fulfilled", value: await promise };
  // Support the surrounding logic for this step.
  } catch (reason) {
    // Return early result or rendered output from this path.
    return { status: "rejected", reason };
  }
}

/**
 * Error slots, in the fixed order the first-error banner uses. Each slot is
 * owned by exactly one Control section (see `sectionErrorViews`).
 */
export const CONTROL_ERROR_KEYS = [
  // Support the surrounding logic for this step.
  "people",
  // Support the surrounding logic for this step.
  "assignees",
  // Support the surrounding logic for this step.
  "openTickets",
  // Support the surrounding logic for this step.
  "resolvedTickets",
  // Support the surrounding logic for this step.
  "closedTickets",
  // Support the surrounding logic for this step.
  "rooms",
  // Support the surrounding logic for this step.
  "housekeepers",
// Support the surrounding logic for this step.
] as const;

// Export type definition for consumers of this module.
export type ControlErrorKey = (typeof CONTROL_ERROR_KEYS)[number];
// Export type definition for consumers of this module.
export type ControlSectionErrors = Partial<Record<ControlErrorKey, string>>;

/**
 * Outcome of one section load. `stale` = a newer load of that section
 * superseded it (or the page unmounted): nothing was applied or reported.
 * `scope` lists every error slot the load covers, so a success clears them.
 */
export type SectionLoadResult =
  // Support the surrounding logic for this step.
  | { status: "stale" }
  // Support the surrounding logic for this step.
  | {
      // Provide status field used by this structure.
      status: "done";
      // Provide scope field used by this structure.
      scope: readonly ControlErrorKey[];
      // Provide errors field used by this structure.
      errors: ControlSectionErrors;
    };

/** Replace only the slots a load covered; other sections' errors survive. */
export function replaceSectionErrors(
  // Provide prev field used by this structure.
  prev: ControlSectionErrors,
  // Provide scope field used by this structure.
  scope: readonly ControlErrorKey[],
  // Provide next field used by this structure.
  next: ControlSectionErrors,
// Support the surrounding logic for this step.
): ControlSectionErrors {
  // Initialize an object holding related fields.
  const merged: ControlSectionErrors = { ...prev };
  // Iterate a collection or counted range.
  for (const key of scope) delete merged[key];
  // Iterate a collection or counted range.
  for (const key of CONTROL_ERROR_KEYS) {
    // Bind message for use in the following logic.
    const message = next[key];
    // Conditional branch for the case described by this guard.
    if (message !== undefined) merged[key] = message;
  }
  // Return early result or rendered output from this path.
  return merged;
}

// Export function firstSectionError as part of this module's API.
export function firstSectionError(
  // Provide errors field used by this structure.
  errors: ControlSectionErrors,
// Support the surrounding logic for this step.
): string | undefined {
  // Iterate a collection or counted range.
  for (const key of CONTROL_ERROR_KEYS) {
    // Bind message for use in the following logic.
    const message = errors[key];
    // Conditional branch for the case described by this guard.
    if (message !== undefined) return message;
  }
  // Return early result or rendered output from this path.
  return undefined;
}

/**
 * Page-level error banner after a section load: surface the first section
 * error only during the initial load; otherwise clear it once no section is
 * failing; else leave whatever (e.g. an action error) is showing.
 */
export function bannerAfterLoad(
  // Provide errors field used by this structure.
  errors: ControlSectionErrors,
  // Provide initialLoading field used by this structure.
  initialLoading: boolean,
// Support the surrounding logic for this step.
): { action: "set"; message: string } | { action: "clear" } | { action: "keep" } {
  // Bind first for use in the following logic.
  const first = firstSectionError(errors);
  // Conditional branch for the case described by this guard.
  if (first !== undefined && initialLoading) {
    // Return early result or rendered output from this path.
    return { action: "set", message: first };
  }
  // Conditional branch for the case described by this guard.
  if (first === undefined) return { action: "clear" };
  // Return early result or rendered output from this path.
  return { action: "keep" };
}

/** Per-section error text; one failing section never hides another's data. */
export function sectionErrorViews(errors: ControlSectionErrors): {
  // Provide peopleError field used by this structure.
  peopleError: string | undefined;
  // Provide ticketsError field used by this structure.
  ticketsError: string | undefined;
  // Provide recentError field used by this structure.
  recentError: string | undefined;
  // Provide cleaningError field used by this structure.
  cleaningError: string | undefined;
// Support the surrounding logic for this step.
} {
  // Return early result or rendered output from this path.
  return {
    // Provide peopleError field used by this structure.
    peopleError: errors.people,
    // Provide ticketsError field used by this structure.
    ticketsError: errors.openTickets ?? errors.assignees,
    // Provide recentError field used by this structure.
    recentError: errors.resolvedTickets ?? errors.closedTickets,
    // Provide cleaningError field used by this structure.
    cleaningError: errors.rooms ?? errors.housekeepers,
  };
}

/**
 * Recent tickets = resolved ∪ closed (deduped by id). Only the feeds that
 * loaded take part; returns null when neither loaded (keep the old list).
 */
export function mergeRecentTickets<T extends { id: string }>(
  // Provide resolved field used by this structure.
  resolved: readonly T[] | undefined,
  // Provide closed field used by this structure.
  closed: readonly T[] | undefined,
// Support the surrounding logic for this step.
): T[] | null {
  // Conditional branch for the case described by this guard.
  if (resolved === undefined && closed === undefined) return null;
  // Create a Set/Map for efficient membership or keyed lookup.
  const byId = new Map<string, T>();
  // Iterate a collection or counted range.
  for (const t of resolved ?? []) byId.set(t.id, t);
  // Iterate a collection or counted range.
  for (const t of closed ?? []) byId.set(t.id, t);
  // Return early result or rendered output from this path.
  return [...byId.values()];
}

/** Stale HTTP responses must not clobber a newer refresh generation. */
export function shouldApplyControlRefresh(
  // Provide responseGen field used by this structure.
  responseGen: number,
  // Provide currentGen field used by this structure.
  currentGen: number,
// Support the surrounding logic for this step.
): boolean {
  // Return early result or rendered output from this path.
  return responseGen === currentGen;
}

/**
 * After a confirmed mutation, a failed follow-up refresh must not look like
 * a failed write — keep the success message and surface a separate warning.
 */
export function mergeMutationAndRefresh(input: {
  // Provide successMessage field used by this structure.
  successMessage: string;
  // Support the surrounding logic for this step.
  refreshError?: string | null;
// Support the surrounding logic for this step.
}): { message: string; refreshWarning: string | null } {
  // Return early result or rendered output from this path.
  return mergeSavedWithRefreshFailure(input);
}

// Export function formatRoleConflicts as part of this module's API.
export function formatRoleConflicts(
  // Provide conflicts field used by this structure.
  conflicts: readonly RoleDraftConflict[],
  // Provide nameByUserId field used by this structure.
  nameByUserId: Record<string, string>,
// Support the surrounding logic for this step.
): string | null {
  // Conditional branch for the case described by this guard.
  if (conflicts.length === 0) return null;
  // Map source items into a derived list for rendering or logic.
  const names = conflicts.map(
    // Support the surrounding logic for this step.
    (c) => nameByUserId[c.userId] ?? c.userId,
  );
  // Return early result or rendered output from this path.
  return `Server role changed for: ${names.join(", ")}. Your unsaved choice was kept — review before saving.`;
}
