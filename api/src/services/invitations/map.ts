import { InvitationStatus, Role } from "@prisma/client";
import { prisma } from "../../db";

export function mapInvitation(inv: {
  id: string;
  codeHint: string;
  employeeId: string;
  role: Role;
  email: string;
  status: InvitationStatus;
  expiresAt: Date;
  createdAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
  employee: { fullName: string; employeeNumber: string };
  createdBy: { id: string; email: string; employee: { fullName: string } };
}) {
  return {
    id: inv.id,
    codeHint: inv.codeHint,
    employeeId: inv.employeeId,
    fullName: inv.employee.fullName,
    employeeNumber: inv.employee.employeeNumber,
    role: inv.role,
    email: inv.email,
    status: inv.status,
    expiresAt: inv.expiresAt.toISOString(),
    createdAt: inv.createdAt.toISOString(),
    consumedAt: inv.consumedAt?.toISOString() ?? null,
    revokedAt: inv.revokedAt?.toISOString() ?? null,
    createdBy: {
      id: inv.createdBy.id,
      email: inv.createdBy.email,
      fullName: inv.createdBy.employee.fullName,
    },
  };
}

export async function expireStaleInvitations() {
  await prisma.invitation.updateMany({
    where: {
      status: InvitationStatus.issued,
      expiresAt: { lt: new Date() },
    },
    data: { status: InvitationStatus.expired },
  });
}
