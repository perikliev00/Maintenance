/** Invitation TTL and idle/lock settings draft editors. */
import type { Dispatch, SetStateAction } from "react";
// Import type-only dependency for typing without runtime cost.
import type { LabelFn } from "./constants";

// Declare type alias Props.
type Props = {
  // Provide draft field used by this structure.
  draft: Record<string, unknown>;
  // Provide setDraft field used by this structure.
  setDraft: Dispatch<SetStateAction<Record<string, unknown>>>;
  // Provide label field used by this structure.
  label: LabelFn;
};

/**
 * Access settings editors: invitation TTL, idle-days info, lock-inactive flag.
 * Bound to the parent settings draft via `setDraft`.
 */
export function AccessTab({ draft, setDraft, label }: Props) {
  // Early / value return.
  return (
    // Render a <div> element for layout or semantics.
    <div className="settings-form">
      <p className="muted">
        {label(
          // Support the surrounding logic for this step.
          "TTL се ползва при издаване на покани. lockInactiveUsers се изпълнява от фонов job (~5 мин).",
          // Support the surrounding logic for this step.
          "TTL is used when issuing invitations. lockInactiveUsers runs via background job (~5 min).",
        )}
      </p>
      <label>
        {label("Валидност на код (часове)", "Invitation TTL (hours)")}
        <input
          // Declare a type alias.
          type="number"
          // Pass min prop/value into the element or config.
          min={1}
          // Pass max prop/value into the element or config.
          max={168}
          // Default 2h when the draft key is missing.
          value={Number(
            // Support the surrounding logic for this step.
            (draft as { invitationTtlHours?: number }).invitationTtlHours ??
              2,
          )}
          // Pass onChange prop/value into the element or config.
          onChange={(e) =>
            // State transition.
            setDraft((p) => ({
              // Spread prior fields/items so overrides can layer cleanly.
              ...p,
              // Provide invitationTtlHours field used by this structure.
              invitationTtlHours: Number(e.target.value),
            // Support the surrounding logic for this step.
            }))
          }
        />
      </label>
      <label>
        {label("Idle дни (инфо)", "Idle days (info)")}
        <input
          // Declare a type alias.
          type="number"
          // Pass min prop/value into the element or config.
          min={1}
          // Pass max prop/value into the element or config.
          max={365}
          // Informational idle window — default 30 days.
          value={Number(
            // Support the surrounding logic for this step.
            (draft as { sessionIdleDays?: number }).sessionIdleDays ?? 30,
          )}
          // Pass onChange prop/value into the element or config.
          onChange={(e) =>
            // State transition.
            setDraft((p) => ({
              // Spread prior fields/items so overrides can layer cleanly.
              ...p,
              // Provide sessionIdleDays field used by this structure.
              sessionIdleDays: Number(e.target.value),
            // Support the surrounding logic for this step.
            }))
          }
        />
      </label>
      <label className="checkbox">
        <input
          // Declare a type alias.
          type="checkbox"
          // Pass checked prop/value into the element or config.
          checked={Boolean(
            // Support the surrounding logic for this step.
            (draft as { lockInactiveUsers?: boolean }).lockInactiveUsers,
          )}
          // Pass onChange prop/value into the element or config.
          onChange={(e) =>
            // State transition.
            setDraft((p) => ({
              // Spread prior fields/items so overrides can layer cleanly.
              ...p,
              // Provide lockInactiveUsers field used by this structure.
              lockInactiveUsers: e.target.checked,
            // Support the surrounding logic for this step.
            }))
          }
        />
        {label(
          // Support the surrounding logic for this step.
          "Блокирай неактивни (без авто-job)",
          // Support the surrounding logic for this step.
          "Lock inactive users (no auto-job)",
        )}
      </label>
    </div>
  );
}
