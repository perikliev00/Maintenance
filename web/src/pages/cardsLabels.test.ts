import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { t } from "../i18n";

/** Mirrors CardsPage CARD_TYPES labels without importing React page. */
const CARD_TYPES = [
  { id: "guest", bg: "Гост", en: "Guest" },
  { id: "housekeeper", bg: "Камериерка", en: "Housekeeper" },
  { id: "maintenance", bg: "Поддръжка", en: "Maintenance" },
  { id: "manager", bg: "Мениджър", en: "Manager" },
  { id: "master", bg: "Мастър", en: "Master" },
] as const;

describe("CardsPage i18n labels", () => {
  it("switches card type labels by locale", () => {
    for (const row of CARD_TYPES) {
      assert.equal(t("bg", row.bg, row.en), row.bg);
      assert.equal(t("en", row.bg, row.en), row.en);
    }
  });

  it("keeps BG when locale is not en", () => {
    assert.equal(t("bg", "Карти", "Cards"), "Карти");
  });
});
