/**
 * Issue-report form state + maintenance catalog load for the Locations board.
 * Overlay exclusivity for detail/reassign/repairs is coordinated via
 * `clearOtherOverlays` (page wires a ref to the board hook).
 */
import { useCallback, useEffect, useState } from "react";
// Import module dependency used by this file.
import {
  // Support the surrounding logic for this step.
  fetchIssueOptions,
  // Support the surrounding logic for this step.
  fetchMaintenanceCategories,
  // Declare type alias IssueOptionRow.
  type IssueOptionRow,
  // Declare type alias MaintenanceCategoryRow.
  type MaintenanceCategoryRow,
// Support the surrounding logic for this step.
} from "../../api/client";
// Import module dependency from ./issues.
import { asPriority, type Priority } from "./issues";
// Import module dependency from ./issueFormDefaults.
import { buildIssueFormDefaults } from "./issueFormDefaults";
// Import module dependency from ./labels.
import { boardT, type BoardLocale } from "./labels";

// Export type definition for consumers of this module.
export type UseLocationIssueFormOptions = {
  // Provide locale field used by this structure.
  locale: BoardLocale;
  /** Clear detail / reassign / repairs before opening the issue dialog. */
  clearOtherOverlays: () => void;
};

// Export type definition for consumers of this module.
export type UseLocationIssueFormResult = {
  // Provide issueLocationId field used by this structure.
  issueLocationId: string | null;
  // Provide catalogError field used by this structure.
  catalogError: string | null;
  // Provide issueCategories field used by this structure.
  issueCategories: MaintenanceCategoryRow[];
  // Provide issueOptions field used by this structure.
  issueOptions: IssueOptionRow[];
  // Provide issuePickMode field used by this structure.
  issuePickMode: "option" | "custom";
  // Provide issueOptionId field used by this structure.
  issueOptionId: string;
  // Provide issueCategoryId field used by this structure.
  issueCategoryId: string;
  // Provide issueTitle field used by this structure.
  issueTitle: string;
  // Provide issueBlocks field used by this structure.
  issueBlocks: boolean;
  // Provide issuePriority field used by this structure.
  issuePriority: Priority;
  // Provide setIssuePickMode field used by this structure.
  setIssuePickMode: (mode: "option" | "custom") => void;
  // Provide setIssueOptionId field used by this structure.
  setIssueOptionId: (id: string) => void;
  // Provide setIssueCategoryId field used by this structure.
  setIssueCategoryId: (id: string) => void;
  // Provide setIssueTitle field used by this structure.
  setIssueTitle: (title: string) => void;
  // Provide setIssueBlocks field used by this structure.
  setIssueBlocks: (blocks: boolean) => void;
  // Provide setIssuePriority field used by this structure.
  setIssuePriority: (priority: Priority) => void;
  // Provide applyIssueDefaults field used by this structure.
  applyIssueDefaults: (
    // Provide pickMode field used by this structure.
    pickMode: "option" | "custom",
    // Provide options field used by this structure.
    options: IssueOptionRow[],
    // Provide optionId field used by this structure.
    optionId: string,
    // Provide categoryId field used by this structure.
    categoryId: string,
    // Provide categories field used by this structure.
    categories: MaintenanceCategoryRow[],
  // Support the surrounding logic for this step.
  ) => void;
  /** Close issue overlay only (used when opening detail/reassign/repairs). */
  closeIssue: () => void;
  // Provide openIssue field used by this structure.
  openIssue: (id: string | null) => void;
  // Provide openIssueForLocation field used by this structure.
  openIssueForLocation: (locationId: string) => void;
  // Provide onPickModeChange field used by this structure.
  onPickModeChange: (mode: "option" | "custom") => void;
  // Provide onOptionIdChange field used by this structure.
  onOptionIdChange: (id: string, opt: IssueOptionRow | undefined) => void;
  // Provide onCancelIssue field used by this structure.
  onCancelIssue: () => void;
};

// Export function useLocationIssueForm as part of this module's API.
export function useLocationIssueForm({
  // Support the surrounding logic for this step.
  locale,
  // Support the surrounding logic for this step.
  clearOtherOverlays,
// Support the surrounding logic for this step.
}: UseLocationIssueFormOptions): UseLocationIssueFormResult {
  // React state slot for local UI/data that can change over time.
  const [issueLocationId, setIssueLocationId] = useState<string | null>(null);
  // React state slot for local UI/data that can change over time.
  const [catalogError, setCatalogError] = useState<string | null>(null);
  // React state slot for local UI/data that can change over time.
  const [issueCategories, setIssueCategories] = useState<
    // Support the surrounding logic for this step.
    MaintenanceCategoryRow[]
  // Support the surrounding logic for this step.
  >([]);
  // React state slot for local UI/data that can change over time.
  const [issueOptions, setIssueOptions] = useState<IssueOptionRow[]>([]);
  // React state slot for local UI/data that can change over time.
  const [issuePickMode, setIssuePickMode] = useState<"option" | "custom">(
    // Support the surrounding logic for this step.
    "option",
  );
  // React state slot for local UI/data that can change over time.
  const [issueOptionId, setIssueOptionId] = useState("");
  // React state slot for local UI/data that can change over time.
  const [issueCategoryId, setIssueCategoryId] = useState("");
  // React state slot for local UI/data that can change over time.
  const [issueTitle, setIssueTitle] = useState("");
  // React state slot for local UI/data that can change over time.
  const [issueBlocks, setIssueBlocks] = useState(false);
  // React state slot for local UI/data that can change over time.
  const [issuePriority, setIssuePriority] = useState<Priority>("normal");

  // Memoize callback identity for stable child/effect deps.
  const applyIssueDefaults = useCallback(
    (
      // Provide pickMode field used by this structure.
      pickMode: "option" | "custom",
      // Provide options field used by this structure.
      options: IssueOptionRow[],
      // Provide optionId field used by this structure.
      optionId: string,
      // Provide categoryId field used by this structure.
      categoryId: string,
      // Provide categories field used by this structure.
      categories: MaintenanceCategoryRow[],
    // Support the surrounding logic for this step.
    ) => {
      // Bind defaults for use in the following logic.
      const defaults = buildIssueFormDefaults({
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
        // Provide categoriesFirstId field used by this structure.
        categoriesFirstId: categories[0]?.id,
      });
      // Update React state so the UI reflects the new value.
      setIssuePickMode(defaults.pickMode);
      // Update React state so the UI reflects the new value.
      setIssueOptionId(defaults.optionId);
      // Update React state so the UI reflects the new value.
      setIssueCategoryId(defaults.categoryId);
      // Update React state so the UI reflects the new value.
      setIssueTitle(defaults.title);
      // Update React state so the UI reflects the new value.
      setIssueBlocks(defaults.blocksRoom);
      // Update React state so the UI reflects the new value.
      setIssuePriority(defaults.priority);
    },
    // Support the surrounding logic for this step.
    [locale],
  );

  // Memoize callback identity for stable child/effect deps.
  const closeIssue = useCallback(() => {
    // Update React state so the UI reflects the new value.
    setIssueLocationId(null);
  // Support the surrounding logic for this step.
  }, []);

  // Memoize callback identity for stable child/effect deps.
  const openIssue = useCallback(
    // Support the surrounding logic for this step.
    (id: string | null) => {
      // Conditional branch for the case described by this guard.
      if (id !== null) clearOtherOverlays();
      // Update React state so the UI reflects the new value.
      setIssueLocationId(id);
    },
    // Support the surrounding logic for this step.
    [clearOtherOverlays],
  );

  // Memoize callback identity for stable child/effect deps.
  const openIssueForLocation = useCallback(
    // Support the surrounding logic for this step.
    (locationId: string) => {
      // Invoke applyIssueDefaults to perform this step.
      applyIssueDefaults(
        // Support the surrounding logic for this step.
        issuePickMode,
        // Support the surrounding logic for this step.
        issueOptions,
        // Support the surrounding logic for this step.
        issueOptionId,
        // Support the surrounding logic for this step.
        issueCategoryId,
        // Support the surrounding logic for this step.
        issueCategories,
      );
      // Invoke openIssue to perform this step.
      openIssue(locationId);
    },
    [
      // Support the surrounding logic for this step.
      applyIssueDefaults,
      // Support the surrounding logic for this step.
      issuePickMode,
      // Support the surrounding logic for this step.
      issueOptions,
      // Support the surrounding logic for this step.
      issueOptionId,
      // Support the surrounding logic for this step.
      issueCategoryId,
      // Support the surrounding logic for this step.
      issueCategories,
      // Support the surrounding logic for this step.
      openIssue,
    ],
  );

  // Memoize callback identity for stable child/effect deps.
  const onPickModeChange = useCallback(
    // Support the surrounding logic for this step.
    (mode: "option" | "custom") => {
      // Update React state so the UI reflects the new value.
      setIssuePickMode(mode);
      // Invoke applyIssueDefaults to perform this step.
      applyIssueDefaults(
        // Support the surrounding logic for this step.
        mode,
        // Support the surrounding logic for this step.
        issueOptions,
        // Support the surrounding logic for this step.
        issueOptionId,
        // Support the surrounding logic for this step.
        issueCategoryId,
        // Support the surrounding logic for this step.
        issueCategories,
      );
    },
    [
      // Support the surrounding logic for this step.
      applyIssueDefaults,
      // Support the surrounding logic for this step.
      issueOptions,
      // Support the surrounding logic for this step.
      issueOptionId,
      // Support the surrounding logic for this step.
      issueCategoryId,
      // Support the surrounding logic for this step.
      issueCategories,
    ],
  );

  // Memoize callback identity for stable child/effect deps.
  const onOptionIdChange = useCallback(
    // Support the surrounding logic for this step.
    (id: string, opt: IssueOptionRow | undefined) => {
      // Update React state so the UI reflects the new value.
      setIssueOptionId(id);
      // Conditional branch for the case described by this guard.
      if (opt) {
        // Update React state so the UI reflects the new value.
        setIssueTitle(locale === "en" ? opt.nameEn : opt.nameBg);
        // Update React state so the UI reflects the new value.
        setIssueBlocks(opt.defaultBlocksRoom ?? false);
        // Update React state so the UI reflects the new value.
        setIssuePriority(asPriority(opt.defaultPriority));
      }
    },
    // Support the surrounding logic for this step.
    [locale],
  );

  // Memoize callback identity for stable child/effect deps.
  const onCancelIssue = useCallback(() => {
    // Update React state so the UI reflects the new value.
    setIssueTitle("");
    // Invoke openIssue to perform this step.
    openIssue(null);
  // Support the surrounding logic for this step.
  }, [openIssue]);

  // Catalog load is independent of the board list (own abort on unmount/remount).
  useEffect(() => {
    // Bind ac for use in the following logic.
    const ac = new AbortController();
    // Bind a local value for the following logic.
    const { signal } = ac;
    // Support the surrounding logic for this step.
    (async () => {
      // Begin guarded block to catch runtime failures.
      try {
        // Update React state so the UI reflects the new value.
        setCatalogError(null);
        // Bind a local value for the following logic.
        const [cats, opts] = await Promise.all([
          // Invoke fetchMaintenanceCategories to perform this step.
          fetchMaintenanceCategories({ signal }),
          // Invoke fetchIssueOptions to perform this step.
          fetchIssueOptions({ signal }),
        // Support the surrounding logic for this step.
        ]);
        // Conditional branch for the case described by this guard.
        if (signal.aborted) return;
        // Update React state so the UI reflects the new value.
        setIssueCategories(cats);
        // Update React state so the UI reflects the new value.
        setIssueOptions(opts);
        // Conditional branch for the case described by this guard.
        if (opts[0] || cats[0]) {
          // Invoke applyIssueDefaults to perform this step.
          applyIssueDefaults(
            // Support the surrounding logic for this step.
            "option",
            // Support the surrounding logic for this step.
            opts,
            // Support the surrounding logic for this step.
            opts[0]?.id ?? "",
            // Support the surrounding logic for this step.
            cats[0]?.id ?? "",
            // Support the surrounding logic for this step.
            cats,
          );
        }
      // Support the surrounding logic for this step.
      } catch (err) {
        // Conditional branch for the case described by this guard.
        if (signal.aborted) return;
        // Conditional branch for the case described by this guard.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Update React state so the UI reflects the new value.
        setCatalogError(
          // Support the surrounding logic for this step.
          err instanceof Error
            // Support the surrounding logic for this step.
            ? err.message
            // Support the surrounding logic for this step.
            : boardT(
                // Support the surrounding logic for this step.
                locale,
                // Support the surrounding logic for this step.
                "Неуспешно зареждане на каталога за проблеми",
                // Support the surrounding logic for this step.
                "Failed to load the issue catalog",
              ),
        );
      }
    // Support the surrounding logic for this step.
    })();
    // Return early result or rendered output from this path.
    return () => ac.abort();
  // Support the surrounding logic for this step.
  }, [applyIssueDefaults, locale]);

  // Return early result or rendered output from this path.
  return {
    // Support the surrounding logic for this step.
    issueLocationId,
    // Support the surrounding logic for this step.
    catalogError,
    // Support the surrounding logic for this step.
    issueCategories,
    // Support the surrounding logic for this step.
    issueOptions,
    // Support the surrounding logic for this step.
    issuePickMode,
    // Support the surrounding logic for this step.
    issueOptionId,
    // Support the surrounding logic for this step.
    issueCategoryId,
    // Support the surrounding logic for this step.
    issueTitle,
    // Support the surrounding logic for this step.
    issueBlocks,
    // Support the surrounding logic for this step.
    issuePriority,
    // Support the surrounding logic for this step.
    setIssuePickMode,
    // Support the surrounding logic for this step.
    setIssueOptionId,
    // Support the surrounding logic for this step.
    setIssueCategoryId,
    // Support the surrounding logic for this step.
    setIssueTitle,
    // Support the surrounding logic for this step.
    setIssueBlocks,
    // Support the surrounding logic for this step.
    setIssuePriority,
    // Support the surrounding logic for this step.
    applyIssueDefaults,
    // Support the surrounding logic for this step.
    closeIssue,
    // Support the surrounding logic for this step.
    openIssue,
    // Support the surrounding logic for this step.
    openIssueForLocation,
    // Support the surrounding logic for this step.
    onPickModeChange,
    // Support the surrounding logic for this step.
    onOptionIdChange,
    // Support the surrounding logic for this step.
    onCancelIssue,
  };
}
