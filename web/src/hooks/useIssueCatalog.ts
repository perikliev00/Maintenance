// Import dependency used by this module.
import {
  // List item in import/export/params.
  DragEvent,
  // List item in import/export/params.
  FormEvent,
  // List item in import/export/params.
  useCallback,
  // List item in import/export/params.
  useEffect,
  // List item in import/export/params.
  useRef,
  // List item in import/export/params.
  useState,
// Close multi-line construct with trailing syntax.
} from "react";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  createIssueOption,
  // List item in import/export/params.
  createMaintenanceCategory,
  // List item in import/export/params.
  fetchIssueOptions,
  // List item in import/export/params.
  fetchMaintenanceCategories,
  // List item in import/export/params.
  reorderIssueOptions,
  // Local type alias shaping data.
  type IssueOptionRow,
  // Local type alias shaping data.
  type MaintenanceCategoryRow,
// Close multi-line construct with trailing syntax.
} from "../api/client";
// Import dependency used by this module.
import { useBusyMutation } from "./useBusyMutation";
// Import dependency used by this module.
import { labelFor } from "../i18n";

// Local type alias shaping data.
type UseIssueCatalogParams = {
  // Field/property in this shape.
  locale: "bg" | "en";
};

// Exported function entry point.
export function useIssueCatalog({ locale }: UseIssueCatalogParams) {
  // Local constant binding.
  const label = labelFor(locale);
  // Assign value for subsequent use.
  const [subTab, setSubTab] = useState<"options" | "categories">("options");
  // Assign value for subsequent use.
  const [categories, setCategories] = useState<MaintenanceCategoryRow[]>([]);
  // Assign value for subsequent use.
  const [options, setOptions] = useState<IssueOptionRow[]>([]);
  // Assign value for subsequent use.
  const [loading, setLoading] = useState(true);
  // Assign value for subsequent use.
  const [error, setError] = useState<string | null>(null);
  // Assign value for subsequent use.
  const [message, setMessage] = useState<string | null>(null);
  // Assign value for subsequent use.
  const { busy: mutationBusy, runMutationWithRefresh } = useBusyMutation();
  // Assign value for subsequent use.
  const [reorderBusy, setReorderBusy] = useState(false);
  // Local constant binding.
  const busy = mutationBusy || reorderBusy;
  // Assign value for subsequent use.
  const [dragId, setDragId] = useState<string | null>(null);
  // Assign value for subsequent use.
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // Local constant binding.
  const dragIdRef = useRef<string | null>(null);

  // Assign value for subsequent use.
  const [catKey, setCatKey] = useState("");
  // Assign value for subsequent use.
  const [catNameBg, setCatNameBg] = useState("");
  // Assign value for subsequent use.
  const [catNameEn, setCatNameEn] = useState("");

  // Assign value for subsequent use.
  const [optCategoryId, setOptCategoryId] = useState("");
  // Assign value for subsequent use.
  const [optKind, setOptKind] = useState<"maintenance" | "housekeeping">(
    // Continue multi-line list/arguments.
    "maintenance",
  );
  // Assign value for subsequent use.
  const [optNameBg, setOptNameBg] = useState("");
  // Assign value for subsequent use.
  const [optNameEn, setOptNameEn] = useState("");
  // Assign value for subsequent use.
  const [optDefaultPriority, setOptDefaultPriority] = useState("");
  // Assign value for subsequent use.
  const [optDefaultBlocks, setOptDefaultBlocks] = useState<boolean | "">("");

  // Local constant binding.
  const refresh = useCallback(async () => {
    // Assign value for subsequent use.
    const [cats, opts] = await Promise.all([
      // Invoke helper or pass arguments.
      fetchMaintenanceCategories({ includeInactive: true }),
      // Invoke helper or pass arguments.
      fetchIssueOptions({ includeInactive: true }),
    ]);
    // Invoke helper or pass arguments.
    setCategories(cats);
    // Invoke helper or pass arguments.
    setOptions(opts);
    // Conditional branch for this case.
    if (!optCategoryId && cats[0]) setOptCategoryId(cats[0].id);
  // Close multi-line construct with trailing syntax.
  }, [optCategoryId]);

  // Arrow function / callback body.
  useEffect(() => {
    // Arrow function / callback body.
    (async () => {
      // Guard fallible work.
      try {
        // Invoke helper or pass arguments.
        setLoading(true);
        // Await async work before continuing.
        await refresh();
      // Invoke helper or pass arguments.
      } catch (err) {
        // Invoke helper or pass arguments.
        setError(err instanceof Error ? err.message : "Load failed");
      // Open multi-line construct.
      } finally {
        // Invoke helper or pass arguments.
        setLoading(false);
      }
    // Invoke helper or pass arguments.
    })();
  // Close multi-line construct with trailing syntax.
  }, [refresh]);

  // Function definition.
  async function run(action: () => Promise<unknown>) {
    // Invoke helper or pass arguments.
    setError(null);
    // Invoke helper or pass arguments.
    setMessage(null);
    // Local constant binding.
    const result = await runMutationWithRefresh(action, refresh);
    // Conditional branch for this case.
    if (!result.ok) {
      // Conditional branch for this case.
      if (result.error !== "busy") setError(result.error);
      // Return computed result to caller.
      return;
    }
    // Invoke helper or pass arguments.
    setMessage(label("Запазено", "Saved"));
    // Conditional branch for this case.
    if (result.outcome === "saved_refresh_failed") {
      // Local constant binding.
      const refreshPrefix = label(
        // Continue multi-line list/arguments.
        "Записът е успешен, но обновяването се провали",
        // Continue multi-line list/arguments.
        "Saved, but refresh failed",
      );
      // Open multi-line construct.
      setError(
        // Continue module logic.
        result.refreshError
          // Continue module logic.
          ? `${refreshPrefix}: ${result.refreshError}`
          // Continue multi-line list/arguments.
          : refreshPrefix,
      );
    }
  }

  // Function definition.
  async function onAddCategory(e: FormEvent) {
    // Invoke helper or pass arguments.
    e.preventDefault();
    // Await async work before continuing.
    await run(async () => {
      // Await async work before continuing.
      await createMaintenanceCategory({
        // Field/property in this shape.
        key: catKey,
        // Field/property in this shape.
        nameBg: catNameBg,
        // Field/property in this shape.
        nameEn: catNameEn,
      });
      // Invoke helper or pass arguments.
      setCatKey("");
      // Invoke helper or pass arguments.
      setCatNameBg("");
      // Invoke helper or pass arguments.
      setCatNameEn("");
    });
  }

  // Function definition.
  async function onAddOption(e: FormEvent) {
    // Invoke helper or pass arguments.
    e.preventDefault();
    // Conditional branch for this case.
    if (!optCategoryId) return;
    // Await async work before continuing.
    await run(async () => {
      // Await async work before continuing.
      await createIssueOption({
        // Field/property in this shape.
        maintenanceCategoryId: optCategoryId,
        // Field/property in this shape.
        kind: optKind,
        // Field/property in this shape.
        nameBg: optNameBg,
        // Field/property in this shape.
        nameEn: optNameEn,
        // Field/property in this shape.
        defaultPriority: optDefaultPriority || undefined,
        // Field/property in this shape.
        defaultBlocksRoom:
          // Assign value for subsequent use.
          optDefaultBlocks === "" ? undefined : optDefaultBlocks,
      });
      // Invoke helper or pass arguments.
      setOptNameBg("");
      // Invoke helper or pass arguments.
      setOptNameEn("");
      // Invoke helper or pass arguments.
      setOptDefaultPriority("");
      // Invoke helper or pass arguments.
      setOptDefaultBlocks("");
    });
  }

  // Function definition.
  async function persistOrder(ids: string[]) {
    // Local constant binding.
    const previous = options;
    // Open multi-line construct.
    setOptions(
      // Identifier continuation in list.
      ids
        // Arrow function / callback body.
        .map((id) => previous.find((o) => o.id === id))
        // Arrow function / callback body.
        .filter((o): o is IssueOptionRow => Boolean(o)),
    );
    // Invoke helper or pass arguments.
    setReorderBusy(true);
    // Invoke helper or pass arguments.
    setError(null);
    // Invoke helper or pass arguments.
    setMessage(null);
    // Guard fallible work.
    try {
      // Local constant binding.
      const next = await reorderIssueOptions(ids);
      // Invoke helper or pass arguments.
      setOptions(next);
      // Invoke helper or pass arguments.
      setMessage(label("Запазено", "Saved"));
    // Invoke helper or pass arguments.
    } catch (err) {
      // Invoke helper or pass arguments.
      setOptions(previous);
      // Invoke helper or pass arguments.
      setError(err instanceof Error ? err.message : "Action failed");
    // Open multi-line construct.
    } finally {
      // Invoke helper or pass arguments.
      setReorderBusy(false);
    }
  }

  // Function definition.
  async function moveOption(id: string, dir: -1 | 1) {
    // Local constant binding.
    const idx = options.findIndex((o) => o.id === id);
    // Conditional branch for this case.
    if (idx < 0) return;
    // Local constant binding.
    const next = idx + dir;
    // Conditional branch for this case.
    if (next < 0 || next >= options.length) return;
    // Local constant binding.
    const ids = options.map((o) => o.id);
    // Assign value for subsequent use.
    [ids[idx], ids[next]] = [ids[next], ids[idx]];
    // Await async work before continuing.
    await persistOrder(ids);
  }

  // Function definition.
  function onDragStart(e: DragEvent, id: string) {
    // Conditional branch for this case.
    if (busy) {
      // Invoke helper or pass arguments.
      e.preventDefault();
      // Return computed result to caller.
      return;
    }
    // Assign value for subsequent use.
    dragIdRef.current = id;
    // Invoke helper or pass arguments.
    setDragId(id);
    // Assign value for subsequent use.
    e.dataTransfer.effectAllowed = "move";
    // Invoke helper or pass arguments.
    e.dataTransfer.setData("text/plain", id);
  }

  // Function definition.
  function onDragOver(e: DragEvent, id: string) {
    // Invoke helper or pass arguments.
    e.preventDefault();
    // Assign value for subsequent use.
    e.dataTransfer.dropEffect = "move";
    // Conditional branch for this case.
    if (dropTargetId !== id) setDropTargetId(id);
  }

  // Function definition.
  function onDragLeave(id: string) {
    // Conditional branch for this case.
    if (dropTargetId === id) setDropTargetId(null);
  }

  // Function definition.
  async function onDrop(e: DragEvent, targetId: string) {
    // Invoke helper or pass arguments.
    e.preventDefault();
    // Local constant binding.
    const sourceId = dragIdRef.current ?? e.dataTransfer.getData("text/plain");
    // Invoke helper or pass arguments.
    setDragId(null);
    // Invoke helper or pass arguments.
    setDropTargetId(null);
    // Assign value for subsequent use.
    dragIdRef.current = null;
    // Conditional branch for this case.
    if (!sourceId || sourceId === targetId || busy) return;
    // Local constant binding.
    const from = options.findIndex((o) => o.id === sourceId);
    // Local constant binding.
    const to = options.findIndex((o) => o.id === targetId);
    // Conditional branch for this case.
    if (from < 0 || to < 0) return;
    // Local constant binding.
    const ids = options.map((o) => o.id);
    // Invoke helper or pass arguments.
    ids.splice(from, 1);
    // Invoke helper or pass arguments.
    ids.splice(to, 0, sourceId);
    // Await async work before continuing.
    await persistOrder(ids);
  }

  // Function definition.
  function onDragEnd() {
    // Invoke helper or pass arguments.
    setDragId(null);
    // Invoke helper or pass arguments.
    setDropTargetId(null);
    // Assign value for subsequent use.
    dragIdRef.current = null;
  }

  // Const arrow/function binding.
  const catName = (c: MaintenanceCategoryRow) =>
    // Assign value for subsequent use.
    locale === "bg" ? c.nameBg : c.nameEn;

  // Return computed result to caller.
  return {
    // List item in import/export/params.
    label,
    // List item in import/export/params.
    locale,
    // List item in import/export/params.
    subTab,
    // List item in import/export/params.
    setSubTab,
    // List item in import/export/params.
    categories,
    // List item in import/export/params.
    options,
    // List item in import/export/params.
    loading,
    // List item in import/export/params.
    error,
    // List item in import/export/params.
    message,
    // List item in import/export/params.
    busy,
    // List item in import/export/params.
    dragId,
    // List item in import/export/params.
    dropTargetId,
    // List item in import/export/params.
    catKey,
    // List item in import/export/params.
    setCatKey,
    // List item in import/export/params.
    catNameBg,
    // List item in import/export/params.
    setCatNameBg,
    // List item in import/export/params.
    catNameEn,
    // List item in import/export/params.
    setCatNameEn,
    // List item in import/export/params.
    optCategoryId,
    // List item in import/export/params.
    setOptCategoryId,
    // List item in import/export/params.
    optKind,
    // List item in import/export/params.
    setOptKind,
    // List item in import/export/params.
    optNameBg,
    // List item in import/export/params.
    setOptNameBg,
    // List item in import/export/params.
    optNameEn,
    // List item in import/export/params.
    setOptNameEn,
    // List item in import/export/params.
    optDefaultPriority,
    // List item in import/export/params.
    setOptDefaultPriority,
    // List item in import/export/params.
    optDefaultBlocks,
    // List item in import/export/params.
    setOptDefaultBlocks,
    // List item in import/export/params.
    run,
    // List item in import/export/params.
    onAddCategory,
    // List item in import/export/params.
    onAddOption,
    // List item in import/export/params.
    moveOption,
    // List item in import/export/params.
    onDragStart,
    // List item in import/export/params.
    onDragOver,
    // List item in import/export/params.
    onDragLeave,
    // List item in import/export/params.
    onDrop,
    // List item in import/export/params.
    onDragEnd,
    // List item in import/export/params.
    catName,
  };
}
