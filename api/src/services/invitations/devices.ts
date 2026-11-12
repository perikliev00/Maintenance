/**
 * Activated device listing and revocation (also revokes auth sessions for the device).
 * Client DTOs omit fingerprint (not an identity proof in the UI).
 * Revoke enforces the same privileged-target policy as people lifecycle.
 */
import type { Role } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module ../../events/bus for this service.
import { publish } from "../../events/bus";
// Import module ../audit for this service.
import { recordAudit } from "../audit";
// Import module ../liveAccessLocks for this service.
import { lockUsersForLiveAccess } from "../liveAccessLocks";
// Import module ../people/lifecycle for this service.
import { canManagePersonAccess } from "../people/lifecycle";

/** Public device row for Team / admin UIs (no fingerprint). */
export type DeviceDto = {
  // Set id on the structure being built.
  id: string;
  // Set label on the structure being built.
  label: string;
  // Set employeeId on the structure being built.
  employeeId: string;
  // Set userId on the structure being built.
  userId: string;
  // Set fullName on the structure being built.
  fullName: string;
  // Set employeeNumber on the structure being built.
  employeeNumber: string;
  // Set email on the structure being built.
  email: string;
  // Set role on the structure being built.
  role: string;
  // Set activatedAt on the structure being built.
  activatedAt: string;
  // Set lastSeenAt on the structure being built.
  lastSeenAt: string;
};

// Declare type DeviceRevokeActor for callers and internals.
export type DeviceRevokeActor = {
  // Set employeeId on the structure being built.
  employeeId: string;
  // Set role on the structure being built.
  role: Role;
};

/** List non-revoked devices, optionally filtered to one employee. */
export async function listDevices(employeeId?: string): Promise<DeviceDto[]> {
  // Load devices asynchronously for the next steps.
  const devices = await prisma.device.findMany({
    // Set where on the structure being built.
    where: {
      // Set revokedAt on the structure being built.
      revokedAt: null,
      // Run next step: ...(employeeId ? { employeeId } : {}),
      ...(employeeId ? { employeeId } : {}),
    },
    // Set include on the structure being built.
    include: {
      // Set employee on the structure being built.
      employee: true,
      // Set user on the structure being built.
      user: { select: { email: true, role: true } },
    },
    // Set orderBy on the structure being built.
    orderBy: { activatedAt: "desc" },
  });
  // Return the computed result to the caller.
  return devices.map((d) => ({
    // Set id on the structure being built.
    id: d.id,
    // Set label on the structure being built.
    label: d.label,
    // Set employeeId on the structure being built.
    employeeId: d.employeeId,
    // Set userId on the structure being built.
    userId: d.userId,
    // Set fullName on the structure being built.
    fullName: d.employee.fullName,
    // Set employeeNumber on the structure being built.
    employeeNumber: d.employee.employeeNumber,
    // Set email on the structure being built.
    email: d.user.email,
    // Set role on the structure being built.
    role: d.user.role,
    // Set activatedAt on the structure being built.
    activatedAt: d.activatedAt.toISOString(),
    // Set lastSeenAt on the structure being built.
    lastSeenAt: d.lastSeenAt.toISOString(),
  }));
}

/**
 * Revoke a device and all of its active auth sessions in one transaction.
 * Idempotent conflict when already revoked. Privilege checked under User lock.
 */
export async function revokeDevice(
  // Set id on the structure being built.
  id: string,
  // Set actor on the structure being built.
  actor: DeviceRevokeActor,
// Run next step: ): Promise<{ id: string; revokedAt: string; revokedOwnDevice…
): Promise<{ id: string; revokedAt: string; revokedOwnDevice: boolean }> {
  // Load result asynchronously for the next steps.
  const result = await prisma.$transaction(async (tx) => {
    // Load device asynchronously for the next steps.
    const device = await tx.device.findUnique({ where: { id } });
    // Branch when this condition holds so the right path runs.
    if (!device) {
      // Abort with an error so callers can react.
      throw new AppError(404, "not_found", "Device not found");
    }
    // Branch when this condition holds so the right path runs.
    if (device.revokedAt) {
      // Abort with an error so callers can react.
      throw new AppError(409, "conflict", "Device already revoked");
    }

    // Wait for the async step before continuing.
    await lockUsersForLiveAccess(tx, [device.userId]);

    // Load owner asynchronously for the next steps.
    const owner = await tx.user.findUnique({
      // Set where on the structure being built.
      where: { id: device.userId },
      // Set select on the structure being built.
      select: { id: true, role: true },
    });
    // Branch when this condition holds so the right path runs.
    if (!owner) {
      // Abort with an error so callers can react.
      throw new AppError(404, "not_found", "Device owner not found");
    }
    // Branch when this condition holds so the right path runs.
    if (!canManagePersonAccess(actor.role, owner.role)) {
      // Abort with an error so callers can react.
      throw new AppError(
        // Run next step: 403,
        403,
        // Run next step: "forbidden",
        "forbidden",
        // Run next step: "Cannot manage access for owner/admin accounts",
        "Cannot manage access for owner/admin accounts",
      );
    }

    // Capture now for use in this scope.
    const now = new Date();
    // Load updated asynchronously for the next steps.
    const updated = await tx.device.updateMany({
      // Set where on the structure being built.
      where: { id, revokedAt: null },
      // Set data on the structure being built.
      data: { revokedAt: now },
    });
    // Branch when this condition holds so the right path runs.
    if (updated.count === 0) {
      // Abort with an error so callers can react.
      throw new AppError(409, "conflict", "Device already revoked");
    }

    // Wait for the async step before continuing.
    await tx.authSession.updateMany({
      // Set where on the structure being built.
      where: { deviceId: id, revokedAt: null },
      // Set data on the structure being built.
      data: { revokedAt: now },
    });

    // Wait for the async step before continuing.
    await recordAudit(
      // Run next step: {
      {
        // Set actorEmployeeId on the structure being built.
        actorEmployeeId: actor.employeeId,
        // Set action on the structure being built.
        action: "device.revoke",
        // Set entityType on the structure being built.
        entityType: "device",
        // Set entityId on the structure being built.
        entityId: id,
        // Set before on the structure being built.
        before: { revokedAt: null, employeeId: device.employeeId },
        // Set after on the structure being built.
        after: { revokedAt: now.toISOString() },
        // Set summary on the structure being built.
        summary: `Revoked device registration ${device.label}`,
      },
      // Run next step: tx,
      tx,
    );

    // Capture revoked own device for use in this scope.
    const revokedOwnDevice = actor.employeeId === device.employeeId;

    // Return the computed result to the caller.
    return {
      // Run next step: id,
      id,
      // Set revokedAt on the structure being built.
      revokedAt: now.toISOString(),
      // Run next step: revokedOwnDevice,
      revokedOwnDevice,
    };
  });

  // Run next step: publish("people.changed");
  publish("people.changed");
  // Return the computed result to the caller.
  return result;
}
