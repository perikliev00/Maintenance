/**
 * Offline pull: return the caller's my-work snapshot and record a SyncRun.
 * `since` is echoed for clients; filtering is currently not applied server-side.
 */
import { prisma } from "../../db";
// Import type(s) AuthUser for typing without runtime cost.
import type { AuthUser } from "../../auth/tokens";
// Import module ../myWork for this service.
import { getMyWork } from "../myWork";
// Import module ./device for this service.
import { assertSyncDevice } from "./device";

/**
 * Refresh device lastSyncedAt when deviceId is provided, then return myWork.
 */
export async function pullSync(input: {
  // Set user on the structure being built.
  user: AuthUser;
  // Run next step: since?: Date;
  since?: Date;
  // Run next step: hotelDate?: string;
  hotelDate?: string;
  // Run next step: deviceId?: string;
  deviceId?: string;
// Run next step: }) {
}) {
  // Wait for the async step before continuing.
  await assertSyncDevice(input.user.userId, input.deviceId);
  // Capture start before work so SyncRun duration reflects getMyWork cost.
  const startedAt = new Date();
  // Full assigned snapshot; `since` is echoed only (no server-side delta yet).
  const myWork = await getMyWork(input.user, input.hotelDate);

  // Touch device lastSyncedAt/lastSeenAt when the client identified itself.
  if (input.deviceId) {
    // Wait for the async step before continuing.
    await prisma.device.updateMany({
      // Set where on the structure being built.
      where: { id: input.deviceId, userId: input.user.userId, revokedAt: null },
      // Set data on the structure being built.
      data: { lastSyncedAt: new Date(), lastSeenAt: new Date() },
    });
  }

  // Record the pull for ops debugging (accepted = entity count delivered).
  const syncRun = await prisma.syncRun.create({
    // Set data on the structure being built.
    data: {
      // Set userId on the structure being built.
      userId: input.user.userId,
      // Set deviceId on the structure being built.
      deviceId: input.deviceId ?? null,
      // Set direction on the structure being built.
      direction: "pull",
      // Run next step: startedAt,
      startedAt,
      // Set finishedAt on the structure being built.
      finishedAt: new Date(),
      // Set status on the structure being built.
      status: "ok",
      // Set accepted on the structure being built.
      accepted: myWork.tasks.length + myWork.tickets.length,
      // Set rejected on the structure being built.
      rejected: 0,
    },
  });

  // Return the computed result to the caller.
  return {
    // Set syncRunId on the structure being built.
    syncRunId: syncRun.id,
    // Set serverTime on the structure being built.
    serverTime: new Date().toISOString(),
    // Set since on the structure being built.
    since: input.since?.toISOString() ?? null,
    // Run next step: myWork,
    myWork,
  };
}
