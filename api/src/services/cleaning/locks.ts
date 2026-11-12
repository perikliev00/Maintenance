/**
 * Row-level `FOR UPDATE` locks used inside cleaning transactions to serialize
 * status transitions and cycle ownership checks.
 */
import { AppError } from "../../errors";
// Type-only import from ../db/types used by cleaning/locks.ts.
import type { Tx } from "../db/types";

// Expose selected types from this module.
export type { Tx };

/** Lock a cleaning task row; 404 if missing. */
export async function lockTask(tx: Tx, taskId: string) {
  // Held until the surrounding transaction commits/rolls back.
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "CleaningTask" WHERE id = ${taskId} FOR UPDATE
  `;
  // Missing id — client stale or deleted outside this txn.
  if (rows.length === 0) {
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(404, "not_found", "Task not found");
  }
}

/** Lock a cleaning session row; 404 if missing. */
export async function lockSession(tx: Tx, sessionId: string) {
  // Serializes complete/cancel claims on this session.
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "CleaningSession" WHERE id = ${sessionId} FOR UPDATE
  `;
  // Missing id — client stale or deleted outside this txn.
  if (rows.length === 0) {
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(404, "not_found", "Session not found");
  }
}

/** Lock a location row (cycle / cleaningStatus updates); 404 if missing. */
export async function lockLocation(tx: Tx, locationId: string) {
  // Serializes cleaningCycle / cleaningStatus mutations for this room.
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Location" WHERE id = ${locationId} FOR UPDATE
  `;
  // Missing id — client stale or deleted outside this txn.
  if (rows.length === 0) {
    // Abort with an HTTP-mapped AppError or rethrow.
    throw new AppError(404, "not_found", "Room not found");
  }
}
