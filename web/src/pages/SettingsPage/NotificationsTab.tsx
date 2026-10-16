/**
 * Notification channel toggles. `device_push` is always disabled in UI —
 * no push adapter is configured yet.
 */
import type { LabelFn } from "./constants";

type Props = {
  draft: Record<string, unknown>;
  setNestedChannel: (
    channel: string,
    field: "enabled" | "status",
    value: boolean | string,
  ) => void;
  label: LabelFn;
};

/**
 * Notification channel toggles for in_app / device_push / email.
 * `device_push` stays disabled — no push adapter is configured yet.
 */
export function NotificationsTab({ draft, setNestedChannel, label }: Props) {
  return (
    <div className="settings-form">
      {(["in_app", "device_push", "email"] as const).map((ch) => {
        const channel = (draft[ch] ?? {}) as {
          enabled?: boolean;
          status?: string;
        };
        // Push has no adapter — keep checkbox disabled and visually off.
        const isPush = ch === "device_push";
        return (
          <div key={ch} className="settings-channel">
            <strong>{ch}</strong>
            <span className="muted">status: {channel.status}</span>
            <label className="checkbox">
              <input
                type="checkbox"
                disabled={isPush}
                checked={Boolean(channel.enabled) && !isPush}
                onChange={(e) =>
                  setNestedChannel(ch, "enabled", e.target.checked)
                }
              />
              {label("Активен", "Enabled")}
              {isPush
                ? ` (${label("not_configured — няма адаптер", "not_configured — no adapter")})`
                : ""}
            </label>
          </div>
        );
      })}
    </div>
  );
}
