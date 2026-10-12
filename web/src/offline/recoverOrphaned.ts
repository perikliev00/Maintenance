import type { QueuedAction } from "./storage";

/** Reset rows left in `sending` after a crashed/interrupted drain. */
export function recoverOrphanedSending(rows: QueuedAction[]): QueuedAction[] {
  const now = Date.now();
  return rows.map((row) => {
    if (row.status === "sending") {
      return { ...row, status: "pending" as const, updatedAt: now };
    }
    return row;
  });
}
