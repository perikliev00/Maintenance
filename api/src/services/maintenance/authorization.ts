import { Role } from "@prisma/client";

/** Roles permitted to progress a ticket assigned to another employee. */
export function canBypassTicketAssignee(role: Role): boolean {
  return (
    role === Role.owner ||
    role === Role.supervisor ||
    role === Role.manager ||
    role === Role.admin ||
    role === Role.reception
  );
}
