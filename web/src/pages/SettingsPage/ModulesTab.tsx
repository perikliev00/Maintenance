/** Module enable toggles — disabled modules are hidden from nav where applicable. */
import { MODULE_LABELS, type LabelFn } from "./constants";

type Props = {
  draft: Record<string, unknown>;
  setBool: (path: string, value: boolean) => void;
  label: LabelFn;
};

/**
 * Module-enable toggles bound to the settings draft.
 * Disabled modules are hidden from nav where a panel exists.
 */
export function ModulesTab({ draft, setBool, label }: Props) {
  return (
    <div className="settings-form">
      <p className="muted">
        {label(
          "Изключените модули се скриват от навигацията (където има панел).",
          "Disabled modules are hidden from navigation where a panel exists.",
        )}
      </p>
      {Object.keys(MODULE_LABELS).map((key) => (
        <label key={key} className="checkbox">
          <input
            type="checkbox"
            // Coerce missing draft keys to false for stable checkbox binding.
            checked={Boolean((draft as Record<string, boolean>)[key])}
            onChange={(e) => setBool(key, e.target.checked)}
          />
          {MODULE_LABELS[key]}
        </label>
      ))}
    </div>
  );
}
