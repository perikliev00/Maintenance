/** Boolean feature-flag checkboxes bound to the settings draft. */
import { FLAG_LABELS } from "./constants";

type Props = {
  draft: Record<string, unknown>;
  setBool: (path: string, value: boolean) => void;
};

/**
 * Feature-flag checkboxes bound to the settings draft via `setBool`.
 * Keys and labels come from FLAG_LABELS in constants.
 */
export function FlagsTab({ draft, setBool }: Props) {
  return (
    <div className="settings-form">
      {Object.keys(FLAG_LABELS).map((key) => (
        <label key={key} className="checkbox">
          <input
            type="checkbox"
            // Coerce missing draft keys to false so uncontrolled→controlled stays stable.
            checked={Boolean((draft as Record<string, boolean>)[key])}
            onChange={(e) => setBool(key, e.target.checked)}
          />
          {FLAG_LABELS[key]}
        </label>
      ))}
    </div>
  );
}
