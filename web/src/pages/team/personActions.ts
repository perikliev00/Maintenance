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

  switch (status) {
    case "active":
      actions.push("block", "archive");
      break;
    case "blocked":
      actions.push("unblock", "archive");
      break;
    case "not_activated":
      actions.push("archive");
      break;
    case "archived":
      actions.push("restore");
      break;
    default:
      break;
  }
  return actions;
}
