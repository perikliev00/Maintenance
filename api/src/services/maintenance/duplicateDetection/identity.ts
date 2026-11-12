/**
 * Stable duplicate identity keys for maintenance reports.
 */
import { normalizeIdentityText } from "./normalize";

/** Catalog-option exact identity: location + option. */
export function optionIdentityKey(
  // Set locationId on the structure being built.
  locationId: string,
  // Set issueOptionId on the structure being built.
  issueOptionId: string,
// Run next step: ): string {
): string {
  // Return the computed result to the caller.
  return `option:${locationId}:${issueOptionId}`;
}

/**
 * Custom (category+title) identity stored on the ticket as duplicateIdentityKey.
 * Does not embed locationId — that is always queried with locationId.
 */
export function customDuplicateIdentityKey(
  // Set categoryId on the structure being built.
  categoryId: string,
  // Set title on the structure being built.
  title: string,
// Run next step: ): string {
): string {
  // Return the computed result to the caller.
  return `custom:${categoryId}:${normalizeIdentityText(title)}`;
}

/** Lock / log key that includes location for advisory locks. */
export function customIdentityLockKey(
  // Set locationId on the structure being built.
  locationId: string,
  // Set categoryId on the structure being built.
  categoryId: string,
  // Set title on the structure being built.
  title: string,
// Run next step: ): string {
): string {
  // Return the computed result to the caller.
  return `custom:${locationId}:${categoryId}:${normalizeIdentityText(title)}`;
}

/** Advisory-lock string for any report identity. */
export function duplicateLockKey(input: {
  // Set locationId on the structure being built.
  locationId: string;
  // Run next step: issueOptionId?: string | null;
  issueOptionId?: string | null;
  // Run next step: categoryId?: string | null;
  categoryId?: string | null;
  // Set title on the structure being built.
  title: string;
// Run next step: }): string {
}): string {
  // Branch when this condition holds so the right path runs.
  if (input.issueOptionId) {
    // Return the computed result to the caller.
    return optionIdentityKey(input.locationId, input.issueOptionId);
  }
  // Branch when this condition holds so the right path runs.
  if (!input.categoryId) {
    // Abort with an error so callers can react.
    throw new Error("categoryId required when issueOptionId is absent");
  }
  // Return the computed result to the caller.
  return customIdentityLockKey(input.locationId, input.categoryId, input.title);
}
