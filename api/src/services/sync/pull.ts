import { prisma } from "../../db";
import type { AuthUser } from "../../middleware/auth";
import { getMyWork } from "../myWork";

export async function pullSync(input: {
  user: AuthUser;
  since?: Date;
  hotelDate?: string;
  deviceId?: string;
}) {
  const startedAt = new Date();
  const myWork = await getMyWork(input.user, input.hotelDate);

  if (input.deviceId) {
    await prisma.device.updateMany({
      where: { id: input.deviceId, userId: input.user.userId },
      data: { lastSyncedAt: new Date(), lastSeenAt: new Date() },
    });
  }

  const syncRun = await prisma.syncRun.create({
    data: {
      userId: input.user.userId,
      deviceId: input.deviceId ?? null,
      direction: "pull",
      startedAt,
      finishedAt: new Date(),
      status: "ok",
      accepted: myWork.tasks.length + myWork.tickets.length,
      rejected: 0,
    },
  });

  return {
    syncRunId: syncRun.id,
    serverTime: new Date().toISOString(),
    since: input.since?.toISOString() ?? null,
    myWork,
  };
}
