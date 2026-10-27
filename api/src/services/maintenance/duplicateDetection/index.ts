export { normalizeIdentityText } from "./normalize";
export {
  optionIdentityKey,
  customDuplicateIdentityKey,
  customIdentityLockKey,
  duplicateLockKey,
} from "./identity";
export { synonymGroupForLabel, labelsAreSimilar } from "./synonyms";
export { lockDuplicateIdentity } from "./locks";
export {
  detectDuplicates,
  storedDuplicateIdentityKey,
  type DetectDuplicatesInput,
  type DuplicateDetectionResult,
  type DuplicateMatch,
  type ExistingTicketSummary,
} from "./detect";
