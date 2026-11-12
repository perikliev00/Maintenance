// Import @prisma/client for cleaning/authorization.ts.
import { Role } from "@prisma/client";
// Import ../authorization/assigneeBypass for cleaning/authorization.ts.
import { canBypassAssignee } from "../authorization/assigneeBypass";

/**
 * SEC-002: assignee bypass for cleaning start/complete. Still requires
 * cleaning.start / cleaning.complete grants; aligned with ticket bypass roles
 * for HTTP + sync.
 */
export function canBypassCleaningAssignee(role: Role): boolean {
  return canBypassAssignee(role);
}
