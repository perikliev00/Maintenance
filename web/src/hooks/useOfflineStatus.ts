/**
 * Subscribe to offline connection mode + outbox queue stats.
 */
import { useEffect, useState } from "react";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  getQueueStats,
  // List item in import/export/params.
  subscribeOffline,
  // Local type alias shaping data.
  type ConnMode,
  // Local type alias shaping data.
  type QueueStats,
// Close multi-line construct with trailing syntax.
} from "../offline/session";

// Local constant binding.
const EMPTY_STATS: QueueStats = {
  // Field/property in this shape.
  pending: 0,
  // Field/property in this shape.
  sending: 0,
  // Field/property in this shape.
  conflict: 0,
  // Field/property in this shape.
  failed: 0,
};

// Local type alias shaping data.
type Options = {
  /** Fired when conn becomes online with an empty outbox (e.g. soft refresh). */
  onOnlineEmptyOutbox?: () => void;
};

// Exported function entry point.
export function useOfflineStatus(opts: Options = {}) {
  // Assign value for subsequent use.
  const [conn, setConn] = useState<ConnMode>("online");
  // Assign value for subsequent use.
  const [queueStats, setQueueStats] = useState<QueueStats>(EMPTY_STATS);
  // Local constant binding.
  const onOnline = opts.onOnlineEmptyOutbox;

  // Arrow function / callback body.
  useEffect(() => {
    // Return computed result to caller.
    return subscribeOffline((next) => {
      // Invoke helper or pass arguments.
      setConn(next.conn);
      // Invoke helper or pass arguments.
      setQueueStats(next.stats);
      // Conditional branch for this case.
      if (
        // Assign value for subsequent use.
        next.conn === "online" &&
        // Assign value for subsequent use.
        next.stats.pending === 0 &&
        // Assign value for subsequent use.
        next.stats.sending === 0
      // Open multi-line construct.
      ) {
        // Invoke helper or pass arguments.
        onOnline?.();
      }
    });
  // Close multi-line construct with trailing syntax.
  }, [onOnline]);

  // Arrow function / callback body.
  useEffect(() => {
    // Fire-and-forget async/side effect.
    void getQueueStats().then(setQueueStats);
  // Close multi-line construct with trailing syntax.
  }, []);

  // Return computed result to caller.
  return { conn, queueStats, setQueueStats, refreshQueueStats: () => getQueueStats().then(setQueueStats) };
}
