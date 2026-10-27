/**
 * Deterministic text normalization for duplicate identity keys.
 * No fuzzy/AI matching — safe punctuation and whitespace only.
 */

/** Characters stripped as harmless punctuation after Unicode normalize. */
const HARMLESS_PUNCT = /[/\\|_.,;:()[\]"'`~!?+\-]+/g;

/**
 * Normalize free text for identity comparison:
 * NFKC → lowercase → strip harmless punctuation → collapse whitespace → trim.
 */
export function normalizeIdentityText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(HARMLESS_PUNCT, " ")
    .replace(/\s+/g, " ")
    .trim();
}
