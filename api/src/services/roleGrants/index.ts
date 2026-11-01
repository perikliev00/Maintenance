/**
 * Role → panel/action grants: cache, queries, replace, seed, and audit history.
 * Owner is implicit (all panels/actions) and never stored in RoleGrant rows.
 */
export { invalidateGrantCache } from "./cache";
export { ensureDefaultRoleGrants, applyCatalogGrantSeed } from "./seed";
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
export { replaceRoleGrants } from "./replace";
export { listPermissionHistory } from "./history";
export { diffGrantSets } from "./diff";
