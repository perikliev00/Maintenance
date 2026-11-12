// Re-export selected symbols for barrel consumers.
export { normalizeIdentityText } from "./normalize";
// Re-export selected symbols for barrel consumers.
export {
  optionIdentityKey,
  customDuplicateIdentityKey,
  customIdentityLockKey,
  duplicateLockKey,
} from "./identity";
// Re-export selected symbols for barrel consumers.
export { synonymGroupForLabel, labelsAreSimilar } from "./synonyms";
// Re-export selected symbols for barrel consumers.
export { lockDuplicateIdentity } from "./locks";
// Re-export selected symbols for barrel consumers.
export {
  detectDuplicates,
  storedDuplicateIdentityKey,
  // Declare type DetectDuplicatesInput for callers and internals.
  type DetectDuplicatesInput,
  // Declare type DuplicateDetectionResult for callers and internals.
  type DuplicateDetectionResult,
  // Declare type DuplicateMatch for callers and internals.
  type DuplicateMatch,
  // Declare type ExistingTicketSummary for callers and internals.
  type ExistingTicketSummary,
} from "./detect";
