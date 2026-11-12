// Import module node:assert/strict for this service.
import assert from "node:assert/strict";
// Import module node:test for this service.
import { describe, it } from "node:test";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module dependency for this service.
import {
  // Run next step: decodeTicketListCursor,
  decodeTicketListCursor,
  // Run next step: encodeTicketListCursor,
  encodeTicketListCursor,
// Run next step: } from "./ticketListCursor";
} from "./ticketListCursor";

// Run next step: describe("ticket list cursor", () => {
describe("ticket list cursor", () => {
  // Run next step: it("round-trips openedAt and resolvedAt cursors", () => {
  it("round-trips openedAt and resolvedAt cursors", () => {
    // Build opened object holding related fields.
    const opened = {
      // Set sort on the structure being built.
      sort: "openedAt" as const,
      // Set at on the structure being built.
      at: new Date("2026-03-01T12:00:00.000Z"),
      // Set id on the structure being built.
      id: "tkt_abc",
    };
    // Build resolved object holding related fields.
    const resolved = {
      // Set sort on the structure being built.
      sort: "resolvedAt" as const,
      // Set at on the structure being built.
      at: new Date("2026-03-02T08:30:00.000Z"),
      // Set id on the structure being built.
      id: "tkt_xyz",
    };
    // Run next step: assert.deepEqual(decodeTicketListCursor(encodeTicketListCurs…
    assert.deepEqual(decodeTicketListCursor(encodeTicketListCursor(opened)), opened);
    // Run next step: assert.deepEqual(
    assert.deepEqual(
      // Run next step: decodeTicketListCursor(encodeTicketListCursor(resolved)),
      decodeTicketListCursor(encodeTicketListCursor(resolved)),
      // Run next step: resolved,
      resolved,
    );
  });

  // Run next step: it("preserves millisecond precision across encode/decode", (…
  it("preserves millisecond precision across encode/decode", () => {
    // Capture at for use in this scope.
    const at = new Date("2026-06-15T01:02:03.456Z");
    // Capture decoded for use in this scope.
    const decoded = decodeTicketListCursor(
      // Run next step: encodeTicketListCursor({ sort: "openedAt", at, id: "id-1" })…
      encodeTicketListCursor({ sort: "openedAt", at, id: "id-1" }),
    );
    // Run next step: assert.equal(decoded.at.toISOString(), at.toISOString());
    assert.equal(decoded.at.toISOString(), at.toISOString());
  });

  // Run next step: it("rejects malformed cursors", () => {
  it("rejects malformed cursors", () => {
    // Iterate items to apply the same logic to each entry.
    for (const bad of [
      // Run next step: "",
      "",
      // Run next step: "%%%",
      "%%%",
      // Run next step: "not-base64",
      "not-base64",
      // Run next step: Buffer.from("[]").toString("base64url"),
      Buffer.from("[]").toString("base64url"),
      // Run next step: Buffer.from(JSON.stringify(["openedAt"])).toString("base64ur…
      Buffer.from(JSON.stringify(["openedAt"])).toString("base64url"),
      // Run next step: Buffer.from(JSON.stringify(["openedAt", "bad-date", "id"])).…
      Buffer.from(JSON.stringify(["openedAt", "bad-date", "id"])).toString(
        // Run next step: "base64url",
        "base64url",
      ),
      // Run next step: Buffer.from(JSON.stringify(["nope", "2026-01-01T00:00:00.000…
      Buffer.from(JSON.stringify(["nope", "2026-01-01T00:00:00.000Z", "id"])).toString(
        // Run next step: "base64url",
        "base64url",
      ),
      // Run next step: Buffer.from(JSON.stringify(["openedAt", "2026-01-01T00:00:00…
      Buffer.from(JSON.stringify(["openedAt", "2026-01-01T00:00:00.000Z", ""])).toString(
        // Run next step: "base64url",
        "base64url",
      ),
    // Run next step: ]) {
    ]) {
      // Run next step: assert.throws(
      assert.throws(
        // Run next step: () => decodeTicketListCursor(bad),
        () => decodeTicketListCursor(bad),
        // Run next step: (err: unknown) => err instanceof AppError && err.status === …
        (err: unknown) => err instanceof AppError && err.status === 400,
      );
    }
  });

  // Run next step: it("rejects oversized cursors", () => {
  it("rejects oversized cursors", () => {
    // Run next step: assert.throws(
    assert.throws(
      // Run next step: () => decodeTicketListCursor("a".repeat(3000)),
      () => decodeTicketListCursor("a".repeat(3000)),
      // Run next step: (err: unknown) => err instanceof AppError && err.status === …
      (err: unknown) => err instanceof AppError && err.status === 400,
    );
  });
});
