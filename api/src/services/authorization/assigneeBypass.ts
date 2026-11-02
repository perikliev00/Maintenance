import { Role } from "@prisma/client";

/**
 * Roles permitted to progress a cleaning task or maintenance ticket assigned
 * to another employee (SEC-002 / B1). Single source for cleaning + tickets,
 * HTTP + sync.
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
