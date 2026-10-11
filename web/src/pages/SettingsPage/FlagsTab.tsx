import { FLAG_LABELS } from "./constants";

type Props = {
  draft: Record<string, unknown>;
  setBool: (path: string, value: boolean) => void;
};

export function FlagsTab({ draft, setBool }: Props) {
  return (
    <div className="settings-form">
      {Object.keys(FLAG_LABELS).map((key) => (
        <label key={key} className="checkbox">
          <input
            type="checkbox"
            checked={Boolean((draft as Record<string, boolean>)[key])}
            onChange={(e) => setBool(key, e.target.checked)}
          />
          {FLAG_LABELS[key]}
        </label>
      ))}
    </div>
  );
}
