/**
 * Unit tests for duplicate report error parsing.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiRequestError } from "./http";
import { parseDuplicateReportError } from "./duplicateReport";

describe("parseDuplicateReportError", () => {
  it("returns null for unrelated errors", () => {
    assert.equal(
      parseDuplicateReportError(new Error("boom")),
      null,
    );
  });

  it("parses duplicate_active details", () => {
    const err = new ApiRequestError("An active duplicate ticket already exists", {
      kind: "http",
      status: 409,
      code: "duplicate_active",
      details: {
        existingTicket: {
          id: "t1",
          status: "new",
          title: "Clogged sink",
          locationId: "loc1",
          priority: "urgent",
          blocksRoom: true,
        },
        match: { kind: "exact", identityKey: "option:loc1:opt", reason: "same option" },
      },
    });
    const parsed = parseDuplicateReportError(err);
    assert.ok(parsed);
    assert.equal(parsed.code, "duplicate_active");
    assert.equal(parsed.existingTicket?.id, "t1");
    assert.equal(parsed.matchReason, "same option");
  });
});
