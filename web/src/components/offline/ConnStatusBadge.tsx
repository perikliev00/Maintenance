/** Shared offline / sync connection badge for My Work and Repairs. */
import type { ConnMode, QueueStats } from "../../offline/session";
import { t } from "../../i18n";

/** CSS modifier from conn mode plus in-flight outbox counts. */
export function connClass(
  conn: ConnMode,
  pending: number,
  sending: number,
): string {
  if (conn === "offline") return "offline";
  if (conn === "unreachable") return "unreachable";
  if (conn === "syncing" || pending + sending > 0) return "syncing";
  return "online";
}

/** Localized connection badge text, including inflight outbox count when syncing. */
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

type ConnStatusBadgeProps = {
  locale: "bg" | "en";
  conn: ConnMode;
  pending?: number;
  sending?: number;
  queueStats?: QueueStats;
};

/** Status pill showing offline/unreachable/syncing/online. */
export function ConnStatusBadge({
  locale,
  conn,
  pending,
  sending,
  queueStats,
}: ConnStatusBadgeProps) {
  const p = pending ?? queueStats?.pending ?? 0;
  const s = sending ?? queueStats?.sending ?? 0;
  return (
    <div
      className={`mywork-conn mywork-conn-${connClass(conn, p, s)}`}
      role="status"
    >
      {connLabel(locale, conn, p, s)}
    </div>
  );
}
