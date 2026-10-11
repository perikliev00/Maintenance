import { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import type { AuthUser } from "../../middleware/auth";
import { recordAudit } from "../audit";
import { applyCommand } from "./applyCommand";
import type { SyncCommand, SyncCommandResult } from "./types";

export async function pushSync(input: {
  user: AuthUser;
  commands: SyncCommand[];
  deviceId?: string;
}) {
  const startedAt = new Date();
  const results: SyncCommandResult[] = [];
  for (const cmd of input.commands) {
    results.push(await applyCommand(input.user, cmd));
  }
  const accepted = results.filter((r) => r.status === "ok").length;
  const rejected = results.length - accepted;
  const conflicts = results.filter((r) => r.status !== "ok");

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

  if (input.deviceId) {
    await prisma.device.updateMany({
      where: { id: input.deviceId, userId: input.user.userId },
      data: { lastSyncedAt: new Date(), lastSeenAt: new Date() },
    });
  }

  await recordAudit({
    actorEmployeeId: input.user.employeeId,
    action: "sync.push",
    entityType: "sync_run",
    entityId: syncRun.id,
    after: { accepted, rejected, commandCount: input.commands.length },
  });

  return { syncRunId: syncRun.id, results, serverTime: new Date().toISOString() };
}
