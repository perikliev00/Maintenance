import type { SectionLoadResult } from "../controlPageState";

/** Page-level banners shared by every Control section. */
export type ControlFeedback = {
  setError: (message: string | null) => void;
  setMessage: (message: string | null) => void;
  setRefreshWarning: (message: string | null) => void;
};

/**
 * Called by a section after each of its own loads. The board merges the
 * section's errors into the shared slots and updates the page error banner.
 */
export type ReportLoad = (result: SectionLoadResult) => void;
