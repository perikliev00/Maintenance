import { Prisma } from "@prisma/client";
import { AppError } from "../../errors";

export type Tx = Prisma.TransactionClient;

export async function lockTask(tx: Tx, taskId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "CleaningTask" WHERE id = ${taskId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new AppError(404, "not_found", "Task not found");
  }
}

export async function lockSession(tx: Tx, sessionId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "CleaningSession" WHERE id = ${sessionId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new AppError(404, "not_found", "Session not found");
  }
}

export async function lockLocation(tx: Tx, locationId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Location" WHERE id = ${locationId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new AppError(404, "not_found", "Room not found");
  }
}
