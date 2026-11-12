/**
 * Catalogs must stay identical to the shared permissionsCatalog module.
 * Intentional API-only policies (DEFAULT_ACTION_GRANTS, assignableRolesFor)
 * are not mirrored here and are out of scope for this check.
 */
import assert from "node:assert/strict";
// Import dependency used by this module.
import test from "node:test";
// Import dependency used by this module.
import {
  // Continue multi-line list/arguments.
  ALL_ACTIONS as CATALOG_ACTIONS,
  // Continue multi-line list/arguments.
  ALL_PANELS as CATALOG_PANELS,
  // List item in import/export/params.
  DEFAULT_PANEL_BY_ROLE,
  // List item in import/export/params.
  LANDING_BY_ROLE,
// Close multi-line construct with trailing syntax.
} from "../../../api/src/contracts/permissionsCatalog";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  ALL_ACTIONS,
  // List item in import/export/params.
  ALL_PANELS,
  // List item in import/export/params.
  landingForRole,
  // List item in import/export/params.
  panelsForRole,
// Close multi-line construct with trailing syntax.
} from "./capabilities";

// Unit test case.
test("TD: web ALL_PANELS is the shared catalog reference", () => {
  // Assert expected test outcome.
  assert.equal(ALL_PANELS, CATALOG_PANELS);
  // Assert expected test outcome.
  assert.deepEqual([...ALL_PANELS], [...CATALOG_PANELS]);
});

// Unit test case.
test("TD: web ALL_ACTIONS is the shared catalog reference", () => {
  // Assert expected test outcome.
  assert.equal(ALL_ACTIONS, CATALOG_ACTIONS);
  // Assert expected test outcome.
  assert.deepEqual([...ALL_ACTIONS], [...CATALOG_ACTIONS]);
});

// Unit test case.
test("TD: offline panel fallback matches DEFAULT_PANEL_BY_ROLE", () => {
  // Assert expected test outcome.
  assert.deepEqual(panelsForRole("housekeeper"), [
    // Spread remaining fields/props.
    ...DEFAULT_PANEL_BY_ROLE.housekeeper,
  ]);
  // Assert expected test outcome.
  assert.deepEqual(panelsForRole("manager"), [...DEFAULT_PANEL_BY_ROLE.manager]);
});

// Unit test case.
test("TD: landingForRole matches shared LANDING_BY_ROLE", () => {
  // Assert expected test outcome.
  assert.equal(landingForRole("owner"), LANDING_BY_ROLE.owner);
  // Assert expected test outcome.
  assert.equal(landingForRole("reception"), LANDING_BY_ROLE.reception);
});
