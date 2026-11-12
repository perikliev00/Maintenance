// Import module @prisma/client for this service.
import { Role } from "@prisma/client";
// Import module ../authorization/assigneeBypass for this service.
import { canBypassAssignee } from "../authorization/assigneeBypass";

/** Roles permitted to progress a ticket assigned to another employee. */
export function canBypassTicketAssignee(role: Role): boolean {
  // Return the computed result to the caller.
  return canBypassAssignee(role);
}
