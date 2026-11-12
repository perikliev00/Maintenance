import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CARD_TYPES, labelForType, toIsoLocal } from "./cardLabels";

describe("cardLabels", () => {
  it("exposes the five card types used by the issue wizard", () => {
    assert.deepEqual(
      CARD_TYPES.map((row) => row.id),
      ["guest", "housekeeper", "maintenance", "manager", "master"],
    );
  });

  it("localizes known card types and falls back to the raw id", () => {
    assert.equal(labelForType("bg", "guest"), "Гост");
    assert.equal(labelForType("en", "guest"), "Guest");
    assert.equal(labelForType("en", "unknown" as "guest"), "unknown");
  });

  it("parses datetime-local values to ISO and rejects invalid input", () => {
    const iso = toIsoLocal("2026-11-02T10:00");
    assert.match(iso, /^2026-11-02T/);
    assert.throws(() => toIsoLocal("not-a-date"), /invalid_date/);
  });
});
