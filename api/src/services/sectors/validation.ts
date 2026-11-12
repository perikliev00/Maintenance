/**
 * Shared sector field normalization and validation (create + update).
 * Always normalize first, then reject empty / over-length values.
 */
import { AppError } from "../../errors";

// Capture code max for use in this scope.
const CODE_MAX = 32;
// Capture name max for use in this scope.
const NAME_MAX = 120;

// Declare type SectorNormalizedFields for callers and internals.
export type SectorNormalizedFields = {
  // Run next step: code?: string;
  code?: string;
  // Run next step: nameBg?: string;
  nameBg?: string;
  // Run next step: nameEn?: string;
  nameEn?: string;
};

/** Trim + uppercase code; trim names. Omits undefined inputs. */
export function normalizeSectorFields(input: {
  // Run next step: code?: string;
  code?: string;
  // Run next step: nameBg?: string;
  nameBg?: string;
  // Run next step: nameEn?: string;
  nameEn?: string;
// Run next step: }): SectorNormalizedFields {
}): SectorNormalizedFields {
  // Capture out for use in this scope.
  const out: SectorNormalizedFields = {};
  // Branch when this condition holds so the right path runs.
  if (input.code !== undefined) {
    // Run next step: out.code = input.code.trim().toUpperCase();
    out.code = input.code.trim().toUpperCase();
  }
  // Branch when this condition holds so the right path runs.
  if (input.nameBg !== undefined) {
    // Run next step: out.nameBg = input.nameBg.trim();
    out.nameBg = input.nameBg.trim();
  }
  // Branch when this condition holds so the right path runs.
  if (input.nameEn !== undefined) {
    // Run next step: out.nameEn = input.nameEn.trim();
    out.nameEn = input.nameEn.trim();
  }
  // Return the computed result to the caller.
  return out;
}

/**
 * Reject blank or over-long normalized fields.
 * `required` forces presence checks (create); updates only validate provided keys.
 */
export function assertValidSectorFields(
  // Set fields on the structure being built.
  fields: SectorNormalizedFields,
  // Set opts on the structure being built.
  opts: { requireAll?: boolean } = {},
// Run next step: ): void {
): void {
  // Capture require all for use in this scope.
  const requireAll = opts.requireAll === true;

  // Branch when this condition holds so the right path runs.
  if (requireAll || fields.code !== undefined) {
    // Branch when this condition holds so the right path runs.
    if (!fields.code) {
      // Abort with an error so callers can react.
      throw new AppError(400, "validation", "code is required");
    }
    // Branch when this condition holds so the right path runs.
    if (fields.code.length > CODE_MAX) {
      // Abort with an error so callers can react.
      throw new AppError(400, "validation", `code must be at most ${CODE_MAX} characters`);
    }
  }
  // Branch when this condition holds so the right path runs.
  if (requireAll || fields.nameBg !== undefined) {
    // Branch when this condition holds so the right path runs.
    if (!fields.nameBg) {
      // Abort with an error so callers can react.
      throw new AppError(400, "validation", "nameBg is required");
    }
    // Branch when this condition holds so the right path runs.
    if (fields.nameBg.length > NAME_MAX) {
      // Abort with an error so callers can react.
      throw new AppError(
        // Run next step: 400,
        400,
        // Run next step: "validation",
        "validation",
        // Run next step: `nameBg must be at most ${NAME_MAX} characters`,
        `nameBg must be at most ${NAME_MAX} characters`,
      );
    }
  }
  // Branch when this condition holds so the right path runs.
  if (requireAll || fields.nameEn !== undefined) {
    // Branch when this condition holds so the right path runs.
    if (!fields.nameEn) {
      // Abort with an error so callers can react.
      throw new AppError(400, "validation", "nameEn is required");
    }
    // Branch when this condition holds so the right path runs.
    if (fields.nameEn.length > NAME_MAX) {
      // Abort with an error so callers can react.
      throw new AppError(
        // Run next step: 400,
        400,
        // Run next step: "validation",
        "validation",
        // Run next step: `nameEn must be at most ${NAME_MAX} characters`,
        `nameEn must be at most ${NAME_MAX} characters`,
      );
    }
  }
}

/** Deduplicate location ids while preserving first-seen order. */
export function normalizeLocationIds(locationIds: string[]): string[] {
  // Capture seen for use in this scope.
  const seen = new Set<string>();
  // Capture out for use in this scope.
  const out: string[] = [];
  // Iterate items to apply the same logic to each entry.
  for (const raw of locationIds) {
    // Capture id for use in this scope.
    const id = typeof raw === "string" ? raw.trim() : "";
    // Branch when this condition holds so the right path runs.
    if (!id || seen.has(id)) continue;
    // Run next step: seen.add(id);
    seen.add(id);
    // Append an entry to the accumulating collection.
    out.push(id);
  }
  // Return the computed result to the caller.
  return out;
}
