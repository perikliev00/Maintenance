// Import dependency used by this module.
import { useCallback, useEffect, useState } from "react";
// Import dependency used by this module.
import {
  // List item in import/export/params.
  fetchLocationsCatalogPage,
  // Local type alias shaping data.
  type LocationKind,
  // Local type alias shaping data.
  type Room,
// Close multi-line construct with trailing syntax.
} from "../api/client";

// Exported constant / binding.
export const LOCATION_CATALOG_PAGE_SIZES = [25, 50, 100] as const;

// Export type alias for consumers.
export type UseLocationCatalogPickerParams = {
  // Field/property in this shape.
  enabled?: boolean;
  // Field/property in this shape.
  kind?: LocationKind;
  // Field/property in this shape.
  includeArchived?: boolean;
};

// Exported function entry point.
export function useLocationCatalogPicker({
  // Assign value for subsequent use.
  enabled = true,
  // List item in import/export/params.
  kind,
  // Assign value for subsequent use.
  includeArchived = true,
// Assign value for subsequent use.
}: UseLocationCatalogPickerParams = {}) {
  // Assign value for subsequent use.
  const [search, setSearch] = useState("");
  // Assign value for subsequent use.
  const [debouncedQ, setDebouncedQ] = useState("");
  // Assign value for subsequent use.
  const [page, setPage] = useState(1);
  // Assign value for subsequent use.
  const [pageSize, setPageSize] = useState<number>(25);
  // Assign value for subsequent use.
  const [items, setItems] = useState<Room[]>([]);
  // Assign value for subsequent use.
  const [total, setTotal] = useState(0);
  // Assign value for subsequent use.
  const [totalPages, setTotalPages] = useState(1);
  // Assign value for subsequent use.
  const [loading, setLoading] = useState(false);
  // Assign value for subsequent use.
  const [error, setError] = useState<string | null>(null);

  // Arrow function / callback body.
  useEffect(() => {
    // Local constant binding.
    const t = window.setTimeout(() => setDebouncedQ(search), 300);
    // Return computed result to caller.
    return () => window.clearTimeout(t);
  // Close multi-line construct with trailing syntax.
  }, [search]);

  // Arrow function / callback body.
  useEffect(() => {
    // Invoke helper or pass arguments.
    setPage(1);
  // Close multi-line construct with trailing syntax.
  }, [debouncedQ, pageSize, kind, includeArchived, enabled]);

  // Local constant binding.
  const load = useCallback(
    // Arrow function / callback body.
    async (signal?: AbortSignal) => {
      // Local constant binding.
      const result = await fetchLocationsCatalogPage({
        // List item in import/export/params.
        kind,
        // List item in import/export/params.
        includeArchived,
        // Field/property in this shape.
        q: debouncedQ,
        // List item in import/export/params.
        page,
        // List item in import/export/params.
        pageSize,
        // List item in import/export/params.
        signal,
      });
      // Invoke helper or pass arguments.
      setItems(result.items);
      // Invoke helper or pass arguments.
      setTotal(result.total);
      // Invoke helper or pass arguments.
      setTotalPages(result.totalPages);
      // Conditional branch for this case.
      if (result.page !== page) setPage(result.page);
      // Return computed result to caller.
      return result;
    },
    // Continue multi-line list/arguments.
    [kind, includeArchived, debouncedQ, page, pageSize],
  );

  // Arrow function / callback body.
  useEffect(() => {
    // Conditional branch for this case.
    if (!enabled) return;
    // Local constant binding.
    const ac = new AbortController();
    // Arrow function / callback body.
    (async () => {
      // Guard fallible work.
      try {
        // Invoke helper or pass arguments.
        setLoading(true);
        // Invoke helper or pass arguments.
        setError(null);
        // Await async work before continuing.
        await load(ac.signal);
      // Invoke helper or pass arguments.
      } catch (err) {
        // Conditional branch for this case.
        if (ac.signal.aborted) return;
        // Invoke helper or pass arguments.
        setError(err instanceof Error ? err.message : "Load failed");
      // Open multi-line construct.
      } finally {
        // Conditional branch for this case.
        if (!ac.signal.aborted) setLoading(false);
      }
    // Invoke helper or pass arguments.
    })();
    // Return computed result to caller.
    return () => ac.abort();
  // Close multi-line construct with trailing syntax.
  }, [enabled, load]);

  // Return computed result to caller.
  return {
    // Field/property in this shape.
    pageSizes: LOCATION_CATALOG_PAGE_SIZES,
    // List item in import/export/params.
    search,
    // List item in import/export/params.
    setSearch,
    // List item in import/export/params.
    debouncedQ,
    // List item in import/export/params.
    page,
    // List item in import/export/params.
    setPage,
    // List item in import/export/params.
    pageSize,
    // List item in import/export/params.
    setPageSize,
    // List item in import/export/params.
    items,
    // List item in import/export/params.
    total,
    // List item in import/export/params.
    totalPages,
    // List item in import/export/params.
    loading,
    // List item in import/export/params.
    error,
    // List item in import/export/params.
    setError,
    // Field/property in this shape.
    reload: load,
  };
}
