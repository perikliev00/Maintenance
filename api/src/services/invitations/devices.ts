import { prisma } from "../../db";
import { AppError } from "../../errors";
import { revokeAllForDevice } from "../authSessions";

export async function listDevices(employeeId?: string) {
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

export async function revokeDevice(id: string) {
  const device = await prisma.device.findUnique({ where: { id } });
  if (!device) {
    throw new AppError(404, "not_found", "Device not found");
  }
  if (device.revokedAt) {
    throw new AppError(409, "conflict", "Device already revoked");
  }
  const updated = await prisma.device.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
  await revokeAllForDevice(id);
  return {
    id: updated.id,
    revokedAt: updated.revokedAt!.toISOString(),
  };
}
