// Import dependency used by this module.
import type { QueuedAction } from "./storage";

/**
 * Reset rows left in `sending` after a crashed/interrupted drain.
 * Pure map — caller persists only rows that actually changed.
 */
export function recoverOrphanedSending(rows: QueuedAction[]): QueuedAction[] {
  // Local constant binding.
  const now = Date.now();
  // Return computed result to caller.
  return rows.map((row) => {
    // Stranded mid-send → pending so the next drain can reclaim them.
    if (row.status === "sending") {
      // Return computed result to caller.
      return { ...row, status: "pending" as const, updatedAt: now };
    }
    // Return computed result to caller.
    return row;
  });
}
