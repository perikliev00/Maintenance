import type { Dispatch, SetStateAction } from "react";
import type { LabelFn } from "./constants";

type Props = {
  draft: Record<string, unknown>;
  setDraft: Dispatch<SetStateAction<Record<string, unknown>>>;
  label: LabelFn;
};

export function InterfaceTab({ draft, setDraft, label }: Props) {
  return (
    <div className="settings-form">
      <label>
        {label("Тема по подразбиране", "Default theme")}
        <select
          value={String((draft as { defaultTheme?: string }).defaultTheme ?? "dark")}
          onChange={(e) =>
            setDraft((p) => ({ ...p, defaultTheme: e.target.value }))
          }
        >
          <option value="dark">dark</option>
          <option value="light">light</option>
        </select>
      </label>
      <label>
        {label("Език", "Locale")}
        <select
          value={String((draft as { locale?: string }).locale ?? "bg")}
          onChange={(e) =>
            setDraft((p) => ({ ...p, locale: e.target.value }))
          }
        >
          <option value="bg">Български</option>
          <option value="en">English</option>
        </select>
      </label>
      <label>
        {label("Плътност", "Density")}
        <select
          value={String((draft as { density?: string }).density ?? "comfortable")}
          onChange={(e) =>
            setDraft((p) => ({ ...p, density: e.target.value }))
          }
        >
          <option value="comfortable">comfortable</option>
          <option value="compact">compact</option>
        </select>
      </label>
    </div>
  );
}
