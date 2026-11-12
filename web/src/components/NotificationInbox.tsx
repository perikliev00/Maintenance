/**
 * Header bell with unread badge. Count refreshes on mount and via live
 * `notification.changed` events (debounced); transient fetch errors are ignored
 * so the badge does not flicker on brief connectivity blips.
 */
import { useCallback, useEffect, useState } from "react";
// Import dependency used by this module.
import { fetchNotificationUnreadCount } from "../api/client";
// Import dependency used by this module.
import { useLiveRefresh } from "../hooks/useLiveRefresh";

// Local type alias shaping data.
type Props = {
  // Field/property in this shape.
  locale: "bg" | "en";
  // Field/property in this shape.
  active?: boolean;
  // Arrow function / callback body.
  onOpen: () => void;
};

/**
 * NotificationInbox React component / page.
 */
export function NotificationInbox({ locale, active, onOpen }: Props) {
  // Assign value for subsequent use.
  const [count, setCount] = useState(0);

  /** Lightweight unread badge fetch; swallows transient failures. */
  const refreshCount = useCallback(async () => {
    // Guard fallible work.
    try {
      // Local constant binding.
      const res = await fetchNotificationUnreadCount();
      // Invoke helper or pass arguments.
      setCount(res.count);
    // Open multi-line construct.
    } catch {
      /* ignore transient errors */
    }
  // Close multi-line construct with trailing syntax.
  }, []);

  // Initial count on mount / when callback identity changes.
  useEffect(() => {
    // Fire-and-forget async/side effect.
    void refreshCount();
  // Close multi-line construct with trailing syntax.
  }, [refreshCount]);

  // Live channel: only notification.changed (not a full app refresh).
  useLiveRefresh(refreshCount, {
    // Field/property in this shape.
    eventTypes: ["notification.changed"],
    // Field/property in this shape.
    debounceMs: 250,
  });

  // Local constant binding.
  const title = locale === "bg" ? "Известия" : "Notifications";

  // Return computed result to caller.
  return (
    // Render JSX element.
    <div className="notif-inbox">
      // Render JSX element.
      <button
        // Assign value for subsequent use.
        type="button"
        // Assign value for subsequent use.
        className={`ghost notif-bell${active ? " active" : ""}`}
        // Assign value for subsequent use.
        aria-label={title}
        // Assign value for subsequent use.
        title={title}
        // Assign value for subsequent use.
        onClick={onOpen}
      >
        // Render JSX element.
        <svg
          // Assign value for subsequent use.
          className="notif-bell-icon"
          // Assign value for subsequent use.
          viewBox="0 0 24 24"
          // Assign value for subsequent use.
          fill="none"
          // Assign value for subsequent use.
          stroke="currentColor"
          // Assign value for subsequent use.
          strokeWidth="1.8"
          // Assign value for subsequent use.
          strokeLinecap="round"
          // Assign value for subsequent use.
          strokeLinejoin="round"
          // Continue module logic.
          aria-hidden
        >
          // Render JSX element.
          <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5" />
          // Render JSX element.
          <path d="M9.5 17a2.5 2.5 0 0 0 5 0" />
        // JSX element boundary.
        </svg>
        // JSX block comment.
        {/* Cap display at 99+ so the badge stays compact. */}
        // JSX expression container.
        {count > 0 && (
          // Render JSX element.
          <span className="notif-badge">{count > 99 ? "99+" : count}</span>
        )}
      // JSX element boundary.
      </button>
    // JSX element boundary.
    </div>
  );
}
