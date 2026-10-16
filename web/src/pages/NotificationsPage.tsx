/**
 * In-app notification inbox: mark read / dismiss / navigate to linked panels.
 * Live-refreshes on `notification.changed` (debounced).
 */
import { useCallback, useEffect, useState } from "react";
import {
  dismissNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
  type Panel,
} from "../api/client";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

type Props = {
  locale?: "bg" | "en";
  onNavigate: (panel: Panel) => void;
};

/**
 * Pick BG vs EN copy for this page.
 * @returns `en` string when locale is English; otherwise Bulgarian.
 */
function t(locale: "bg" | "en", bg: string, en: string) {
  // English locale wins; default UI copy is Bulgarian.
  return locale === "en" ? en : bg;
}

/**
 * Compact relative timestamp (now / minutes / hours / days).
 * @param iso - ISO createdAt from the notification payload.
 */
function relativeTime(iso: string, locale: "bg" | "en") {
  // Elapsed wall time since the notification was created.
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  // Under one minute: show "just now" / "сега".
  if (minutes < 1) return locale === "bg" ? "сега" : "just now";
  // Under one hour: minute granularity.
  if (minutes < 60) {
    return locale === "bg" ? `преди ${minutes} мин` : `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  // Under one day: hour granularity.
  if (hours < 24) {
    return locale === "bg" ? `преди ${hours} ч` : `${hours}h ago`;
  }
  // Older: day granularity.
  const days = Math.floor(hours / 24);
  return locale === "bg" ? `преди ${days} д` : `${days}d ago`;
}

/**
 * Full-page notification inbox: mark read, dismiss, navigate to linked panels.
 * Live-refreshes on `notification.changed` (debounced).
 */
export function NotificationsPage({ locale = "bg", onNavigate }: Props) {
  // Inbox rows for the signed-in user (max 50 per fetch).
  const [items, setItems] = useState<AppNotification[]>([]);
  // True until the first successful or failed load settles.
  const [loading, setLoading] = useState(true);
  // User-visible load error; cleared on the next refresh attempt.
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch up to 50 notifications for the current user and replace local state.
   */
  const refresh = useCallback(async () => {
    // Cap list size; older notifications are not paged on this screen.
    const res = await listNotifications({ limit: 50 });
    setItems(res.items);
  }, []);

  // Initial load (and when locale changes — error strings need refresh).
  useEffect(() => {
    (async () => {
      try {
        // Enter loading gate before the network call.
        setLoading(true);
        setError(null);
        await refresh();
      } catch (err) {
        // Surface API/network failure with localized fallback copy.
        setError(
          err instanceof Error
            ? err.message
            : t(locale, "Неуспешно зареждане", "Failed to load"),
        );
      } finally {
        // Always clear the loading gate so live refresh can enable.
        setLoading(false);
      }
    })();
  }, [refresh, locale]);

  // Soft live refresh while not in the initial loading state.
  useLiveRefresh(
    async () => {
      try {
        // Pull latest inbox without flipping the full-page loading banner.
        await refresh();
      } catch {
        /* ignore transient live-refresh failures */
      }
    },
    {
      // Avoid racing the first paint load.
      enabled: !loading,
      eventTypes: ["notification.changed"],
      debounceMs: 250,
    },
  );

  // Unread badge / mark-all visibility.
  const unreadCount = items.filter((n) => n.unread).length;

  /**
   * Mark unread as read (best-effort), then navigate if a panel is linked.
   */
  async function onOpenItem(n: AppNotification) {
    // Only hit the API when the row is still unread.
    if (n.unread) {
      try {
        await markNotificationRead(n.id);
        // Optimistic local update so the unread style clears immediately.
        setItems((prev) =>
          prev.map((x) =>
            x.id === n.id
              ? { ...x, readAt: new Date().toISOString(), unread: false }
              : x,
          ),
        );
      } catch {
        /* still navigate even if mark-read failed */
      }
    }
    // Deep-link payload may name a shell panel to open.
    const panel = n.payload?.panel;
    if (panel) {
      onNavigate(panel);
    }
  }

  /**
   * Soft-delete (dismiss) a notification from the list.
   */
  async function onDismiss(id: string) {
    try {
      await dismissNotification(id);
      // Drop the row locally after a successful dismiss.
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch {
      /* ignore dismiss failures */
    }
  }

  /**
   * Mark every item read on the server and locally.
   */
  async function onMarkAll() {
    try {
      await markAllNotificationsRead();
      // Preserve existing readAt; stamp missing ones with "now".
      setItems((prev) =>
        prev.map((x) => ({
          ...x,
          unread: false,
          readAt: x.readAt ?? new Date().toISOString(),
        })),
      );
    } catch {
      /* ignore mark-all failures */
    }
  }

  return (
    <div className="page notifications-page">
      <header className="page-header">
        <div>
          <h1>{t(locale, "Известия", "Notifications")}</h1>
          <p className="muted">
            {t(
              locale,
              "Важни събития и напомняния за вас",
              "Important events and reminders for you",
            )}
          </p>
        </div>
        {/* Mark-all only when there is at least one unread. */}
        {unreadCount > 0 && (
          <button
            type="button"
            className="ghost"
            onClick={() => void onMarkAll()}
          >
            {t(locale, "Прочети всички", "Mark all read")}
          </button>
        )}
      </header>

      {/* Load-error banner above the list. */}
      {error && <div className="banner error">{error}</div>}

      {/* Loading gate vs populated inbox panel. */}
      {loading ? (
        <p className="muted">{t(locale, "Зареждане…", "Loading…")}</p>
      ) : (
        <section className="panel">
          <div className="panel-header">
            <h2>
              {t(locale, "Всички", "All")} ({items.length})
              {/* Unread count suffix only when non-zero. */}
              {unreadCount > 0 && (
                <span className="muted" style={{ fontWeight: 400 }}>
                  {" "}
                  · {unreadCount} {t(locale, "непрочетени", "unread")}
                </span>
              )}
            </h2>
          </div>

          {/* Empty inbox vs scrollable list. */}
          {items.length === 0 ? (
            <p className="muted" style={{ padding: "1rem" }}>
              {t(locale, "Няма известия", "No notifications")}
            </p>
          ) : (
            <ul className="notif-page-list">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={`notif-page-item${n.unread ? " unread" : ""}`}
                >
                  {/* Open: mark read + optional panel navigation. */}
                  <button
                    type="button"
                    className="notif-page-item-main"
                    onClick={() => void onOpenItem(n)}
                  >
                    <strong>{n.title}</strong>
                    <span>{n.body}</span>
                    <time dateTime={n.createdAt}>
                      {relativeTime(n.createdAt, locale)}
                      {/* Absolute locale string alongside relative time. */}
                      {n.createdAt
                        ? ` · ${new Date(n.createdAt).toLocaleString()}`
                        : ""}
                    </time>
                  </button>
                  {/* Dismiss removes the row without navigating. */}
                  <button
                    type="button"
                    className="ghost notif-dismiss"
                    onClick={() => void onDismiss(n.id)}
                  >
                    {t(locale, "Скрий", "Dismiss")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
