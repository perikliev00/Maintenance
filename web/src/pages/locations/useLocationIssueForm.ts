/**
 * Issue-report form state + maintenance catalog load for the Locations board.
 * Overlay exclusivity for detail/reassign/repairs is coordinated via
 * `clearOtherOverlays` (page wires a ref to the board hook).
 */
import { useCallback, useEffect, useState } from "react";
import {
  fetchIssueOptions,
  fetchMaintenanceCategories,
  type IssueOptionRow,
  type MaintenanceCategoryRow,
} from "../../api/client";
import { asPriority, type Priority } from "./issues";
import { buildIssueFormDefaults } from "./issueFormDefaults";
import { boardT, type BoardLocale } from "./labels";

export type UseLocationIssueFormOptions = {
  locale: BoardLocale;
  /** Clear detail / reassign / repairs before opening the issue dialog. */
  clearOtherOverlays: () => void;
};

export type UseLocationIssueFormResult = {
  issueLocationId: string | null;
  catalogError: string | null;
  issueCategories: MaintenanceCategoryRow[];
  issueOptions: IssueOptionRow[];
  issuePickMode: "option" | "custom";
  issueOptionId: string;
  issueCategoryId: string;
  issueTitle: string;
  issueBlocks: boolean;
  issuePriority: Priority;
  setIssuePickMode: (mode: "option" | "custom") => void;
  setIssueOptionId: (id: string) => void;
  setIssueCategoryId: (id: string) => void;
  setIssueTitle: (title: string) => void;
  setIssueBlocks: (blocks: boolean) => void;
  setIssuePriority: (priority: Priority) => void;
  applyIssueDefaults: (
    pickMode: "option" | "custom",
    options: IssueOptionRow[],
    optionId: string,
    categoryId: string,
    categories: MaintenanceCategoryRow[],
  ) => void;
  /** Close issue overlay only (used when opening detail/reassign/repairs). */
  closeIssue: () => void;
  openIssue: (id: string | null) => void;
  openIssueForLocation: (locationId: string) => void;
  onPickModeChange: (mode: "option" | "custom") => void;
  onOptionIdChange: (id: string, opt: IssueOptionRow | undefined) => void;
  onCancelIssue: () => void;
};

export function useLocationIssueForm({
  locale,
  clearOtherOverlays,
}: UseLocationIssueFormOptions): UseLocationIssueFormResult {
  const [issueLocationId, setIssueLocationId] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [issueCategories, setIssueCategories] = useState<
    MaintenanceCategoryRow[]
  >([]);
  const [issueOptions, setIssueOptions] = useState<IssueOptionRow[]>([]);
  const [issuePickMode, setIssuePickMode] = useState<"option" | "custom">(
    "option",
  );
  const [issueOptionId, setIssueOptionId] = useState("");
  const [issueCategoryId, setIssueCategoryId] = useState("");
  const [issueTitle, setIssueTitle] = useState("");
  const [issueBlocks, setIssueBlocks] = useState(false);
  const [issuePriority, setIssuePriority] = useState<Priority>("normal");

  const applyIssueDefaults = useCallback(
    (
      pickMode: "option" | "custom",
      options: IssueOptionRow[],
      optionId: string,
      categoryId: string,
      categories: MaintenanceCategoryRow[],
    ) => {
      const defaults = buildIssueFormDefaults({
        locale,
        pickMode,
        options,
        optionId,
        categoryId,
        categoriesFirstId: categories[0]?.id,
      });
      setIssuePickMode(defaults.pickMode);
      setIssueOptionId(defaults.optionId);
      setIssueCategoryId(defaults.categoryId);
      setIssueTitle(defaults.title);
      setIssueBlocks(defaults.blocksRoom);
      setIssuePriority(defaults.priority);
    },
    [locale],
  );

  const closeIssue = useCallback(() => {
    setIssueLocationId(null);
  }, []);

  const openIssue = useCallback(
    (id: string | null) => {
      if (id !== null) clearOtherOverlays();
      setIssueLocationId(id);
    },
    [clearOtherOverlays],
  );

  const openIssueForLocation = useCallback(
    (locationId: string) => {
      applyIssueDefaults(
        issuePickMode,
        issueOptions,
        issueOptionId,
        issueCategoryId,
        issueCategories,
      );
      openIssue(locationId);
    },
    [
      applyIssueDefaults,
      issuePickMode,
      issueOptions,
      issueOptionId,
      issueCategoryId,
      issueCategories,
      openIssue,
    ],
  );

  const onPickModeChange = useCallback(
    (mode: "option" | "custom") => {
      setIssuePickMode(mode);
      applyIssueDefaults(
        mode,
        issueOptions,
        issueOptionId,
        issueCategoryId,
        issueCategories,
      );
    },
    [
      applyIssueDefaults,
      issueOptions,
      issueOptionId,
      issueCategoryId,
      issueCategories,
    ],
  );

  const onOptionIdChange = useCallback(
    (id: string, opt: IssueOptionRow | undefined) => {
      setIssueOptionId(id);
      if (opt) {
        setIssueTitle(locale === "en" ? opt.nameEn : opt.nameBg);
        setIssueBlocks(opt.defaultBlocksRoom ?? false);
        setIssuePriority(asPriority(opt.defaultPriority));
      }
    },
    [locale],
  );

  const onCancelIssue = useCallback(() => {
    setIssueTitle("");
    openIssue(null);
  }, [openIssue]);

  // Catalog load is independent of the board list (own abort on unmount/remount).
  useEffect(() => {
    const ac = new AbortController();
    const { signal } = ac;
    (async () => {
      try {
        setCatalogError(null);
        const [cats, opts] = await Promise.all([
          fetchMaintenanceCategories({ signal }),
          fetchIssueOptions({ signal }),
        ]);
        if (signal.aborted) return;
        setIssueCategories(cats);
        setIssueOptions(opts);
        if (opts[0] || cats[0]) {
          applyIssueDefaults(
            "option",
            opts,
            opts[0]?.id ?? "",
            cats[0]?.id ?? "",
            cats,
          );
        }
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setCatalogError(
          err instanceof Error
            ? err.message
            : boardT(
                locale,
                "Неуспешно зареждане на каталога за проблеми",
                "Failed to load the issue catalog",
              ),
        );
      }
    })();
    return () => ac.abort();
  }, [applyIssueDefaults, locale]);

  return {
    issueLocationId,
    catalogError,
    issueCategories,
    issueOptions,
    issuePickMode,
    issueOptionId,
    issueCategoryId,
    issueTitle,
    issueBlocks,
    issuePriority,
    setIssuePickMode,
    setIssueOptionId,
    setIssueCategoryId,
    setIssueTitle,
    setIssueBlocks,
    setIssuePriority,
    applyIssueDefaults,
    closeIssue,
    openIssue,
    openIssueForLocation,
    onPickModeChange,
    onOptionIdChange,
    onCancelIssue,
  };
}
