import { useCallback, useEffect, useState } from "react";
import { fetchNotificationUnreadCount } from "../api/client";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

type Props = {
  locale: "bg" | "en";
  active?: boolean;
  onOpen: () => void;
};

export function NotificationInbox({ locale, active, onOpen }: Props) {
  const [count, setCount] = useState(0);

  const refreshCount = useCallback(async () => {
    try {
      const res = await fetchNotificationUnreadCount();
      setCount(res.count);
    } catch {
      /* ignore transient errors */
    }
  }, []);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

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
        {count > 0 && (
          <span className="notif-badge">{count > 99 ? "99+" : count}</span>
        )}
      </button>
    </div>
  );
}
