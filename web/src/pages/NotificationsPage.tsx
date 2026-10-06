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

function t(locale: "bg" | "en", bg: string, en: string) {
  return locale === "en" ? en : bg;
}

function relativeTime(iso: string, locale: "bg" | "en") {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (minutes < 1) return locale === "bg" ? "сега" : "just now";
  if (minutes < 60) {
    return locale === "bg" ? `преди ${minutes} мин` : `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return locale === "bg" ? `преди ${hours} ч` : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return locale === "bg" ? `преди ${days} д` : `${days}d ago`;
}

export function NotificationsPage({ locale = "bg", onNavigate }: Props) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await listNotifications({ limit: 50 });
    setItems(res.items);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await refresh();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : t(locale, "Неуспешно зареждане", "Failed to load"),
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh, locale]);

  useLiveRefresh(
    async () => {
      try {
        await refresh();
      } catch {
        /* ignore */
      }
    },
    {
      enabled: !loading,
      eventTypes: ["notification.changed"],
      debounceMs: 250,
    },
  );

  const unreadCount = items.filter((n) => n.unread).length;

  async function onOpenItem(n: AppNotification) {
    if (n.unread) {
      try {
        await markNotificationRead(n.id);
        setItems((prev) =>
          prev.map((x) =>
            x.id === n.id
              ? { ...x, readAt: new Date().toISOString(), unread: false }
              : x,
          ),
        );
      } catch {
        /* still navigate */
      }
    }
    const panel = n.payload?.panel;
    if (panel) {
      onNavigate(panel);
    }
  }

  async function onDismiss(id: string) {
    try {
      await dismissNotification(id);
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch {
      /* ignore */
    }
  }

  async function onMarkAll() {
    try {
      await markAllNotificationsRead();
      setItems((prev) =>
        prev.map((x) => ({
          ...x,
          unread: false,
          readAt: x.readAt ?? new Date().toISOString(),
        })),
      );
    } catch {
      /* ignore */
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

      {error && <div className="banner error">{error}</div>}

      {loading ? (
        <p className="muted">{t(locale, "Зареждане…", "Loading…")}</p>
      ) : (
        <section className="panel">
          <div className="panel-header">
            <h2>
              {t(locale, "Всички", "All")} ({items.length})
              {unreadCount > 0 && (
                <span className="muted" style={{ fontWeight: 400 }}>
                  {" "}
                  · {unreadCount} {t(locale, "непрочетени", "unread")}
                </span>
              )}
            </h2>
          </div>

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
                  <button
                    type="button"
                    className="notif-page-item-main"
                    onClick={() => void onOpenItem(n)}
                  >
                    <strong>{n.title}</strong>
                    <span>{n.body}</span>
                    <time dateTime={n.createdAt}>
                      {relativeTime(n.createdAt, locale)}
                      {n.createdAt
                        ? ` · ${new Date(n.createdAt).toLocaleString()}`
                        : ""}
                    </time>
                  </button>
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
