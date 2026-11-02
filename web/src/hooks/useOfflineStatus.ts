/**
 * Subscribe to offline connection mode + outbox queue stats.
 */
import { useEffect, useState } from "react";
import {
  getQueueStats,
  subscribeOffline,
  type ConnMode,
  type QueueStats,
} from "../offline/session";

const EMPTY_STATS: QueueStats = {
  pending: 0,
  sending: 0,
  conflict: 0,
  failed: 0,
};

type Options = {
  /** Fired when conn becomes online with an empty outbox (e.g. soft refresh). */
  onOnlineEmptyOutbox?: () => void;
};

export function useOfflineStatus(opts: Options = {}) {
  const [conn, setConn] = useState<ConnMode>("online");
  const [queueStats, setQueueStats] = useState<QueueStats>(EMPTY_STATS);
  const onOnline = opts.onOnlineEmptyOutbox;

  useEffect(() => {
    return subscribeOffline((next) => {
      setConn(next.conn);
      setQueueStats(next.stats);
      if (
        next.conn === "online" &&
        next.stats.pending === 0 &&
        next.stats.sending === 0
      ) {
        onOnline?.();
      }
    });
  }, [onOnline]);

  useEffect(() => {
    void getQueueStats().then(setQueueStats);
  }, []);

  return { conn, queueStats, setQueueStats, refreshQueueStats: () => getQueueStats().then(setQueueStats) };
}
