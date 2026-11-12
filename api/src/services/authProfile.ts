/**
 * Public auth profile payload (panels/actions/landing) for login and /me.
 */
import { Role } from "@prisma/client";
import { prisma } from "../db";
import { capabilitiesFor } from "./roleGrants";

/** Shape returned to the client after login or /me (panels/actions from RoleGrant). */
export async function publicUser(user: {
  id: string;
  email: string;
  role: Role;
  employeeId: string;
  employee: { fullName: string };
}) {
  // Resolve panel/action grants and landing panel for this role.
  const caps = await capabilitiesFor(user.role);
  // Supervisors get an extra count of sectors they primary-supervise.
  let supervisedSectorCount: number | null = null;
  if (user.role === Role.supervisor) {
    // Database access for this step.
    supervisedSectorCount = await prisma.sector.count({
      where: {
        primarySupervisorEmployeeId: user.employeeId,
        isActive: true,
      },
    });
  }
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    employeeId: user.employeeId,
    fullName: user.employee.fullName,
    panels: caps.panels,
    actions: caps.actions,
    landing: caps.landing,
    supervisedSectorCount,
  };
}
