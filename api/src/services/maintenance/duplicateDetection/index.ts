// Re-export selected symbols for barrel consumers.
export { normalizeIdentityText } from "./normalize";
// Re-export selected symbols for barrel consumers.
export {
  // Run next step: optionIdentityKey,
  optionIdentityKey,
  // Run next step: customDuplicateIdentityKey,
  customDuplicateIdentityKey,
  // Run next step: customIdentityLockKey,
  customIdentityLockKey,
  // Run next step: duplicateLockKey,
  duplicateLockKey,
// Run next step: } from "./identity";
} from "./identity";
// Re-export selected symbols for barrel consumers.
export { synonymGroupForLabel, labelsAreSimilar } from "./synonyms";
// Re-export selected symbols for barrel consumers.
export { lockDuplicateIdentity } from "./locks";
// Re-export selected symbols for barrel consumers.
export {
  // Run next step: detectDuplicates,
  detectDuplicates,
  // Run next step: storedDuplicateIdentityKey,
  storedDuplicateIdentityKey,
  // Declare type DetectDuplicatesInput for callers and internals.
  type DetectDuplicatesInput,
  // Declare type DuplicateDetectionResult for callers and internals.
  type DuplicateDetectionResult,
  // Declare type DuplicateMatch for callers and internals.
  type DuplicateMatch,
  // Declare type ExistingTicketSummary for callers and internals.
  type ExistingTicketSummary,
// Run next step: } from "./detect";
} from "./detect";
