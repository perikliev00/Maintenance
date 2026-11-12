/**
 * Deterministic synonym groups for probable (soft) duplicate detection.
 * Groups are matched by normalized option name (BG/EN) or free-text title.
 * Never treated as proof of an exact duplicate.
 */
import { normalizeIdentityText } from "./normalize";

/**
 * Each inner array is a synonym cluster. Matching any two labels in the same
 * cluster at the same location yields a probable_duplicate warning.
 */
const SYNONYM_GROUPS: string[][] = [
  [
    "Климатик не охлажда",
    "AC not cooling",
    "Проблем с охлаждането на климатика",
    "AC no cooling",
    "климатикът не охлажда",
  ],
  [
    "Теч от климатик",
    "AC leak",
    "AC leak under window",
  ],
  [
    "Запушен сифон/мивка",
    "Clogged sink",
    "запушен сифон / мивка",
    "clogged drain",
  ],
  [
    "Течещ кран",
    "Leaking tap",
    "dripping faucet",
  ],
  [
    "Няма ток на контакти",
    "No power at sockets",
    "no power at desk sockets",
  ],
  [
    "Мигаща лампа",
    "Flickering light",
    "flickering bathroom light",
  ],
  [
    "Счупена мебел",
    "Broken furniture",
    "broken wardrobe hinge",
  ],
  [
    "Петно / миризма",
    "Stain / odor",
    "Strong mold smell in bath",
  ],
];

/** Precomputed map: normalized label → group index. */
const LABEL_TO_GROUP = new Map<string, number>();

// Iterate items to apply the same logic to each entry.
for (let i = 0; i < SYNONYM_GROUPS.length; i++) {
  // Iterate items to apply the same logic to each entry.
  for (const label of SYNONYM_GROUPS[i]!) {
    // Store a keyed value for later lookup.
    LABEL_TO_GROUP.set(normalizeIdentityText(label), i);
  }
}

/** Synonym group index for a label, or null if unknown. */
export function synonymGroupForLabel(label: string): number | null {
  const key = normalizeIdentityText(label);
  if (!key) return null;
  const idx = LABEL_TO_GROUP.get(key);
  return idx === undefined ? null : idx;
}

/** True when two labels share a curated synonym group. */
export function labelsAreSimilar(a: string, b: string): boolean {
  const ga = synonymGroupForLabel(a);
  const gb = synonymGroupForLabel(b);
  return ga !== null && gb !== null && ga === gb;
}
