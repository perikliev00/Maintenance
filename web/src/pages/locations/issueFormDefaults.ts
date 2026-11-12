/**
 * Reset helpers for the Locations board issue-report form.
 * Catalog option defaults drive blocks / priority / title on open.
 */
import type { IssueOptionRow } from "../../api/client";
import { asPriority, type Priority } from "./issues";
import type { BoardLocale } from "./labels";

export type IssueFormDefaults = {
  pickMode: "option" | "custom";
  optionId: string;
  categoryId: string;
  title: string;
  blocksRoom: boolean;
  priority: Priority;
};

/**
 * Build form defaults from the selected (or first) catalog option.
 * Custom mode keeps category and uses safe non-catalog defaults without
 * carrying over a previous report's title/blocks.
 */
export function buildIssueFormDefaults(input: {
  locale: BoardLocale;
  pickMode: "option" | "custom";
  options: IssueOptionRow[];
  optionId: string;
  categoryId: string;
  categoriesFirstId?: string;
}): IssueFormDefaults {
  const {
    locale,
    pickMode,
    options,
    optionId,
    categoryId,
    categoriesFirstId,
  } = input;

  if (pickMode === "custom") {
    return {
      pickMode: "custom",
      optionId,
      categoryId: categoryId || categoriesFirstId || "",
      title: "",
      blocksRoom: false,
      priority: "normal",
    };
  }

  const opt =
    options.find((o) => o.id === optionId) ?? options[0] ?? null;

  if (!opt) {
    return {
      pickMode: "option",
      optionId: "",
      categoryId: categoryId || categoriesFirstId || "",
      title: "",
      blocksRoom: false,
      priority: "normal",
    };
  }

  return {
    pickMode: "option",
    optionId: opt.id,
    categoryId: categoryId || categoriesFirstId || "",
    title: locale === "en" ? opt.nameEn : opt.nameBg,
    blocksRoom: opt.defaultBlocksRoom ?? false,
    priority: asPriority(opt.defaultPriority),
  };
}
