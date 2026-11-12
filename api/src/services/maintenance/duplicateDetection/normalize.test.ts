/**
 * Unit tests for duplicate identity text normalization.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeIdentityText } from "./normalize";
import { labelsAreSimilar } from "./synonyms";
import { customDuplicateIdentityKey } from "./identity";

describe("normalizeIdentityText", () => {
  it("collapses whitespace and case", () => {
    assert.equal(
      normalizeIdentityText("  Запушен   сифон/мивка  "),
      normalizeIdentityText("запушен сифон / мивка"),
    );
  });

  it("strips harmless punctuation", () => {
    assert.equal(
      normalizeIdentityText("AC not cooling!!!"),
      normalizeIdentityText("ac not cooling"),
    );
  });
});

describe("synonym groups", () => {
  it("matches curated AC cooling aliases", () => {
    assert.equal(
      labelsAreSimilar("Климатик не охлажда", "AC not cooling"),
      true,
    );
  });

  it("does not match unrelated labels", () => {
    assert.equal(
      labelsAreSimilar("Clogged sink", "Broken furniture"),
      false,
    );
  });
});

describe("customDuplicateIdentityKey", () => {
  it("is stable across formatting differences", () => {
    const a = customDuplicateIdentityKey("cat1", "Запушен сифон/мивка");
    const b = customDuplicateIdentityKey("cat1", "запушен сифон / мивка");
    assert.equal(a, b);
  });
});
