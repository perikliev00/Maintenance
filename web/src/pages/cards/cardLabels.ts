/**
 * Card-type catalog and validity helpers shared by the issue wizard UI/tests.
 */
import type { CardType } from "../../api/client";
// Import module dependency from ../../i18n.
import { t } from "../../i18n";

// Export CARD_TYPES for use by other modules.
export const CARD_TYPES: Array<{ id: CardType; bg: string; en: string }> = [
  // Support the surrounding logic for this step.
  { id: "guest", bg: "Гост", en: "Guest" },
  // Support the surrounding logic for this step.
  { id: "housekeeper", bg: "Камериерка", en: "Housekeeper" },
  // Support the surrounding logic for this step.
  { id: "maintenance", bg: "Поддръжка", en: "Maintenance" },
  // Support the surrounding logic for this step.
  { id: "manager", bg: "Мениджър", en: "Manager" },
  // Support the surrounding logic for this step.
  { id: "master", bg: "Мастър", en: "Master" },
];

/** Localized label for a card type id. */
export function labelForType(locale: "bg" | "en", type: CardType) {
  // Find the first matching item for this lookup.
  const row = CARD_TYPES.find((ct) => ct.id === type);
  // Return early result or rendered output from this path.
  return row ? t(locale, row.bg, row.en) : type;
}

/** Default validity window: now → +24h, formatted for datetime-local inputs. */
export function defaultValidity() {
  // Bind from for use in the following logic.
  const from = new Date();
  // Bind until for use in the following logic.
  const until = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  // Return early result or rendered output from this path.
  return {
    // slice(0, 16) matches `<input type="datetime-local">` value shape.
    validFrom: from.toISOString().slice(0, 16),
    // Provide validUntil field used by this structure.
    validUntil: until.toISOString().slice(0, 16),
  };
}

/** Parse a datetime-local string into an ISO timestamp for the API. */
export function toIsoLocal(value: string) {
  // Bind d for use in the following logic.
  const d = new Date(value);
  // Conditional branch for the case described by this guard.
  if (Number.isNaN(d.getTime())) throw new Error("invalid_date");
  // Return early result or rendered output from this path.
  return d.toISOString();
}
