/**
 * Stable duplicate identity keys for maintenance reports.
 */
import { normalizeIdentityText } from "./normalize";

/** Catalog-option exact identity: location + option. */
export function optionIdentityKey(
  locationId: string,
  issueOptionId: string,
): string {
  return `option:${locationId}:${issueOptionId}`;
}

/**
 * Custom (category+title) identity stored on the ticket as duplicateIdentityKey.
 * Does not embed locationId — that is always queried with locationId.
 */
export function customDuplicateIdentityKey(
  categoryId: string,
  title: string,
): string {
  return `custom:${categoryId}:${normalizeIdentityText(title)}`;
}

/** Lock / log key that includes location for advisory locks. */
export function customIdentityLockKey(
  locationId: string,
  categoryId: string,
  title: string,
): string {
  return `custom:${locationId}:${categoryId}:${normalizeIdentityText(title)}`;
}

/** Advisory-lock string for any report identity. */
export function duplicateLockKey(input: {
  locationId: string;
  issueOptionId?: string | null;
  categoryId?: string | null;
  title: string;
}): string {
  if (input.issueOptionId) {
    return optionIdentityKey(input.locationId, input.issueOptionId);
  }
  if (!input.categoryId) {
    throw new Error("categoryId required when issueOptionId is absent");
  }
  return customIdentityLockKey(input.locationId, input.categoryId, input.title);
}
