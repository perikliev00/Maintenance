/**
 * Unit tests for duplicate identity text normalization.
 */
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module ./normalize for this service.
import { normalizeIdentityText } from "./normalize";
// Import module ./synonyms for this service.
import { labelsAreSimilar } from "./synonyms";
// Import module ./identity for this service.
import { customDuplicateIdentityKey } from "./identity";

// Run next step: describe("normalizeIdentityText", () => {
describe("normalizeIdentityText", () => {
  // Run next step: it("collapses whitespace and case", () => {
  it("collapses whitespace and case", () => {
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: normalizeIdentityText(" Запушен сифон/мивка "),
      normalizeIdentityText("  Запушен   сифон/мивка  "),
      // Run next step: normalizeIdentityText("запушен сифон / мивка"),
      normalizeIdentityText("запушен сифон / мивка"),
    );
  });

  // Run next step: it("strips harmless punctuation", () => {
  it("strips harmless punctuation", () => {
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: normalizeIdentityText("AC not cooling!!!"),
      normalizeIdentityText("AC not cooling!!!"),
      // Run next step: normalizeIdentityText("ac not cooling"),
      normalizeIdentityText("ac not cooling"),
    );
  });
});

// Run next step: describe("synonym groups", () => {
describe("synonym groups", () => {
  // Run next step: it("matches curated AC cooling aliases", () => {
  it("matches curated AC cooling aliases", () => {
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: labelsAreSimilar("Климатик не охлажда", "AC not cooling"),
      labelsAreSimilar("Климатик не охлажда", "AC not cooling"),
      // Run next step: true,
      true,
    );
  });

  // Run next step: it("does not match unrelated labels", () => {
  it("does not match unrelated labels", () => {
    // Run next step: assert.equal(
    assert.equal(
      // Run next step: labelsAreSimilar("Clogged sink", "Broken furniture"),
      labelsAreSimilar("Clogged sink", "Broken furniture"),
      // Run next step: false,
      false,
    );
  });
});

// Run next step: describe("customDuplicateIdentityKey", () => {
describe("customDuplicateIdentityKey", () => {
  // Run next step: it("is stable across formatting differences", () => {
  it("is stable across formatting differences", () => {
    // Capture a for use in this scope.
    const a = customDuplicateIdentityKey("cat1", "Запушен сифон/мивка");
    // Capture b for use in this scope.
    const b = customDuplicateIdentityKey("cat1", "запушен сифон / мивка");
    // Run next step: assert.equal(a, b);
    assert.equal(a, b);
  });
});
