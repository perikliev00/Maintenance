// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../errors for this service.
import { AppError } from "../../errors";

/** Validate attribution before applying commands or persisting sync activity. */
export async function assertSyncDevice(userId: string, deviceId?: string) {
  // Branch when this condition holds so the right path runs.
  if (deviceId === undefined) return;
  // Load device asynchronously for the next steps.
  const device = await prisma.device.findFirst({
    // Set where on the structure being built.
    where: { id: deviceId, userId, revokedAt: null }, select: { id: true },
  });
  // Branch when this condition holds so the right path runs.
  if (!device) throw new AppError(403, "invalid_device", "Device is not active for this account");
}
