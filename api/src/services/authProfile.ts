/**
 * Public auth profile payload (panels/actions/landing) for login and /me.
 */
import { Role } from "@prisma/client";
// Shared Prisma client singleton.
import { prisma } from "../db";
// Runtime import from ./roleGrants.
import { capabilitiesFor } from "./roleGrants";

/** Shape returned to the client after login or /me (panels/actions from RoleGrant). */
export async function publicUser(user: {
  // Param id required by this function.
  id: string;
  // Param email required by this function.
  email: string;
  // Param role required by this function.
  role: Role;
  // Param employeeId required by this function.
  employeeId: string;
  // Param employee required by this function.
  employee: { fullName: string };
// Support the surrounding control flow.
}) {
  // Resolve panel/action grants and landing panel for this role.
  const caps = await capabilitiesFor(user.role);
  // Supervisors get an extra count of sectors they primary-supervise.
  let supervisedSectorCount: number | null = null;
  // Role-specific behavior.
  if (user.role === Role.supervisor) {
    // Database access for this step.
    supervisedSectorCount = await prisma.sector.count({
      // Filter matching rows.
      where: {
        // Param primarySupervisorEmployeeId required by this function.
        primarySupervisorEmployeeId: user.employeeId,
        // Param isActive required by this function.
        isActive: true,
      },
    });
  }
  // Return response object.
  return {
    // Param id required by this function.
    id: user.id,
    // Param email required by this function.
    email: user.email,
    // Param role required by this function.
    role: user.role,
    // Param employeeId required by this function.
    employeeId: user.employeeId,
    // Param fullName required by this function.
    fullName: user.employee.fullName,
    // Param panels required by this function.
    panels: caps.panels,
    // Param actions required by this function.
    actions: caps.actions,
    // Param landing required by this function.
    landing: caps.landing,
    supervisedSectorCount,
  };
}
