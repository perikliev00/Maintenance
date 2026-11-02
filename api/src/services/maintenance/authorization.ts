import { Role } from "@prisma/client";
import { canBypassAssignee } from "../authorization/assigneeBypass";

/** Roles permitted to progress a ticket assigned to another employee. */
export function canBypassTicketAssignee(role: Role): boolean {
  return canBypassAssignee(role);
}
