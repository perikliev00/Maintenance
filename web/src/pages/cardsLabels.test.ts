import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { t } from "../i18n";
import { CARD_TYPES } from "./cards/cardLabels";

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
