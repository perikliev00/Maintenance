/**
 * Invitation DTO mapping and lazy expiry of past-due issued invites.
 */
import { InvitationStatus, Role } from "@prisma/client";
import { prisma } from "../../db";

/**
 * Map a Prisma invitation (+ employee/creator) to the API shape.
 * Never exposes the raw code hash — only the public codeHint.
 */
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
  // Flatten nested employee/creator joins; never expose the raw code hash.
  return {
    id: inv.id,
    // Public hint only (e.g. last chars) — not the full redeemable code.
    codeHint: inv.codeHint,
    employeeId: inv.employeeId,
    // Denormalize employee display fields for the invitations table.
    fullName: inv.employee.fullName,
    employeeNumber: inv.employee.employeeNumber,
    role: inv.role,
    email: inv.email,
    status: inv.status,
    // Serialize dates as ISO strings for JSON clients.
    expiresAt: inv.expiresAt.toISOString(),
    createdAt: inv.createdAt.toISOString(),
    // Null until redeemed / revoked respectively.
    consumedAt: inv.consumedAt?.toISOString() ?? null,
    revokedAt: inv.revokedAt?.toISOString() ?? null,
    // Creator identity for the "issued by" column.
    createdBy: {
      id: inv.createdBy.id,
      email: inv.createdBy.email,
      fullName: inv.createdBy.employee.fullName,
    },
  };
}

/**
 * Mark issued invitations past expiresAt as expired (best-effort housekeeping).
 * Called lazily from list/issue paths — no separate cron required.
 */
export async function expireStaleInvitations() {
  // Lazy expiry on list/issue paths — no separate cron required.
  await prisma.invitation.updateMany({
    where: {
      // Only still-issued rows; consumed/revoked keep their terminal status.
      status: InvitationStatus.issued,
      // Past the absolute expiry instant.
      expiresAt: { lt: new Date() },
    },
    data: { status: InvitationStatus.expired },
  });
}
