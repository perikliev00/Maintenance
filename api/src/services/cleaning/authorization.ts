import { Role } from "@prisma/client";

/**
 * Roles permitted to progress a cleaning task/session assigned to another employee.
 * Aligned with `canBypassTicketAssignee` (SEC-002 / B1) — same role set for HTTP + sync.
 */
export function canBypassCleaningAssignee(role: Role): boolean {
  return (
    role === Role.owner ||
    role === Role.supervisor ||
    role === Role.manager ||
    role === Role.admin ||
    role === Role.reception
  );
}
