// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module dependency for this service.
import {
  // Run next step: assertValidSectorFields,
  assertValidSectorFields,
  // Run next step: normalizeLocationIds,
  normalizeLocationIds,
  // Run next step: normalizeSectorFields,
  normalizeSectorFields,
// Run next step: } from "./validation";
} from "./validation";

// Run next step: describe("sector validation", () => {
describe("sector validation", () => {
  // Run next step: it("normalizes code to uppercase trimmed", () => {
  it("normalizes code to uppercase trimmed", () => {
    // Run next step: assert.deepEqual(normalizeSectorFields({ code: " ab-1 " }), …
    assert.deepEqual(normalizeSectorFields({ code: "  ab-1  " }), {
      // Set code on the structure being built.
      code: "AB-1",
    });
  });

  // Run next step: it("rejects whitespace-only names after normalize", () => {
  it("rejects whitespace-only names after normalize", () => {
    // Capture fields for use in this scope.
    const fields = normalizeSectorFields({
      // Set code on the structure being built.
      code: "X",
      // Set nameBg on the structure being built.
      nameBg: "   ",
      // Set nameEn on the structure being built.
      nameEn: "Ok",
    });
    // Run next step: assert.throws(
    assert.throws(
      // Run next step: () => assertValidSectorFields(fields, { requireAll: true }),
      () => assertValidSectorFields(fields, { requireAll: true }),
      // Run next step: (err: unknown) =>
      (err: unknown) =>
        // Run next step: err instanceof AppError &&
        err instanceof AppError &&
        // Run next step: err.status === 400 &&
        err.status === 400 &&
        // Run next step: /nameBg/.test(err.message),
        /nameBg/.test(err.message),
    );
  });

  // Run next step: it("rejects empty code after normalize", () => {
  it("rejects empty code after normalize", () => {
    // Capture fields for use in this scope.
    const fields = normalizeSectorFields({ code: "   " });
    // Run next step: assert.throws(
    assert.throws(
      // Run next step: () => assertValidSectorFields(fields),
      () => assertValidSectorFields(fields),
      // Run next step: (err: unknown) => err instanceof AppError && err.code === "v…
      (err: unknown) => err instanceof AppError && err.code === "validation",
    );
  });

  // Run next step: it("dedupes location ids preserving order", () => {
  it("dedupes location ids preserving order", () => {
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: normalizeLocationIds(["a", " b ", "a", "", "c", "b"]),
      normalizeLocationIds(["a", " b ", "a", "", "c", "b"]),
      // Run next step: ["a", "b", "c"],
      ["a", "b", "c"],
    );
  });
});
