/**
 * Manual POST /jobs/run with 409 retry while another cycle holds the lock.
 */

export type JobRunPostResult = { status: number; body: unknown };

// Export PostJobRunDeps for shared test/setup consumers.
export type PostJobRunDeps = {
  // Execute the next setup or assertion step for this scenario.
  post: (
    // Execute the next setup or assertion step for this scenario.
    token: string,
    // Execute the next setup or assertion step for this scenario.
    path: string,
    // Configure body for the request/server under test.
    body: { jobKey: string },
  // Execute the next setup or assertion step for this scenario.
  ) => Promise<JobRunPostResult>;
  // Execute the next setup or assertion step for this scenario.
  sleep?: (ms: number) => Promise<void>;
  // Execute the next setup or assertion step for this scenario.
  now?: () => number;
  /** Called with a message when a non-retryable failure should fail the test. */
  fail: (message: string) => never;
};

// Bind defaultSleep for later setup or assertions in this scope.
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * POST /jobs/run until 200. Retries only on 409 (job_already_running).
 * Any other status fails immediately via `deps.fail`.
 */
export async function postJobRunWhenFree(
  // Execute the next setup or assertion step for this scenario.
  deps: PostJobRunDeps,
  // Execute the next setup or assertion step for this scenario.
  token: string,
  // Execute the next setup or assertion step for this scenario.
  jobKey: string,
  // Execute the next setup or assertion step for this scenario.
  timeoutMs = 120_000,
  // Execute the next setup or assertion step for this scenario.
  retryDelayMs = 1_500,
// Execute the next setup or assertion step for this scenario.
): Promise<JobRunPostResult> {
  // Bind sleep for later setup or assertions in this scope.
  const sleep = deps.sleep ?? defaultSleep;
  // Bind now for later setup or assertions in this scope.
  const now = deps.now ?? Date.now;
  // deadline: bound how long the wait/poll may run.
  const deadline = now() + timeoutMs;
  // Cap attempts so a no-op sleep + frozen clock cannot busy-loop forever.
  const maxAttempts = Math.max(
    2,
    // Execute the next setup or assertion step for this scenario.
    Math.ceil(timeoutMs / Math.max(1, retryDelayMs)) + 5,
  );
  // attempts: repetition count to amplify race windows.
  let attempts = 0;
  // Execute the next setup or assertion step for this scenario.
  let last: JobRunPostResult = { status: 0, body: null };

  // Repeat/poll to widen the race window or wait for lock waiters.
  while (now() < deadline) {
    // Execute the next setup or assertion step for this scenario.
    attempts += 1;
    // Conditional path for setup, cleanup, or alternate outcomes.
    if (attempts > maxAttempts) {
      // Execute the next setup or assertion step for this scenario.
      deps.fail(
        // Execute the next setup or assertion step for this scenario.
        `POST /jobs/run exceeded ${maxAttempts} attempts while waiting out 409: ${JSON.stringify(last.body)}`,
      );
    }
    // Await async work before asserting or releasing locks.
    last = await deps.post(token, "/jobs/run", { jobKey });
    // Guard optional cleanup or alternate assertion paths.
    if (last.status === 200) return last;
    // Guard optional cleanup or alternate assertion paths.
    if (last.status !== 409) {
      // Execute the next setup or assertion step for this scenario.
      deps.fail(
        // Execute the next setup or assertion step for this scenario.
        `POST /jobs/run → ${last.status} ${JSON.stringify(last.body)}`,
      );
    }
    // Await async work before asserting or releasing locks.
    await sleep(retryDelayMs);
  }

  // Execute the next setup or assertion step for this scenario.
  deps.fail(
    // Execute the next setup or assertion step for this scenario.
    `POST /jobs/run still 409 after ${timeoutMs}ms: ${JSON.stringify(last.body)}`,
  );
}
