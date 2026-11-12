/**
 * Invitation DTO mapping and lazy expiry of past-due issued invites.
 */
import { InvitationStatus, Role } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";

/**
 * Map a Prisma invitation (+ employee/creator) to the API shape.
 * Never exposes the raw code hash — only the public codeHint.
 */
export function mapInvitation(inv: {
  // Set id on the structure being built.
  id: string;
  // Set codeHint on the structure being built.
  codeHint: string;
  // Set employeeId on the structure being built.
  employeeId: string;
  // Set role on the structure being built.
  role: Role;
  // Set email on the structure being built.
  email: string;
  // Set status on the structure being built.
  status: InvitationStatus;
  // Set expiresAt on the structure being built.
  expiresAt: Date;
  // Set createdAt on the structure being built.
  createdAt: Date;
  // Set consumedAt on the structure being built.
  consumedAt: Date | null;
  // Set revokedAt on the structure being built.
  revokedAt: Date | null;
  // Set employee on the structure being built.
  employee: { fullName: string; employeeNumber: string };
  // Set createdBy on the structure being built.
  createdBy: { id: string; email: string; employee: { fullName: string } };
// Run next step: }) {
}) {
  // Flatten nested employee/creator joins; never expose the raw code hash.
  return {
    // Set id on the structure being built.
    id: inv.id,
    // Public hint only (e.g. last chars) — not the full redeemable code.
    codeHint: inv.codeHint,
    // Set employeeId on the structure being built.
    employeeId: inv.employeeId,
    // Denormalize employee display fields for the invitations table.
    fullName: inv.employee.fullName,
    // Set employeeNumber on the structure being built.
    employeeNumber: inv.employee.employeeNumber,
    // Set role on the structure being built.
    role: inv.role,
    // Set email on the structure being built.
    email: inv.email,
    // Set status on the structure being built.
    status: inv.status,
    // Serialize dates as ISO strings for JSON clients.
    expiresAt: inv.expiresAt.toISOString(),
    // Set createdAt on the structure being built.
    createdAt: inv.createdAt.toISOString(),
    // Null until redeemed / revoked respectively.
    consumedAt: inv.consumedAt?.toISOString() ?? null,
    // Set revokedAt on the structure being built.
    revokedAt: inv.revokedAt?.toISOString() ?? null,
    // Creator identity for the "issued by" column.
    createdBy: {
      // Set id on the structure being built.
      id: inv.createdBy.id,
      // Set email on the structure being built.
      email: inv.createdBy.email,
      // Set fullName on the structure being built.
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
    // Set where on the structure being built.
    where: {
      // Only still-issued rows; consumed/revoked keep their terminal status.
      status: InvitationStatus.issued,
      // Past the absolute expiry instant.
      expiresAt: { lt: new Date() },
    },
    // Set data on the structure being built.
    data: { status: InvitationStatus.expired },
  });
}
