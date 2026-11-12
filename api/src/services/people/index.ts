/** People directory mappers and lifecycle (block / archive / devices access). */
export {
  blockPerson,
  unblockPerson,
  archivePerson,
  restorePerson,
  getPerson,
  canManagePersonAccess,
  // Declare type LifecycleActor for callers and internals.
  type LifecycleActor,
} from "./lifecycle";
// Re-export selected symbols for barrel consumers.
export {
  derivePersonStatus,
  mapPersonDto,
  PERSON_STATUSES,
  // Declare type PersonDto for callers and internals.
  type PersonDto,
  // Declare type PersonStatus for callers and internals.
  type PersonStatus,
} from "./status";
// Re-export selected symbols for barrel consumers.
export {
  listPeopleDirectory,
  encodePeopleCursor,
  decodePeopleCursor,
  // Declare type ListPeopleQuery for callers and internals.
  type ListPeopleQuery,
  // Declare type ListPeopleResult for callers and internals.
  type ListPeopleResult,
} from "./directory";
// Re-export selected symbols for barrel consumers.
export { changePersonRole } from "./changeRole";
