/** Background job run history for the Control / audit surfaces. */
import { apiGet, buildQuery } from "./http";

export type JobRunRow = {
  id: string;
  jobKey: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  summary: unknown;
  error: string | null;
};

/** List recent background job runs (newest first; server-capped by `limit`). */
export async function fetchJobRuns(limit = 50): Promise<JobRunRow[]> {
  return apiGet(`/jobs/runs${buildQuery({ limit })}`);
}
