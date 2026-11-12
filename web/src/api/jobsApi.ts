/** Background job run history for the Control / audit surfaces. */
import { apiGet, buildQuery } from "./http";

// Export type alias for consumers.
export type JobRunRow = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  jobKey: string;
  // Field/property in this shape.
  startedAt: string;
  // Field/property in this shape.
  finishedAt: string | null;
  // Field/property in this shape.
  status: string;
  // Field/property in this shape.
  summary: unknown;
  // Field/property in this shape.
  error: string | null;
};

/** List recent background job runs (newest first; server-capped by `limit`). */
export async function fetchJobRuns(limit = 50): Promise<JobRunRow[]> {
  // Return computed result to caller.
  return apiGet(`/jobs/runs${buildQuery({ limit })}`);
}
