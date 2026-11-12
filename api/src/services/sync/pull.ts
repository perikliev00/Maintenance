/**
 * Offline pull: return the caller's my-work snapshot and record a SyncRun.
 * `since` is echoed for clients; filtering is currently not applied server-side.
 */
import { prisma } from "../../db";
// Import type(s) AuthUser for typing without runtime cost.
import type { AuthUser } from "../../auth/tokens";
import { getMyWork } from "../myWork";
import { assertSyncDevice } from "./device";

/**
 * Refresh device lastSyncedAt when deviceId is provided, then return myWork.
 */
export async function pullSync(input: {
  user: AuthUser;
  since?: Date;
  hotelDate?: string;
  deviceId?: string;
}) {
  await assertSyncDevice(input.user.userId, input.deviceId);
  // Capture start before work so SyncRun duration reflects getMyWork cost.
  const startedAt = new Date();
  // Full assigned snapshot; `since` is echoed only (no server-side delta yet).
  const myWork = await getMyWork(input.user, input.hotelDate);

  // Touch device lastSyncedAt/lastSeenAt when the client identified itself.
  if (input.deviceId) {
    await prisma.device.updateMany({
      where: { id: input.deviceId, userId: input.user.userId, revokedAt: null },
      data: { lastSyncedAt: new Date(), lastSeenAt: new Date() },
    });
  }

  // Record the pull for ops debugging (accepted = entity count delivered).
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
