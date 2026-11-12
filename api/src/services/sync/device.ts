import { prisma } from "../../db";
import { AppError } from "../../errors";

/** Validate attribution before applying commands or persisting sync activity. */
export async function assertSyncDevice(userId: string, deviceId?: string) {
  if (deviceId === undefined) return;
  const device = await prisma.device.findFirst({
    where: { id: deviceId, userId, revokedAt: null }, select: { id: true },
  });
  if (!device) throw new AppError(403, "invalid_device", "Device is not active for this account");
}
