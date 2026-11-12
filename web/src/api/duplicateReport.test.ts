/**
 * Unit tests for duplicate report error parsing.
 */
import assert from "node:assert/strict";
// Import dependency used by this module.
import { describe, it } from "node:test";
// Import dependency used by this module.
import { ApiRequestError } from "./http";
// Import dependency used by this module.
import { parseDuplicateReportError } from "./duplicateReport";

// Group related unit tests.
describe("parseDuplicateReportError", () => {
  // Unit test case.
  it("returns null for unrelated errors", () => {
    // Assert expected test outcome.
    assert.equal(
      // Invoke helper or pass arguments.
      parseDuplicateReportError(new Error("boom")),
      // List item in import/export/params.
      null,
    );
  });

  // Unit test case.
  it("parses duplicate_active details", () => {
    // Local constant binding.
    const err = new ApiRequestError("An active duplicate ticket already exists", {
      // Field/property in this shape.
      kind: "http",
      // Field/property in this shape.
      status: 409,
      // Field/property in this shape.
      code: "duplicate_active",
      // Field/property in this shape.
      details: {
        // Field/property in this shape.
        existingTicket: {
          // Field/property in this shape.
          id: "t1",
          // Field/property in this shape.
          status: "new",
          // Field/property in this shape.
          title: "Clogged sink",
          // Field/property in this shape.
          locationId: "loc1",
          // Field/property in this shape.
          priority: "urgent",
          // Field/property in this shape.
          blocksRoom: true,
        },
        // Field/property in this shape.
        match: { kind: "exact", identityKey: "option:loc1:opt", reason: "same option" },
      },
    });
    // Local constant binding.
    const parsed = parseDuplicateReportError(err);
    // Assert expected test outcome.
    assert.ok(parsed);
    // Assert expected test outcome.
    assert.equal(parsed.code, "duplicate_active");
    // Assert expected test outcome.
    assert.equal(parsed.existingTicket?.id, "t1");
    // Assert expected test outcome.
    assert.equal(parsed.matchReason, "same option");
  });
});
