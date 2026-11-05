import { Role } from "@prisma/client";

/**
 * SEC-002: roles that may progress a cleaning task or maintenance ticket
 * assigned to another employee. Separate from RoleGrant checks for
 * cleaning.start / cleaning.complete (and ticket action keys). Single source
 * for cleaning + tickets, HTTP + sync.
 */
export function canBypassAssignee(role: Role): boolean {
  return (
    role === Role.owner ||
    role === Role.supervisor ||
    role === Role.manager ||
    role === Role.admin ||
    role === Role.reception
  );
}
