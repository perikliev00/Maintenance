import type { ConnMode } from "../../offline";
import { t } from "./helpers";

export function connClass(conn: ConnMode, pending: number, sending: number): string {
  if (conn === "offline") return "offline";
  if (conn === "unreachable") return "unreachable";
  if (conn === "syncing" || pending + sending > 0) return "syncing";
  return "online";
}

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

type OfflineConnBadgeProps = {
  locale: "bg" | "en";
  conn: ConnMode;
  pending: number;
  sending: number;
};

export function OfflineConnBadge({
  locale,
  conn,
  pending,
  sending,
}: OfflineConnBadgeProps) {
  return (
    <div
      className={`mywork-conn mywork-conn-${connClass(conn, pending, sending)}`}
      role="status"
    >
      {connLabel(locale, conn, pending, sending)}
    </div>
  );
}
