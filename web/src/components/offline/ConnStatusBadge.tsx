/** Shared offline / sync connection badge for My Work and Repairs. */
import type { ConnMode, QueueStats } from "../../offline/session";
// Import dependency used by this module.
import { t } from "../../i18n";

/** CSS modifier from conn mode plus in-flight outbox counts. */
export function connClass(
  // Field/property in this shape.
  conn: ConnMode,
  // Field/property in this shape.
  pending: number,
  // Field/property in this shape.
  sending: number,
// Open multi-line construct.
): string {
  // Conditional branch for this case.
  if (conn === "offline") return "offline";
  // Conditional branch for this case.
  if (conn === "unreachable") return "unreachable";
  // Conditional branch for this case.
  if (conn === "syncing" || pending + sending > 0) return "syncing";
  // Return computed result to caller.
  return "online";
}

/** Localized connection badge text, including inflight outbox count when syncing. */
export function connLabel(
  // Field/property in this shape.
  locale: "bg" | "en",
  // Field/property in this shape.
  conn: ConnMode,
  // Field/property in this shape.
  pending: number,
  // Field/property in this shape.
  sending: number,
// Open multi-line construct.
): string {
  // Local constant binding.
  const inflight = pending + sending;
  // Conditional branch for this case.
  if (conn === "offline") return t(locale, "Офлайн", "Offline");
  // Conditional branch for this case.
  if (conn === "unreachable") {
    // Return computed result to caller.
    return t(locale, "Няма връзка със сървъра", "Server unreachable");
  }
  // Conditional branch for this case.
  if (conn === "syncing" || inflight > 0) {
    // Return computed result to caller.
    return t(locale, `Синхронизация (${inflight})`, `Syncing (${inflight})`);
  }
  // Return computed result to caller.
  return t(locale, "Онлайн", "Online");
}

// Local type alias shaping data.
type ConnStatusBadgeProps = {
  // Field/property in this shape.
  locale: "bg" | "en";
  // Field/property in this shape.
  conn: ConnMode;
  // Field/property in this shape.
  pending?: number;
  // Field/property in this shape.
  sending?: number;
  // Field/property in this shape.
  queueStats?: QueueStats;
};

/** Status pill showing offline/unreachable/syncing/online. */
export function ConnStatusBadge({
  // List item in import/export/params.
  locale,
  // List item in import/export/params.
  conn,
  // List item in import/export/params.
  pending,
  // List item in import/export/params.
  sending,
  // List item in import/export/params.
  queueStats,
// Open multi-line construct.
}: ConnStatusBadgeProps) {
  // Local constant binding.
  const p = pending ?? queueStats?.pending ?? 0;
  // Local constant binding.
  const s = sending ?? queueStats?.sending ?? 0;
  // Return computed result to caller.
  return (
    // Render JSX element.
    <div
      // Assign value for subsequent use.
      className={`mywork-conn mywork-conn-${connClass(conn, p, s)}`}
      // Assign value for subsequent use.
      role="status"
    >
      // JSX expression container.
      {connLabel(locale, conn, p, s)}
    // JSX element boundary.
    </div>
  );
}
