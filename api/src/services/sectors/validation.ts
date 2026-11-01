/**
 * Shared sector field normalization and validation (create + update).
 * Always normalize first, then reject empty / over-length values.
 */
import { AppError } from "../../errors";

const CODE_MAX = 32;
const NAME_MAX = 120;

export type SectorNormalizedFields = {
  code?: string;
  nameBg?: string;
  nameEn?: string;
};

/** Trim + uppercase code; trim names. Omits undefined inputs. */
export function normalizeSectorFields(input: {
  code?: string;
  nameBg?: string;
  nameEn?: string;
}): SectorNormalizedFields {
  const out: SectorNormalizedFields = {};
  if (input.code !== undefined) {
    out.code = input.code.trim().toUpperCase();
  }
  if (input.nameBg !== undefined) {
    out.nameBg = input.nameBg.trim();
  }
  if (input.nameEn !== undefined) {
    out.nameEn = input.nameEn.trim();
  }
  return out;
}

/**
 * Reject blank or over-long normalized fields.
 * `required` forces presence checks (create); updates only validate provided keys.
 */
export function assertValidSectorFields(
  fields: SectorNormalizedFields,
  opts: { requireAll?: boolean } = {},
): void {
  const requireAll = opts.requireAll === true;

  if (requireAll || fields.code !== undefined) {
    if (!fields.code) {
      throw new AppError(400, "validation", "code is required");
    }
    if (fields.code.length > CODE_MAX) {
      throw new AppError(400, "validation", `code must be at most ${CODE_MAX} characters`);
    }
  }
  if (requireAll || fields.nameBg !== undefined) {
    if (!fields.nameBg) {
      throw new AppError(400, "validation", "nameBg is required");
    }
    if (fields.nameBg.length > NAME_MAX) {
      throw new AppError(
        400,
        "validation",
        `nameBg must be at most ${NAME_MAX} characters`,
      );
    }
  }
  if (requireAll || fields.nameEn !== undefined) {
    if (!fields.nameEn) {
      throw new AppError(400, "validation", "nameEn is required");
    }
    if (fields.nameEn.length > NAME_MAX) {
      throw new AppError(
        400,
        "validation",
        `nameEn must be at most ${NAME_MAX} characters`,
      );
    }
  }
}

/** Deduplicate location ids while preserving first-seen order. */
export function normalizeLocationIds(locationIds: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of locationIds) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
