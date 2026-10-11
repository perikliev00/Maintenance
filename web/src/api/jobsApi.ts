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

export async function fetchJobRuns(limit = 50): Promise<JobRunRow[]> {
  const res = await apiFetch(`${API_BASE}/jobs/runs?limit=${limit}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}
