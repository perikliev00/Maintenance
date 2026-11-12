// Import type-only dependency for typing without runtime cost.
import type { SectionLoadResult } from "../controlPageState";

/** Page-level banners shared by every Control section. */
export type ControlFeedback = {
  // Provide setError field used by this structure.
  setError: (message: string | null) => void;
  // Provide setMessage field used by this structure.
  setMessage: (message: string | null) => void;
  // Provide setRefreshWarning field used by this structure.
  setRefreshWarning: (message: string | null) => void;
};

/**
 * Called by a section after each of its own loads. The board merges the
 * section's errors into the shared slots and updates the page error banner.
 */
export type ReportLoad = (result: SectionLoadResult) => void;
