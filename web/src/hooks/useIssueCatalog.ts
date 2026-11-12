import {
  DragEvent,
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  createIssueOption,
  createMaintenanceCategory,
  fetchIssueOptions,
  fetchMaintenanceCategories,
  reorderIssueOptions,
  type IssueOptionRow,
  type MaintenanceCategoryRow,
} from "../api/client";
import { useBusyMutation } from "./useBusyMutation";
import { labelFor } from "../i18n";

type UseIssueCatalogParams = {
  locale: "bg" | "en";
};

// Exported function entry point.
export function useIssueCatalog({ locale }: UseIssueCatalogParams) {
  const label = labelFor(locale);
  const [subTab, setSubTab] = useState<"options" | "categories">("options");
  const [categories, setCategories] = useState<MaintenanceCategoryRow[]>([]);
  const [options, setOptions] = useState<IssueOptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { busy: mutationBusy, runMutationWithRefresh } = useBusyMutation();
  const [reorderBusy, setReorderBusy] = useState(false);
  const busy = mutationBusy || reorderBusy;
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);

  const [catKey, setCatKey] = useState("");
  const [catNameBg, setCatNameBg] = useState("");
  const [catNameEn, setCatNameEn] = useState("");

  const [optCategoryId, setOptCategoryId] = useState("");
  const [optKind, setOptKind] = useState<"maintenance" | "housekeeping">(
    "maintenance",
  );
  const [optNameBg, setOptNameBg] = useState("");
  const [optNameEn, setOptNameEn] = useState("");
  const [optDefaultPriority, setOptDefaultPriority] = useState("");
  const [optDefaultBlocks, setOptDefaultBlocks] = useState<boolean | "">("");

  const refresh = useCallback(async () => {
    const [cats, opts] = await Promise.all([
      fetchMaintenanceCategories({ includeInactive: true }),
      fetchIssueOptions({ includeInactive: true }),
    ]);
    setCategories(cats);
    setOptions(opts);
    if (!optCategoryId && cats[0]) setOptCategoryId(cats[0].id);
  }, [optCategoryId]);

  useEffect(() => {
    (async () => {
      // Guard fallible work.
      try {
        setLoading(true);
        await refresh();
      // Invoke helper or pass arguments.
      } catch (err) {
        setError(err instanceof Error ? err.message : "Load failed");
      } finally {
        setLoading(false);
      }
    // Invoke helper or pass arguments.
    })();
  }, [refresh]);

  // Function definition.
  async function run(action: () => Promise<unknown>) {
    setError(null);
    setMessage(null);
    const result = await runMutationWithRefresh(action, refresh);
    if (!result.ok) {
      if (result.error !== "busy") setError(result.error);
      return;
    }
    setMessage(label("Запазено", "Saved"));
    if (result.outcome === "saved_refresh_failed") {
      const refreshPrefix = label(
        "Записът е успешен, но обновяването се провали",
        "Saved, but refresh failed",
      );
      setError(
        // Continue module logic.
        result.refreshError
          // Continue module logic.
          ? `${refreshPrefix}: ${result.refreshError}`
          : refreshPrefix,
      );
    }
  }

  // Function definition.
  async function onAddCategory(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await createMaintenanceCategory({
        key: catKey,
        nameBg: catNameBg,
        nameEn: catNameEn,
      });
      setCatKey("");
      setCatNameBg("");
      setCatNameEn("");
    });
  }

  // Function definition.
  async function onAddOption(e: FormEvent) {
    e.preventDefault();
    if (!optCategoryId) return;
    await run(async () => {
      await createIssueOption({
        maintenanceCategoryId: optCategoryId,
        kind: optKind,
        nameBg: optNameBg,
        nameEn: optNameEn,
        defaultPriority: optDefaultPriority || undefined,
        defaultBlocksRoom:
          optDefaultBlocks === "" ? undefined : optDefaultBlocks,
      });
      setOptNameBg("");
      setOptNameEn("");
      setOptDefaultPriority("");
      setOptDefaultBlocks("");
    });
  }

  // Function definition.
  async function persistOrder(ids: string[]) {
    const previous = options;
    setOptions(
      // Identifier continuation in list.
      ids
        .map((id) => previous.find((o) => o.id === id))
        .filter((o): o is IssueOptionRow => Boolean(o)),
    );
    setReorderBusy(true);
    setError(null);
    setMessage(null);
    // Guard fallible work.
    try {
      const next = await reorderIssueOptions(ids);
      setOptions(next);
      setMessage(label("Запазено", "Saved"));
    // Invoke helper or pass arguments.
    } catch (err) {
      setOptions(previous);
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setReorderBusy(false);
    }
  }

  // Function definition.
  async function moveOption(id: string, dir: -1 | 1) {
    const idx = options.findIndex((o) => o.id === id);
    if (idx < 0) return;
    const next = idx + dir;
    if (next < 0 || next >= options.length) return;
    const ids = options.map((o) => o.id);
    [ids[idx], ids[next]] = [ids[next], ids[idx]];
    await persistOrder(ids);
  }

  // Function definition.
  function onDragStart(e: DragEvent, id: string) {
    if (busy) {
      e.preventDefault();
      return;
    }
    dragIdRef.current = id;
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }

  // Function definition.
  function onDragOver(e: DragEvent, id: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropTargetId !== id) setDropTargetId(id);
  }

  // Function definition.
  function onDragLeave(id: string) {
    if (dropTargetId === id) setDropTargetId(null);
  }

  // Function definition.
  async function onDrop(e: DragEvent, targetId: string) {
    e.preventDefault();
    const sourceId = dragIdRef.current ?? e.dataTransfer.getData("text/plain");
    setDragId(null);
    setDropTargetId(null);
    dragIdRef.current = null;
    if (!sourceId || sourceId === targetId || busy) return;
    const from = options.findIndex((o) => o.id === sourceId);
    const to = options.findIndex((o) => o.id === targetId);
    if (from < 0 || to < 0) return;
    const ids = options.map((o) => o.id);
    ids.splice(from, 1);
    ids.splice(to, 0, sourceId);
    await persistOrder(ids);
  }

  // Function definition.
  function onDragEnd() {
    setDragId(null);
    setDropTargetId(null);
    dragIdRef.current = null;
  }

  // Const arrow/function binding.
  const catName = (c: MaintenanceCategoryRow) =>
    locale === "bg" ? c.nameBg : c.nameEn;

  return {
    label,
    locale,
    subTab,
    setSubTab,
    categories,
    options,
    loading,
    error,
    message,
    busy,
    dragId,
    dropTargetId,
    catKey,
    setCatKey,
    catNameBg,
    setCatNameBg,
    catNameEn,
    setCatNameEn,
    optCategoryId,
    setOptCategoryId,
    optKind,
    setOptKind,
    optNameBg,
    setOptNameBg,
    optNameEn,
    setOptNameEn,
    optDefaultPriority,
    setOptDefaultPriority,
    optDefaultBlocks,
    setOptDefaultBlocks,
    run,
    onAddCategory,
    onAddOption,
    moveOption,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragEnd,
    catName,
  };
}
