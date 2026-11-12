// Prisma client enums and input types.
import { Role } from "@prisma/client";

/**
 * SEC-002: roles that may progress a cleaning task or maintenance ticket
 * assigned to another employee. Separate from RoleGrant checks for
 * cleaning.start / cleaning.complete (and ticket action keys). Single source
 * for cleaning + tickets, HTTP + sync.
 */
export function canBypassAssignee(role: Role): boolean {
  // Return computed result.
  return (
    // Allow owner to match this privilege check.
    role === Role.owner ||
    // Allow supervisor to match this privilege check.
    role === Role.supervisor ||
    // Allow manager to match this privilege check.
    role === Role.manager ||
    // Allow admin to match this privilege check.
    role === Role.admin ||
    // Final allowed role: reception.
    role === Role.reception
  );
}
