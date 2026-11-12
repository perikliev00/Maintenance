/**
 * Deterministic text normalization for duplicate identity keys.
 * No fuzzy/AI matching — safe punctuation and whitespace only.
 */

/** Characters stripped as harmless punctuation after Unicode normalize. */
const HARMLESS_PUNCT = /[/\\|_.,;:()[\]"'`~!?+-]+/g;

/**
 * Normalize free text for identity comparison:
 * NFKC → lowercase → strip harmless punctuation → collapse whitespace → trim.
 */
export function normalizeIdentityText(value: string): string {
  // Build the identity key through successive safe text transforms.
  return value
    // Canonicalize Unicode so equivalent glyphs compare equal.
    .normalize("NFKC")
    // Lowercase so casing differences do not create false uniqueness.
    .toLowerCase()
    // Drop punctuation that should not affect identity matching.
    .replace(HARMLESS_PUNCT, " ")
    // Collapse runs of whitespace into a single separator.
    .replace(/\s+/g, " ")
    // Trim edges so leading/trailing space is ignored.
    .trim();
}
