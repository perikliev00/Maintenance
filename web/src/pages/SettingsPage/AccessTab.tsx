/** Invitation TTL and idle/lock settings draft editors. */
import type { Dispatch, SetStateAction } from "react";
import type { LabelFn } from "./constants";

type Props = {
  draft: Record<string, unknown>;
  setDraft: Dispatch<SetStateAction<Record<string, unknown>>>;
  label: LabelFn;
};

/**
 * Access settings editors: invitation TTL, idle-days info, lock-inactive flag.
 * Bound to the parent settings draft via `setDraft`.
 */
export function AccessTab({ draft, setDraft, label }: Props) {
  // Early / value return.
  return (
    <div className="settings-form">
      <p className="muted">
        {label(
          "TTL се ползва при издаване на покани. lockInactiveUsers се изпълнява от фонов job (~5 мин).",
          "TTL is used when issuing invitations. lockInactiveUsers runs via background job (~5 min).",
        )}
      </p>
      <label>
        {label("Валидност на код (часове)", "Invitation TTL (hours)")}
        <input
          type="number"
          min={1}
          max={168}
          // Default 2h when the draft key is missing.
          value={Number(
            (draft as { invitationTtlHours?: number }).invitationTtlHours ??
              2,
          )}
          onChange={(e) =>
            setDraft((p) => ({
              ...p,
              invitationTtlHours: Number(e.target.value),
            }))
          }
        />
      </label>
      <label>
        {label("Idle дни (инфо)", "Idle days (info)")}
        <input
          type="number"
          min={1}
          max={365}
          // Informational idle window — default 30 days.
          value={Number(
            (draft as { sessionIdleDays?: number }).sessionIdleDays ?? 30,
          )}
          onChange={(e) =>
            setDraft((p) => ({
              ...p,
              sessionIdleDays: Number(e.target.value),
            }))
          }
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={Boolean(
            (draft as { lockInactiveUsers?: boolean }).lockInactiveUsers,
          )}
          onChange={(e) =>
            setDraft((p) => ({
              ...p,
              lockInactiveUsers: e.target.checked,
            }))
          }
        />
        {label(
          "Блокирай неактивни (без авто-job)",
          "Lock inactive users (no auto-job)",
        )}
      </label>
    </div>
  );
}
