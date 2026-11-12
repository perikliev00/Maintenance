import type { QueuedAction } from "./storage";

/**
 * Reset rows left in `sending` after a crashed/interrupted drain.
 * Pure map — caller persists only rows that actually changed.
 */
export function recoverOrphanedSending(rows: QueuedAction[]): QueuedAction[] {
  const now = Date.now();
  return rows.map((row) => {
    // Stranded mid-send → pending so the next drain can reclaim them.
    if (row.status === "sending") {
      return { ...row, status: "pending" as const, updatedAt: now };
    }
    return row;
  });
}
