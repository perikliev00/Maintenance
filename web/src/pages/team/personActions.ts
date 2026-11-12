/**
 * Which Team lifecycle actions are available for a person row, given grants
 * and the canonical `status` from the API (not ad-hoc isActive interpretation).
 */
import {
  canManagePersonAccess,
  type Role,
} from "../../api/capabilities";
import type { Person, PersonStatus } from "../../api/peopleApi";

export type PersonLifecycleAction =
  | "view"
  | "block"
  | "unblock"
  | "archive"
  | "restore"
  | "devices";

// Export function normalizePersonStatus as part of this module's API.
export function normalizePersonStatus(person: Person): PersonStatus {
  if (person.status) return person.status;
  if (person.archivedAt) return "archived";
  if (!person.isActive) return "blocked";
  if (!person.onboarded) return "not_activated";
  return "active";
}

/** Re-export for Team UI privilege gating (devices revoke, etc.). */
export { canManagePersonAccess };

/** Actions visible in the row/detail chrome when the actor may manage access. */
export function lifecycleActionsForPerson(
  person: Person,
  canManageAccess: boolean,
  actorRole?: Role,
): PersonLifecycleAction[] {
  const status = normalizePersonStatus(person);
  const actions: PersonLifecycleAction[] = ["view"];
  if (person.deviceCount > 0 || canManageAccess) {
    actions.push("devices");
  }
  if (!canManageAccess) return actions;

  // Privileged targets (owner/admin) are only manageable by owners.
  if (
    actorRole &&
    !canManagePersonAccess(actorRole, person.role)
  ) {
    return actions;
  }

  // Dispatch behavior based on a discrete value.
  switch (status) {
    // Handle one specific switch case value.
    case "active":
      actions.push("block", "archive");
      // Exit the enclosing loop or switch.
      break;
    // Handle one specific switch case value.
    case "blocked":
      actions.push("unblock", "archive");
      // Exit the enclosing loop or switch.
      break;
    // Handle one specific switch case value.
    case "not_activated":
      actions.push("archive");
      // Exit the enclosing loop or switch.
      break;
    // Handle one specific switch case value.
    case "archived":
      actions.push("restore");
      // Exit the enclosing loop or switch.
      break;
    // Handle the default switch case.
    default:
      // Exit the enclosing loop or switch.
      break;
  }
  return actions;
}
