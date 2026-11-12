// Strict assert helpers for precise test failures.
import assert from "node:assert/strict";
// Node test runner (describe/it/hooks).
import { describe, it } from "node:test";
// Module import required below.
import {
  auditEventMatchesScope,
  auditScopeArgsFor,
  buildAuditScopeWhere,
// Support the surrounding control flow.
} from "./audit";

// Test suite: auditScopeArgsFor.
describe("auditScopeArgsFor", () => {
  // Test case: leaves kind=all unrestricted.
  it("leaves kind=all unrestricted", () => {
    // Local args used below.
    const args = auditScopeArgsFor({ kind: "all", sectorIds: [] }, null);
    // Compare scalar values.
    assert.equal(args.scopeLocationIds, undefined);
    // Compare scalar values.
    assert.equal(args.scopeSectorIds, undefined);
  });

  // Test case: never leaves sector scope unrestricted (empty locations → empty array).
  it("never leaves sector scope unrestricted (empty locations → empty array)", () => {
    // Local args used below.
    const args = auditScopeArgsFor(
      // Support the surrounding control flow.
      { kind: "sectors", sectorIds: ["sec-a"] },
      null,
    );
    // Deep-compare structures.
    assert.deepEqual(args.scopeLocationIds, []);
    // Deep-compare structures.
    assert.deepEqual(args.scopeSectorIds, ["sec-a"]);
  });

  // Test case: passes through scoped location ids for sector actors.
  it("passes through scoped location ids for sector actors", () => {
    // Local args used below.
    const args = auditScopeArgsFor(
      // Support the surrounding control flow.
      { kind: "sectors", sectorIds: ["sec-a"] },
      // Support the surrounding control flow.
      ["loc-1", "loc-2"],
    );
    // Deep-compare structures.
    assert.deepEqual(args.scopeLocationIds, ["loc-1", "loc-2"]);
    // Deep-compare structures.
    assert.deepEqual(args.scopeSectorIds, ["sec-a"]);
  });
});

// Test suite: auditEventMatchesScope.
describe("auditEventMatchesScope", () => {
  // Test case: SLA/overdue rows without locationId are excluded from sector scope.
  it("SLA/overdue rows without locationId are excluded from sector scope", () => {
    // Local locs used below.
    const locs = ["loc-own"];
    // Local sectors used below.
    const sectors = ["sec-own"];
    // Compare scalar values.
    assert.equal(
      // Invoke auditEventMatchesScope.
      auditEventMatchesScope(
        // Support the surrounding control flow.
        {
          // Set locationId.
          locationId: null,
          // Set entityType.
          entityType: "maintenance_ticket",
          // Set entityId.
          entityId: "tkt-1",
        },
        locs,
        sectors,
      ),
      false,
    );
    // Compare scalar values.
    assert.equal(
      // Invoke auditEventMatchesScope.
      auditEventMatchesScope(
        // Support the surrounding control flow.
        {
          // Set locationId.
          locationId: "loc-own",
          // Set entityType.
          entityType: "maintenance_ticket",
          // Set entityId.
          entityId: "tkt-1",
        },
        locs,
        sectors,
      ),
      true,
    );
  });

  // Test case: matches in-scope location events and own sector entity rows.
  it("matches in-scope location events and own sector entity rows", () => {
    // Local locs used below.
    const locs = ["loc-own"];
    // Local sectors used below.
    const sectors = ["sec-own"];
    // Compare scalar values.
    assert.equal(
      // Invoke auditEventMatchesScope.
      auditEventMatchesScope(
        // Support the surrounding control flow.
        { locationId: "loc-own", entityType: "location", entityId: "loc-own" },
        locs,
        sectors,
      ),
      true,
    );
    // Compare scalar values.
    assert.equal(
      // Invoke auditEventMatchesScope.
      auditEventMatchesScope(
        // Support the surrounding control flow.
        { locationId: null, entityType: "sector", entityId: "sec-own" },
        locs,
        sectors,
      ),
      true,
    );
  });

  // Test case: excludes foreign locations and other sectors.
  it("excludes foreign locations and other sectors' entity rows", () => {
    // Local locs used below.
    const locs = ["loc-own"];
    // Local sectors used below.
    const sectors = ["sec-own"];
    // Compare scalar values.
    assert.equal(
      // Invoke auditEventMatchesScope.
      auditEventMatchesScope(
        // Support the surrounding control flow.
        {
          // Set locationId.
          locationId: "loc-foreign",
          // Set entityType.
          entityType: "location",
          // Set entityId.
          entityId: "loc-foreign",
        },
        locs,
        sectors,
      ),
      false,
    );
    // Compare scalar values.
    assert.equal(
      // Invoke auditEventMatchesScope.
      auditEventMatchesScope(
        // Support the surrounding control flow.
        { locationId: null, entityType: "sector", entityId: "sec-other" },
        locs,
        sectors,
      ),
      false,
    );
    // Compare scalar values.
    assert.equal(
      // Invoke auditEventMatchesScope.
      auditEventMatchesScope(
        // Support the surrounding control flow.
        { locationId: null, entityType: "setting", entityId: "x" },
        locs,
        sectors,
      ),
      false,
    );
  });

  // Test case: treats omitted scope as unrestricted.
  it("treats omitted scope as unrestricted", () => {
    // Compare scalar values.
    assert.equal(
      // Invoke auditEventMatchesScope.
      auditEventMatchesScope(
        // Support the surrounding control flow.
        { locationId: "anywhere", entityType: "location", entityId: "x" },
        undefined,
      ),
      true,
    );
  });
});

// Test suite: buildAuditScopeWhere.
describe("buildAuditScopeWhere", () => {
  // Test case: uses __none__ sentinel when location list is empty.
  it("uses __none__ sentinel when location list is empty", () => {
    // Local where used below.
    const where = buildAuditScopeWhere([], ["sec-a"]);
    // Deep-compare structures.
    assert.deepEqual(where, {
      // Set OR.
      OR: [
        // Support the surrounding control flow.
        { locationId: { in: ["__none__"] } },
        // Support the surrounding control flow.
        {
          // Set locationId.
          locationId: null,
          // Set entityType.
          entityType: "sector",
          // Set entityId.
          entityId: { in: ["sec-a"] },
        },
      ],
    });
  });
});
