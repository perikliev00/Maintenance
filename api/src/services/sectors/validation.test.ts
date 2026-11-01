import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "../../errors";
import {
  assertValidSectorFields,
  normalizeLocationIds,
  normalizeSectorFields,
} from "./validation";

describe("sector validation", () => {
  it("normalizes code to uppercase trimmed", () => {
    assert.deepEqual(normalizeSectorFields({ code: "  ab-1  " }), {
      code: "AB-1",
    });
  });

  it("rejects whitespace-only names after normalize", () => {
    const fields = normalizeSectorFields({
      code: "X",
      nameBg: "   ",
      nameEn: "Ok",
    });
    assert.throws(
      () => assertValidSectorFields(fields, { requireAll: true }),
      (err: unknown) =>
        err instanceof AppError &&
        err.status === 400 &&
        /nameBg/.test(err.message),
    );
  });

  it("rejects empty code after normalize", () => {
    const fields = normalizeSectorFields({ code: "   " });
    assert.throws(
      () => assertValidSectorFields(fields),
      (err: unknown) => err instanceof AppError && err.code === "validation",
    );
  });

  it("dedupes location ids preserving order", () => {
    assert.deepEqual(
      normalizeLocationIds(["a", " b ", "a", "", "c", "b"]),
      ["a", "b", "c"],
    );
  });
});
