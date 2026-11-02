/**
 * Catalogs must stay identical to the shared permissionsCatalog module.
 * Intentional API-only policies (DEFAULT_ACTION_GRANTS, assignableRolesFor)
 * are not mirrored here and are out of scope for this check.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_ACTIONS as CATALOG_ACTIONS,
  ALL_PANELS as CATALOG_PANELS,
  DEFAULT_PANEL_BY_ROLE,
  LANDING_BY_ROLE,
} from "../../../api/src/contracts/permissionsCatalog";
import {
  ALL_ACTIONS,
  ALL_PANELS,
  landingForRole,
  panelsForRole,
} from "./capabilities";

test("TD: web ALL_PANELS is the shared catalog reference", () => {
  assert.equal(ALL_PANELS, CATALOG_PANELS);
  assert.deepEqual([...ALL_PANELS], [...CATALOG_PANELS]);
});

test("TD: web ALL_ACTIONS is the shared catalog reference", () => {
  assert.equal(ALL_ACTIONS, CATALOG_ACTIONS);
  assert.deepEqual([...ALL_ACTIONS], [...CATALOG_ACTIONS]);
});

test("TD: offline panel fallback matches DEFAULT_PANEL_BY_ROLE", () => {
  assert.deepEqual(panelsForRole("housekeeper"), [
    ...DEFAULT_PANEL_BY_ROLE.housekeeper,
  ]);
  assert.deepEqual(panelsForRole("manager"), [...DEFAULT_PANEL_BY_ROLE.manager]);
});

test("TD: landingForRole matches shared LANDING_BY_ROLE", () => {
  assert.equal(landingForRole("owner"), LANDING_BY_ROLE.owner);
  assert.equal(landingForRole("reception"), LANDING_BY_ROLE.reception);
});
