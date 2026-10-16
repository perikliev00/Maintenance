/** Background job run history for the Control / audit surfaces. */
import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

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
  // Control / audit surfaces poll this for scheduler health.
  const res = await apiFetch(`${API_BASE}/jobs/runs?limit=${limit}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}
