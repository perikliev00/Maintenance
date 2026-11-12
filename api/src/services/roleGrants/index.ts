/**
 * Role → panel/action grants: cache, queries, replace, seed, and audit history.
 * Owner is implicit (all panels/actions) and never stored in RoleGrant rows.
 */
export { invalidateGrantCache, readGrantRevisionStamp } from "./cache";
// Re-export selected symbols for barrel consumers.
export { ensureDefaultRoleGrants, applyCatalogGrantSeed } from "./seed";
// Re-export selected symbols for barrel consumers.
export {
  // Run next step: getGrantsForRole,
  getGrantsForRole,
  // Run next step: panelsForRole,
  panelsForRole,
  // Run next step: actionsForRole,
  actionsForRole,
  // Run next step: canPerform,
  canPerform,
  // Run next step: capabilitiesFor,
  capabilitiesFor,
  // Run next step: editableRolesFor,
  editableRolesFor,
  // Run next step: getFullMatrix,
  getFullMatrix,
  // Run next step: getRoleGrantVersions,
  getRoleGrantVersions,
// Run next step: } from "./query";
} from "./query";
// Re-export selected symbols for barrel consumers.
export { replaceRoleGrants } from "./replace";
// Re-export selected symbols for barrel consumers.
export { listPermissionHistory } from "./history";
// Re-export selected symbols for barrel consumers.
export { diffGrantSets } from "./diff";
