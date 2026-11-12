/**
 * Apply a batch of offline commands sequentially, persist a SyncRun, and audit.
 * Partial success is allowed (ok + non-ok mixed → status "partial").
 */
import { Prisma } from "@prisma/client";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import type(s) AuthUser for typing without runtime cost.
import type { AuthUser } from "../../auth/tokens";
// Import module ../audit for this service.
import { recordAudit } from "../audit";
// Import module ./applyCommand for this service.
import { applyCommand } from "./applyCommand";
// Import type(s) SyncCommand, SyncCommandResult for typing without runtime cost.
import type { SyncCommand, SyncCommandResult } from "./types";
// Import module ./device for this service.
import { assertSyncDevice } from "./device";

/**
 * Run commands in order (no parallelism — later cmds may depend on earlier state).
 * Records non-ok results under SyncRun.conflicts JSON for ops debugging.
 */
export async function pushSync(input: {
  // Set user on the structure being built.
  user: AuthUser;
  // Set commands on the structure being built.
  commands: SyncCommand[];
  // Run next step: deviceId?: string;
  deviceId?: string;
// Run next step: }) {
}) {
  // Wait for the async step before continuing.
  await assertSyncDevice(input.user.userId, input.deviceId);
  // Capture start before apply so SyncRun duration covers the whole batch.
  const startedAt = new Date();
  // Sequential apply — later offline cmds may depend on earlier mutations.
  const results: SyncCommandResult[] = [];
  // Iterate items to apply the same logic to each entry.
  for (const cmd of input.commands) {
    // Append an entry to the accumulating collection.
    results.push(await applyCommand(input.user, cmd));
  }
  // Count ok vs non-ok for SyncRun status + accepted/rejected columns.
  const accepted = results.filter((r) => r.status === "ok").length;
  // Capture rejected for use in this scope.
  const rejected = results.length - accepted;
  // Any non-ok (conflict/forbidden/error) is stored for the sync run record.
  const conflicts = results.filter((r) => r.status !== "ok");

  // Persist run: ok / partial / error from accepted vs rejected counts.
  const syncRun = await prisma.syncRun.create({
    // Set data on the structure being built.
    data: {
      // Set userId on the structure being built.
      userId: input.user.userId,
      // Set deviceId on the structure being built.
      deviceId: input.deviceId ?? null,
      // Set direction on the structure being built.
      direction: "push",
      // Run next step: startedAt,
      startedAt,
      // Set finishedAt on the structure being built.
      finishedAt: new Date(),
      // Set status on the structure being built.
      status: rejected === 0 ? "ok" : accepted === 0 ? "error" : "partial",
      // Run next step: accepted,
      accepted,
      // Run next step: rejected,
      rejected,
      // Set conflicts on the structure being built.
      conflicts: conflicts.length
        // Complete the ternary or optional chain started above.
        ? (conflicts as unknown as Prisma.InputJsonValue)
        // Complete the ternary or optional chain started above.
        : undefined,
    },
  });

  // Refresh device sync timestamps when the client sent a deviceId.
  if (input.deviceId) {
    // Wait for the async step before continuing.
    await prisma.device.updateMany({
      // Set where on the structure being built.
      where: { id: input.deviceId, userId: input.user.userId, revokedAt: null },
      // Set data on the structure being built.
      data: { lastSyncedAt: new Date(), lastSeenAt: new Date() },
    });
  }

  // Audit the batch at SyncRun granularity (not per command).
  await recordAudit({
    // Set actorEmployeeId on the structure being built.
    actorEmployeeId: input.user.employeeId,
    // Set action on the structure being built.
    action: "sync.push",
    // Set entityType on the structure being built.
    entityType: "sync_run",
    // Set entityId on the structure being built.
    entityId: syncRun.id,
    // Set after on the structure being built.
    after: { accepted, rejected, commandCount: input.commands.length },
  });

  // Return the computed result to the caller.
  return { syncRunId: syncRun.id, results, serverTime: new Date().toISOString() };
}
