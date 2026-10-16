/**
 * Activated device listing and revocation (also revokes auth sessions for the device).
 */
import { prisma } from "../../db";
import { AppError } from "../../errors";
import { revokeAllForDevice } from "../authSessions";

/** List non-revoked devices, optionally filtered to one employee. */
export async function listDevices(employeeId?: string) {
  // Active devices only; optional employee filter for people detail views.
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
  // Flatten employee/user joins into the devices admin DTO.
  return devices.map((d) => ({
    id: d.id,
    label: d.label,
    fingerprint: d.fingerprint,
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

/** Revoke a device and all of its active auth sessions. */
export async function revokeDevice(id: string) {
  const device = await prisma.device.findUnique({ where: { id } });
  if (!device) {
    throw new AppError(404, "not_found", "Device not found");
  }
  // Idempotent revoke would hide mistakes; surface conflict instead.
  if (device.revokedAt) {
    throw new AppError(409, "conflict", "Device already revoked");
  }
  // Stamp revokedAt so listDevices stops returning this row.
  const updated = await prisma.device.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  // Kill refresh tokens / sessions bound to this device fingerprint.
  await revokeAllForDevice(id);
  return {
    id: updated.id,
    revokedAt: updated.revokedAt!.toISOString(),
  };
}
