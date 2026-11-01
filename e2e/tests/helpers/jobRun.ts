/**
 * Manual POST /jobs/run with 409 retry while another cycle holds the lock.
 */

export type JobRunPostResult = { status: number; body: unknown };

export type PostJobRunDeps = {
  post: (
    token: string,
    path: string,
    body: { jobKey: string },
  ) => Promise<JobRunPostResult>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Called with a message when a non-retryable failure should fail the test. */
  fail: (message: string) => never;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * POST /jobs/run until 200. Retries only on 409 (job_already_running).
 * Any other status fails immediately via `deps.fail`.
 */
export async function postJobRunWhenFree(
  deps: PostJobRunDeps,
  token: string,
  jobKey: string,
  timeoutMs = 120_000,
  retryDelayMs = 1_500,
): Promise<JobRunPostResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const deadline = now() + timeoutMs;
  // Cap attempts so a no-op sleep + frozen clock cannot busy-loop forever.
  const maxAttempts = Math.max(
    2,
    Math.ceil(timeoutMs / Math.max(1, retryDelayMs)) + 5,
  );
  let attempts = 0;
  let last: JobRunPostResult = { status: 0, body: null };

  while (now() < deadline) {
    attempts += 1;
    if (attempts > maxAttempts) {
      deps.fail(
        `POST /jobs/run exceeded ${maxAttempts} attempts while waiting out 409: ${JSON.stringify(last.body)}`,
      );
    }
    last = await deps.post(token, "/jobs/run", { jobKey });
    if (last.status === 200) return last;
    if (last.status !== 409) {
      deps.fail(
        `POST /jobs/run → ${last.status} ${JSON.stringify(last.body)}`,
      );
    }
    await sleep(retryDelayMs);
  }

  deps.fail(
    `POST /jobs/run still 409 after ${timeoutMs}ms: ${JSON.stringify(last.body)}`,
  );
}
