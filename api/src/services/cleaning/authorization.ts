import { Role } from "@prisma/client";
import { canBypassAssignee } from "../authorization/assigneeBypass";

/**
 * Roles permitted to progress a cleaning task/session assigned to another employee.
 * Aligned with `canBypassTicketAssignee` (SEC-002 / B1) — same role set for HTTP + sync.
 */
export function canBypassCleaningAssignee(role: Role): boolean {
  return canBypassAssignee(role);
}
