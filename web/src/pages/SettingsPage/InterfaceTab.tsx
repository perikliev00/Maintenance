/** Theme / locale / density defaults for the UI. */
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
 * UI defaults editors: theme, locale, and density bound to the settings draft.
 */
export function InterfaceTab({ draft, setDraft, label }: Props) {
  // Early / value return.
  return (
    // Render a <div> element for layout or semantics.
    <div className="settings-form">
      <label>
        {label("Тема по подразбиране", "Default theme")}
        <select
          // Fall back to dark when unset so the select stays controlled.
          value={String((draft as { defaultTheme?: string }).defaultTheme ?? "dark")}
          // Pass onChange prop/value into the element or config.
          onChange={(e) =>
            // State transition.
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
          // Pass value prop/value into the element or config.
          value={String((draft as { locale?: string }).locale ?? "bg")}
          // Pass onChange prop/value into the element or config.
          onChange={(e) =>
            // State transition.
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
          // Pass value prop/value into the element or config.
          value={String((draft as { density?: string }).density ?? "comfortable")}
          // Pass onChange prop/value into the element or config.
          onChange={(e) =>
            // State transition.
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
