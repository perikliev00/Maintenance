// Import module dependency from node:assert/strict.
import assert from "node:assert/strict";
// Import module dependency from node:test.
import { describe, it } from "node:test";
// Import module dependency from ./cardLabels.
import { CARD_TYPES, labelForType, toIsoLocal } from "./cardLabels";

// Group related tests under a shared suite name.
describe("cardLabels", () => {
  // Define a single test case and its expectation.
  it("exposes the five card types used by the issue wizard", () => {
    // Invoke assert.deepEqual to perform this step.
    assert.deepEqual(
      // Invoke CARD_TYPES.map to perform this step.
      CARD_TYPES.map((row) => row.id),
      // Support the surrounding logic for this step.
      ["guest", "housekeeper", "maintenance", "manager", "master"],
    );
  });

  // Define a single test case and its expectation.
  it("localizes known card types and falls back to the raw id", () => {
    // Invoke assert.equal to perform this step.
    assert.equal(labelForType("bg", "guest"), "Гост");
    // Invoke assert.equal to perform this step.
    assert.equal(labelForType("en", "guest"), "Guest");
    // Invoke assert.equal to perform this step.
    assert.equal(labelForType("en", "unknown" as "guest"), "unknown");
  });

  // Define a single test case and its expectation.
  it("parses datetime-local values to ISO and rejects invalid input", () => {
    // Bind iso for use in the following logic.
    const iso = toIsoLocal("2026-11-02T10:00");
    // Invoke assert.match to perform this step.
    assert.match(iso, /^2026-11-02T/);
    // Invoke assert.throws to perform this step.
    assert.throws(() => toIsoLocal("not-a-date"), /invalid_date/);
  });
});
