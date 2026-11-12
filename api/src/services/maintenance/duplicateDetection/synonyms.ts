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
  // Run next step: [
  [
    // Run next step: "Климатик не охлажда",
    "Климатик не охлажда",
    // Run next step: "AC not cooling",
    "AC not cooling",
    // Run next step: "Проблем с охлаждането на климатика",
    "Проблем с охлаждането на климатика",
    // Run next step: "AC no cooling",
    "AC no cooling",
    // Run next step: "климатикът не охлажда",
    "климатикът не охлажда",
  ],
  // Run next step: [
  [
    // Run next step: "Теч от климатик",
    "Теч от климатик",
    // Run next step: "AC leak",
    "AC leak",
    // Run next step: "AC leak under window",
    "AC leak under window",
  ],
  // Run next step: [
  [
    // Run next step: "Запушен сифон/мивка",
    "Запушен сифон/мивка",
    // Run next step: "Clogged sink",
    "Clogged sink",
    // Run next step: "запушен сифон / мивка",
    "запушен сифон / мивка",
    // Run next step: "clogged drain",
    "clogged drain",
  ],
  // Run next step: [
  [
    // Run next step: "Течещ кран",
    "Течещ кран",
    // Run next step: "Leaking tap",
    "Leaking tap",
    // Run next step: "dripping faucet",
    "dripping faucet",
  ],
  // Run next step: [
  [
    // Run next step: "Няма ток на контакти",
    "Няма ток на контакти",
    // Run next step: "No power at sockets",
    "No power at sockets",
    // Run next step: "no power at desk sockets",
    "no power at desk sockets",
  ],
  // Run next step: [
  [
    // Run next step: "Мигаща лампа",
    "Мигаща лампа",
    // Run next step: "Flickering light",
    "Flickering light",
    // Run next step: "flickering bathroom light",
    "flickering bathroom light",
  ],
  // Run next step: [
  [
    // Run next step: "Счупена мебел",
    "Счупена мебел",
    // Run next step: "Broken furniture",
    "Broken furniture",
    // Run next step: "broken wardrobe hinge",
    "broken wardrobe hinge",
  ],
  // Run next step: [
  [
    // Run next step: "Петно / миризма",
    "Петно / миризма",
    // Run next step: "Stain / odor",
    "Stain / odor",
    // Run next step: "Strong mold smell in bath",
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
  // Capture key for use in this scope.
  const key = normalizeIdentityText(label);
  // Branch when this condition holds so the right path runs.
  if (!key) return null;
  // Capture idx for use in this scope.
  const idx = LABEL_TO_GROUP.get(key);
  // Return the computed result to the caller.
  return idx === undefined ? null : idx;
}

/** True when two labels share a curated synonym group. */
export function labelsAreSimilar(a: string, b: string): boolean {
  // Capture ga for use in this scope.
  const ga = synonymGroupForLabel(a);
  // Capture gb for use in this scope.
  const gb = synonymGroupForLabel(b);
  // Return the computed result to the caller.
  return ga !== null && gb !== null && ga === gb;
}
