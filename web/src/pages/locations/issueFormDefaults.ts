/**
 * Reset helpers for the Locations board issue-report form.
 * Catalog option defaults drive blocks / priority / title on open.
 */
import type { IssueOptionRow } from "../../api/client";
// Import module dependency from ./issues.
import { asPriority, type Priority } from "./issues";
// Import type-only dependency for typing without runtime cost.
import type { BoardLocale } from "./labels";

// Export type definition for consumers of this module.
export type IssueFormDefaults = {
  // Provide pickMode field used by this structure.
  pickMode: "option" | "custom";
  // Provide optionId field used by this structure.
  optionId: string;
  // Provide categoryId field used by this structure.
  categoryId: string;
  // Provide title field used by this structure.
  title: string;
  // Provide blocksRoom field used by this structure.
  blocksRoom: boolean;
  // Provide priority field used by this structure.
  priority: Priority;
};

/**
 * Build form defaults from the selected (or first) catalog option.
 * Custom mode keeps category and uses safe non-catalog defaults without
 * carrying over a previous report's title/blocks.
 */
export function buildIssueFormDefaults(input: {
  // Provide locale field used by this structure.
  locale: BoardLocale;
  // Provide pickMode field used by this structure.
  pickMode: "option" | "custom";
  // Provide options field used by this structure.
  options: IssueOptionRow[];
  // Provide optionId field used by this structure.
  optionId: string;
  // Provide categoryId field used by this structure.
  categoryId: string;
  // Support the surrounding logic for this step.
  categoriesFirstId?: string;
// Support the surrounding logic for this step.
}): IssueFormDefaults {
  // Bind a local value for the following logic.
  const {
    // Support the surrounding logic for this step.
    locale,
    // Support the surrounding logic for this step.
    pickMode,
    // Support the surrounding logic for this step.
    options,
    // Support the surrounding logic for this step.
    optionId,
    // Support the surrounding logic for this step.
    categoryId,
    // Support the surrounding logic for this step.
    categoriesFirstId,
  // Support the surrounding logic for this step.
  } = input;

  // Conditional branch for the case described by this guard.
  if (pickMode === "custom") {
    // Return early result or rendered output from this path.
    return {
      // Provide pickMode field used by this structure.
      pickMode: "custom",
      // Support the surrounding logic for this step.
      optionId,
      // Provide categoryId field used by this structure.
      categoryId: categoryId || categoriesFirstId || "",
      // Provide title field used by this structure.
      title: "",
      // Provide blocksRoom field used by this structure.
      blocksRoom: false,
      // Provide priority field used by this structure.
      priority: "normal",
    };
  }

  // Bind opt for use in the following logic.
  const opt =
    // Invoke options.find to perform this step.
    options.find((o) => o.id === optionId) ?? options[0] ?? null;

  // Conditional branch for the case described by this guard.
  if (!opt) {
    // Return early result or rendered output from this path.
    return {
      // Provide pickMode field used by this structure.
      pickMode: "option",
      // Provide optionId field used by this structure.
      optionId: "",
      // Provide categoryId field used by this structure.
      categoryId: categoryId || categoriesFirstId || "",
      // Provide title field used by this structure.
      title: "",
      // Provide blocksRoom field used by this structure.
      blocksRoom: false,
      // Provide priority field used by this structure.
      priority: "normal",
    };
  }

  // Return early result or rendered output from this path.
  return {
    // Provide pickMode field used by this structure.
    pickMode: "option",
    // Provide optionId field used by this structure.
    optionId: opt.id,
    // Provide categoryId field used by this structure.
    categoryId: categoryId || categoriesFirstId || "",
    // Provide title field used by this structure.
    title: locale === "en" ? opt.nameEn : opt.nameBg,
    // Provide blocksRoom field used by this structure.
    blocksRoom: opt.defaultBlocksRoom ?? false,
    // Provide priority field used by this structure.
    priority: asPriority(opt.defaultPriority),
  };
}
