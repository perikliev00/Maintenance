/**
 * Apply a batch of offline commands sequentially, persist a SyncRun, and audit.
 * Partial success is allowed (ok + non-ok mixed → status "partial").
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import type { AuthUser } from "../../middleware/auth";
import { recordAudit } from "../audit";
import { applyCommand } from "./applyCommand";
import type { SyncCommand, SyncCommandResult } from "./types";
import { assertSyncDevice } from "./device";

/**
 * Run commands in order (no parallelism — later cmds may depend on earlier state).
 * Records non-ok results under SyncRun.conflicts JSON for ops debugging.
 */
export async function pushSync(input: {
  user: AuthUser;
  commands: SyncCommand[];
  deviceId?: string;
}) {
  await assertSyncDevice(input.user.userId, input.deviceId);
  // Capture start before apply so SyncRun duration covers the whole batch.
  const startedAt = new Date();
  // Sequential apply — later offline cmds may depend on earlier mutations.
  const results: SyncCommandResult[] = [];
  for (const cmd of input.commands) {
    results.push(await applyCommand(input.user, cmd));
  }
  // Count ok vs non-ok for SyncRun status + accepted/rejected columns.
  const accepted = results.filter((r) => r.status === "ok").length;
  const rejected = results.length - accepted;
  // Any non-ok (conflict/forbidden/error) is stored for the sync run record.
  const conflicts = results.filter((r) => r.status !== "ok");

  // Persist run: ok / partial / error from accepted vs rejected counts.
  const syncRun = await prisma.syncRun.create({
    data: {
      userId: input.user.userId,
      deviceId: input.deviceId ?? null,
      direction: "push",
      startedAt,
      finishedAt: new Date(),
      status: rejected === 0 ? "ok" : accepted === 0 ? "error" : "partial",
      accepted,
      rejected,
      conflicts: conflicts.length
        ? (conflicts as unknown as Prisma.InputJsonValue)
        : undefined,
    },
  });

  // Refresh device sync timestamps when the client sent a deviceId.
  if (input.deviceId) {
    await prisma.device.updateMany({
      where: { id: input.deviceId, userId: input.user.userId, revokedAt: null },
      data: { lastSyncedAt: new Date(), lastSeenAt: new Date() },
    });
  }

  // Audit the batch at SyncRun granularity (not per command).
  await recordAudit({
    actorEmployeeId: input.user.employeeId,
    action: "sync.push",
    entityType: "sync_run",
    entityId: syncRun.id,
    after: { accepted, rejected, commandCount: input.commands.length },
  });

  return { syncRunId: syncRun.id, results, serverTime: new Date().toISOString() };
}
