/**
 * Activated device listing and revocation (also revokes auth sessions for the device).
 * Client DTOs omit fingerprint (not an identity proof in the UI).
 * Revoke enforces the same privileged-target policy as people lifecycle.
 */
import type { Role } from "@prisma/client";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { publish } from "../../events/bus";
import { recordAudit } from "../audit";
import { lockUsersForLiveAccess } from "../liveAccessLocks";
import { canManagePersonAccess } from "../people/lifecycle";

/** Public device row for Team / admin UIs (no fingerprint). */
export type DeviceDto = {
  id: string;
  label: string;
  employeeId: string;
  userId: string;
  fullName: string;
  employeeNumber: string;
  email: string;
  role: string;
  activatedAt: string;
  lastSeenAt: string;
};

// Declare type DeviceRevokeActor for callers and internals.
export type DeviceRevokeActor = {
  employeeId: string;
  role: Role;
};

/** List non-revoked devices, optionally filtered to one employee. */
export async function listDevices(employeeId?: string): Promise<DeviceDto[]> {
  const devices = await prisma.device.findMany({
    where: {
      revokedAt: null,
      ...(employeeId ? { employeeId } : {}),
    },
    include: {
      employee: true,
      user: { select: { email: true, role: true } },
    },
    orderBy: { activatedAt: "desc" },
  });
  return devices.map((d) => ({
    id: d.id,
    label: d.label,
    employeeId: d.employeeId,
    userId: d.userId,
    fullName: d.employee.fullName,
    employeeNumber: d.employee.employeeNumber,
    email: d.user.email,
    role: d.user.role,
    activatedAt: d.activatedAt.toISOString(),
    lastSeenAt: d.lastSeenAt.toISOString(),
  }));
}

/**
 * Revoke a device and all of its active auth sessions in one transaction.
 * Idempotent conflict when already revoked. Privilege checked under User lock.
 */
export async function revokeDevice(
  id: string,
  actor: DeviceRevokeActor,
): Promise<{ id: string; revokedAt: string; revokedOwnDevice: boolean }> {
  const result = await prisma.$transaction(async (tx) => {
    const device = await tx.device.findUnique({ where: { id } });
    if (!device) {
      throw new AppError(404, "not_found", "Device not found");
    }
    if (device.revokedAt) {
      throw new AppError(409, "conflict", "Device already revoked");
    }

    await lockUsersForLiveAccess(tx, [device.userId]);

    const owner = await tx.user.findUnique({
      where: { id: device.userId },
      select: { id: true, role: true },
    });
    if (!owner) {
      throw new AppError(404, "not_found", "Device owner not found");
    }
    if (!canManagePersonAccess(actor.role, owner.role)) {
      throw new AppError(
        403,
        "forbidden",
        "Cannot manage access for owner/admin accounts",
      );
    }

    const now = new Date();
    const updated = await tx.device.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: now },
    });
    if (updated.count === 0) {
      throw new AppError(409, "conflict", "Device already revoked");
    }

    await tx.authSession.updateMany({
      where: { deviceId: id, revokedAt: null },
      data: { revokedAt: now },
    });

    await recordAudit(
      {
        actorEmployeeId: actor.employeeId,
        action: "device.revoke",
        entityType: "device",
        entityId: id,
        before: { revokedAt: null, employeeId: device.employeeId },
        after: { revokedAt: now.toISOString() },
        summary: `Revoked device registration ${device.label}`,
      },
      tx,
    );

    // Capture revoked own device for use in this scope.
    const revokedOwnDevice = actor.employeeId === device.employeeId;

    return {
      id,
      revokedAt: now.toISOString(),
      revokedOwnDevice,
    };
  });

  publish("people.changed");
  return result;
}
