import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "../../errors";
import {
  decodeTicketListCursor,
  encodeTicketListCursor,
} from "./ticketListCursor";

describe("ticket list cursor", () => {
  it("round-trips openedAt and resolvedAt cursors", () => {
    const opened = {
      sort: "openedAt" as const,
      at: new Date("2026-03-01T12:00:00.000Z"),
      id: "tkt_abc",
    };
    const resolved = {
      sort: "resolvedAt" as const,
      at: new Date("2026-03-02T08:30:00.000Z"),
      id: "tkt_xyz",
    };
    assert.deepEqual(decodeTicketListCursor(encodeTicketListCursor(opened)), opened);
    assert.deepEqual(
      decodeTicketListCursor(encodeTicketListCursor(resolved)),
      resolved,
    );
  });

  it("preserves millisecond precision across encode/decode", () => {
    const at = new Date("2026-06-15T01:02:03.456Z");
    const decoded = decodeTicketListCursor(
      encodeTicketListCursor({ sort: "openedAt", at, id: "id-1" }),
    );
    assert.equal(decoded.at.toISOString(), at.toISOString());
  });

  it("rejects malformed cursors", () => {
    for (const bad of [
      "",
      "%%%",
      "not-base64",
      Buffer.from("[]").toString("base64url"),
      Buffer.from(JSON.stringify(["openedAt"])).toString("base64url"),
      Buffer.from(JSON.stringify(["openedAt", "bad-date", "id"])).toString(
        "base64url",
      ),
      Buffer.from(JSON.stringify(["nope", "2026-01-01T00:00:00.000Z", "id"])).toString(
        "base64url",
      ),
      Buffer.from(JSON.stringify(["openedAt", "2026-01-01T00:00:00.000Z", ""])).toString(
        "base64url",
      ),
    ]) {
      assert.throws(
        () => decodeTicketListCursor(bad),
        (err: unknown) => err instanceof AppError && err.status === 400,
      );
    }
  });

  it("rejects oversized cursors", () => {
    assert.throws(
      () => decodeTicketListCursor("a".repeat(3000)),
      (err: unknown) => err instanceof AppError && err.status === 400,
    );
  });
});
