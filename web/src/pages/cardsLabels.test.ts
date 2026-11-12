// Import module dependency from node:assert/strict.
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency from ../i18n.
import { t } from "../i18n";
// Import module dependency from ./cards/cardLabels.
import { CARD_TYPES } from "./cards/cardLabels";

// Group related tests under a shared suite name.
describe("CardsPage i18n labels", () => {
  // Define a single test case and its expectation.
  it("switches card type labels by locale", () => {
    // Iterate a collection or counted range.
    for (const row of CARD_TYPES) {
      // Invoke assert.equal to perform this step.
      assert.equal(t("bg", row.bg, row.en), row.bg);
      // Invoke assert.equal to perform this step.
      assert.equal(t("en", row.bg, row.en), row.en);
    }
  });

  // Define a single test case and its expectation.
  it("keeps BG when locale is not en", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(t("bg", "Карти", "Cards"), "Карти");
  });
});
