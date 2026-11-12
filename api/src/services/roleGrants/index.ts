/**
 * Role → panel/action grants: cache, queries, replace, seed, and audit history.
 * Owner is implicit (all panels/actions) and never stored in RoleGrant rows.
 */
export { invalidateGrantCache, readGrantRevisionStamp } from "./cache";
// Re-export selected symbols for barrel consumers.
export { ensureDefaultRoleGrants, applyCatalogGrantSeed } from "./seed";
// Re-export selected symbols for barrel consumers.
export {
  getGrantsForRole,
  panelsForRole,
  actionsForRole,
  canPerform,
  capabilitiesFor,
  editableRolesFor,
  getFullMatrix,
  getRoleGrantVersions,
} from "./query";
// Re-export selected symbols for barrel consumers.
export { replaceRoleGrants } from "./replace";
// Re-export selected symbols for barrel consumers.
export { listPermissionHistory } from "./history";
// Re-export selected symbols for barrel consumers.
export { diffGrantSets } from "./diff";
