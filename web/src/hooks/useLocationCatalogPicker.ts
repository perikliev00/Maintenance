import { useCallback, useEffect, useState } from "react";
import {
  fetchLocationsCatalogPage,
  type LocationKind,
  type Room,
} from "../api/client";

// Exported constant / binding.
export const LOCATION_CATALOG_PAGE_SIZES = [25, 50, 100] as const;

export type UseLocationCatalogPickerParams = {
  enabled?: boolean;
  kind?: LocationKind;
  includeArchived?: boolean;
};

// Exported function entry point.
export function useLocationCatalogPicker({
  enabled = true,
  kind,
  includeArchived = true,
}: UseLocationCatalogPickerParams = {}) {
  const [search, setSearch] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [items, setItems] = useState<Room[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, pageSize, kind, includeArchived, enabled]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const result = await fetchLocationsCatalogPage({
        kind,
        includeArchived,
        q: debouncedQ,
        page,
        pageSize,
        signal,
      });
      setItems(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
      if (result.page !== page) setPage(result.page);
      return result;
    },
    [kind, includeArchived, debouncedQ, page, pageSize],
  );

  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    (async () => {
      // Guard fallible work.
      try {
        setLoading(true);
        setError(null);
        await load(ac.signal);
      // Invoke helper or pass arguments.
      } catch (err) {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Load failed");
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    // Invoke helper or pass arguments.
    })();
    return () => ac.abort();
  }, [enabled, load]);

  return {
    pageSizes: LOCATION_CATALOG_PAGE_SIZES,
    search,
    setSearch,
    debouncedQ,
    page,
    setPage,
    pageSize,
    setPageSize,
    items,
    total,
    totalPages,
    loading,
    error,
    setError,
    reload: load,
  };
}
