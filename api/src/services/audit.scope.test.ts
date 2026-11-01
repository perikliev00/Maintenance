import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  auditEventMatchesScope,
  auditScopeArgsFor,
  buildAuditScopeWhere,
} from "./audit";

describe("auditScopeArgsFor", () => {
  it("leaves kind=all unrestricted", () => {
    const args = auditScopeArgsFor({ kind: "all", sectorIds: [] }, null);
    assert.equal(args.scopeLocationIds, undefined);
    assert.equal(args.scopeSectorIds, undefined);
  });

  it("never leaves sector scope unrestricted (empty locations → empty array)", () => {
    const args = auditScopeArgsFor(
      { kind: "sectors", sectorIds: ["sec-a"] },
      null,
    );
    assert.deepEqual(args.scopeLocationIds, []);
    assert.deepEqual(args.scopeSectorIds, ["sec-a"]);
  });

  it("passes through scoped location ids for sector actors", () => {
    const args = auditScopeArgsFor(
      { kind: "sectors", sectorIds: ["sec-a"] },
      ["loc-1", "loc-2"],
    );
    assert.deepEqual(args.scopeLocationIds, ["loc-1", "loc-2"]);
    assert.deepEqual(args.scopeSectorIds, ["sec-a"]);
  });
});

describe("auditEventMatchesScope", () => {
  it("BUG-01: SLA/overdue rows without locationId are excluded from sector scope", () => {
    const locs = ["loc-own"];
    const sectors = ["sec-own"];
    assert.equal(
      auditEventMatchesScope(
        {
          locationId: null,
          entityType: "maintenance_ticket",
          entityId: "tkt-1",
        },
        locs,
        sectors,
      ),
      false,
    );
    assert.equal(
      auditEventMatchesScope(
        {
          locationId: "loc-own",
          entityType: "maintenance_ticket",
          entityId: "tkt-1",
        },
        locs,
        sectors,
      ),
      true,
    );
  });

  it("matches in-scope location events and own sector entity rows", () => {
    const locs = ["loc-own"];
    const sectors = ["sec-own"];
    assert.equal(
      auditEventMatchesScope(
        { locationId: "loc-own", entityType: "location", entityId: "loc-own" },
        locs,
        sectors,
      ),
      true,
    );
    assert.equal(
      auditEventMatchesScope(
        { locationId: null, entityType: "sector", entityId: "sec-own" },
        locs,
        sectors,
      ),
      true,
    );
  });

  it("excludes foreign locations and other sectors' entity rows", () => {
    const locs = ["loc-own"];
    const sectors = ["sec-own"];
    assert.equal(
      auditEventMatchesScope(
        {
          locationId: "loc-foreign",
          entityType: "location",
          entityId: "loc-foreign",
        },
        locs,
        sectors,
      ),
      false,
    );
    assert.equal(
      auditEventMatchesScope(
        { locationId: null, entityType: "sector", entityId: "sec-other" },
        locs,
        sectors,
      ),
      false,
    );
    assert.equal(
      auditEventMatchesScope(
        { locationId: null, entityType: "setting", entityId: "x" },
        locs,
        sectors,
      ),
      false,
    );
  });

  it("treats omitted scope as unrestricted", () => {
    assert.equal(
      auditEventMatchesScope(
        { locationId: "anywhere", entityType: "location", entityId: "x" },
        undefined,
      ),
      true,
    );
  });
});

describe("buildAuditScopeWhere", () => {
  it("uses __none__ sentinel when location list is empty", () => {
    const where = buildAuditScopeWhere([], ["sec-a"]);
    assert.deepEqual(where, {
      OR: [
        { locationId: { in: ["__none__"] } },
        {
          locationId: null,
          entityType: "sector",
          entityId: { in: ["sec-a"] },
        },
      ],
    });
  });
});
