/** Connection badge helpers for My Work (offline / unreachable / syncing / online). */
import type { ConnMode, QueueStats } from "../../offline";
import { t } from "./labels";

/** CSS modifier from conn mode plus in-flight outbox counts. */
export function connClass(conn: ConnMode, pending: number, sending: number): string {
  // pending/sending force "syncing" even if mode briefly says online.
  if (conn === "offline") return "offline";
  if (conn === "unreachable") return "unreachable";
  if (conn === "syncing" || pending + sending > 0) return "syncing";
  return "online";
}

/** Human banner text for the My Work connection badge. */
export function connLabel(
  locale: "bg" | "en",
  conn: ConnMode,
  pending: number,
  sending: number,
): string {
  const inflight = pending + sending;
  if (conn === "offline") return t(locale, "Офлайн", "Offline");
  if (conn === "unreachable") {
    return t(locale, "Няма връзка със сървъра", "Server unreachable");
  }
  if (conn === "syncing" || inflight > 0) {
    return t(locale, `Синхронизация (${inflight})`, `Syncing (${inflight})`);
  }
  return t(locale, "Онлайн", "Online");
}

/** Live connection status chip driven by offline store stats. */
export function ConnStatusBadge({
  locale,
  conn,
  queueStats,
}: {
  locale: "bg" | "en";
  conn: ConnMode;
  queueStats: QueueStats;
}) {
  return (
    <div
      className={`mywork-conn mywork-conn-${connClass(conn, queueStats.pending, queueStats.sending)}`}
      role="status"
    >
      {connLabel(locale, conn, queueStats.pending, queueStats.sending)}
    </div>
  );
}
