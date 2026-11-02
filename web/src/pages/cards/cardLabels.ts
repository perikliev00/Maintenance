/**
 * Card-type catalog and validity helpers shared by the issue wizard UI/tests.
 */
import type { CardType } from "../../api/client";
import { t } from "../../i18n";

export const CARD_TYPES: Array<{ id: CardType; bg: string; en: string }> = [
  { id: "guest", bg: "Гост", en: "Guest" },
  { id: "housekeeper", bg: "Камериерка", en: "Housekeeper" },
  { id: "maintenance", bg: "Поддръжка", en: "Maintenance" },
  { id: "manager", bg: "Мениджър", en: "Manager" },
  { id: "master", bg: "Мастър", en: "Master" },
];

/** Localized label for a card type id. */
export function labelForType(locale: "bg" | "en", type: CardType) {
  const row = CARD_TYPES.find((ct) => ct.id === type);
  return row ? t(locale, row.bg, row.en) : type;
}

/** Default validity window: now → +24h, formatted for datetime-local inputs. */
export function defaultValidity() {
  const from = new Date();
  const until = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return {
    // slice(0, 16) matches `<input type="datetime-local">` value shape.
    validFrom: from.toISOString().slice(0, 16),
    validUntil: until.toISOString().slice(0, 16),
  };
}

/** Parse a datetime-local string into an ISO timestamp for the API. */
export function toIsoLocal(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error("invalid_date");
  return d.toISOString();
}
