/**
 * Which Team lifecycle actions are available for a person row, given grants
 * and the canonical `status` from the API (not ad-hoc isActive interpretation).
 */
import {
  // Support the surrounding logic for this step.
  canManagePersonAccess,
  // Declare type alias Role.
  type Role,
// Support the surrounding logic for this step.
} from "../../api/capabilities";
// Import type-only dependency for typing without runtime cost.
import type { Person, PersonStatus } from "../../api/peopleApi";

// Export type definition for consumers of this module.
export type PersonLifecycleAction =
  // Support the surrounding logic for this step.
  | "view"
  // Support the surrounding logic for this step.
  | "block"
  // Support the surrounding logic for this step.
  | "unblock"
  // Support the surrounding logic for this step.
  | "archive"
  // Support the surrounding logic for this step.
  | "restore"
  // Support the surrounding logic for this step.
  | "devices";

// Export function normalizePersonStatus as part of this module's API.
export function normalizePersonStatus(person: Person): PersonStatus {
  // Conditional branch for the case described by this guard.
  if (person.status) return person.status;
  // Conditional branch for the case described by this guard.
  if (person.archivedAt) return "archived";
  // Conditional branch for the case described by this guard.
  if (!person.isActive) return "blocked";
  // Conditional branch for the case described by this guard.
  if (!person.onboarded) return "not_activated";
  // Return early result or rendered output from this path.
  return "active";
}

/** Re-export for Team UI privilege gating (devices revoke, etc.). */
export { canManagePersonAccess };

/** Actions visible in the row/detail chrome when the actor may manage access. */
export function lifecycleActionsForPerson(
  // Provide person field used by this structure.
  person: Person,
  // Provide canManageAccess field used by this structure.
  canManageAccess: boolean,
  // Support the surrounding logic for this step.
  actorRole?: Role,
// Support the surrounding logic for this step.
): PersonLifecycleAction[] {
  // Bind status for use in the following logic.
  const status = normalizePersonStatus(person);
  // Initialize an array used by subsequent logic.
  const actions: PersonLifecycleAction[] = ["view"];
  // Conditional branch for the case described by this guard.
  if (person.deviceCount > 0 || canManageAccess) {
    // Invoke actions.push to perform this step.
    actions.push("devices");
  }
  // Conditional branch for the case described by this guard.
  if (!canManageAccess) return actions;

  // Privileged targets (owner/admin) are only manageable by owners.
  if (
    // Support the surrounding logic for this step.
    actorRole &&
    // Support the surrounding logic for this step.
    !canManagePersonAccess(actorRole, person.role)
  // Support the surrounding logic for this step.
  ) {
    // Return early result or rendered output from this path.
    return actions;
  }

  // Dispatch behavior based on a discrete value.
  switch (status) {
    // Handle one specific switch case value.
    case "active":
      // Invoke actions.push to perform this step.
      actions.push("block", "archive");
      // Exit the enclosing loop or switch.
      break;
    // Handle one specific switch case value.
    case "blocked":
      // Invoke actions.push to perform this step.
      actions.push("unblock", "archive");
      // Exit the enclosing loop or switch.
      break;
    // Handle one specific switch case value.
    case "not_activated":
      // Invoke actions.push to perform this step.
      actions.push("archive");
      // Exit the enclosing loop or switch.
      break;
    // Handle one specific switch case value.
    case "archived":
      // Invoke actions.push to perform this step.
      actions.push("restore");
      // Exit the enclosing loop or switch.
      break;
    // Handle the default switch case.
    default:
      // Exit the enclosing loop or switch.
      break;
  }
  // Return early result or rendered output from this path.
  return actions;
}
