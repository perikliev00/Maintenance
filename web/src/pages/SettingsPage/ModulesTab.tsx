import { MODULE_LABELS, type LabelFn } from "./constants";

type Props = {
  draft: Record<string, unknown>;
  setBool: (path: string, value: boolean) => void;
  label: LabelFn;
};

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
            checked={Boolean((draft as Record<string, boolean>)[key])}
            onChange={(e) => setBool(key, e.target.checked)}
          />
          {MODULE_LABELS[key]}
        </label>
      ))}
    </div>
  );
}
