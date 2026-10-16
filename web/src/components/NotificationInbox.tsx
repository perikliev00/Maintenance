/**
 * Header bell with unread badge. Count refreshes on mount and via live
 * `notification.changed` events (debounced); transient fetch errors are ignored
 * so the badge does not flicker on brief connectivity blips.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchNotificationUnreadCount } from "../api/client";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

type Props = {
  locale: "bg" | "en";
  active?: boolean;
  onOpen: () => void;
};

/**
 * NotificationInbox React component / page.
 */
export function NotificationInbox({ locale, active, onOpen }: Props) {
  const [count, setCount] = useState(0);

  /** Lightweight unread badge fetch; swallows transient failures. */
  const refreshCount = useCallback(async () => {
    try {
      const res = await fetchNotificationUnreadCount();
      setCount(res.count);
    } catch {
      /* ignore transient errors */
    }
  }, []);

  // Initial count on mount / when callback identity changes.
  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  // Live channel: only notification.changed (not a full app refresh).
  useLiveRefresh(refreshCount, {
    eventTypes: ["notification.changed"],
    debounceMs: 250,
  });

  const title = locale === "bg" ? "Известия" : "Notifications";

  return (
    <div className="notif-inbox">
      <button
        type="button"
        className={`ghost notif-bell${active ? " active" : ""}`}
        aria-label={title}
        title={title}
        onClick={onOpen}
      >
        <svg
          className="notif-bell-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5" />
          <path d="M9.5 17a2.5 2.5 0 0 0 5 0" />
        </svg>
        {/* Cap display at 99+ so the badge stays compact. */}
        {count > 0 && (
          <span className="notif-badge">{count > 99 ? "99+" : count}</span>
        )}
      </button>
    </div>
  );
}
