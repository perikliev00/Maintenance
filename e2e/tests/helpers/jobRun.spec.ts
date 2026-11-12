/**
 * Unit coverage for 409 retry in postJobRunWhenFree (no live API).
 */
import { expect, test } from "@playwright/test";
// Import bindings from ./jobRun.
import { postJobRunWhenFree, type JobRunPostResult } from "./jobRun";

// Suite: postJobRunWhenFree 409 retry.
test.describe("postJobRunWhenFree 409 retry", () => {
  // Case: retries 409 then returns the eventual 200.
  test("retries 409 then returns the eventual 200", async () => {
    // Bind calls for later setup or assertions in this scope.
    let calls = 0;
    // Execute the next setup or assertion step for this scenario.
    const sleeps: number[] = [];
    // result: HTTP response captured for status/body checks.
    const result = await postJobRunWhenFree(
      {
        // Execute the next setup or assertion step for this scenario.
        post: async () => {
          // Execute the next setup or assertion step for this scenario.
          calls += 1;
          // Conditional path for setup, cleanup, or alternate outcomes.
          if (calls < 3) {
            // Return the arranged value/result to the caller.
            return {
              // Fixture field status for the seeded actor/entity.
              status: 409,
              // Configure body for the request/server under test.
              body: { error: "job_already_running" },
            // Execute the next setup or assertion step for this scenario.
            } satisfies JobRunPostResult;
          }
          // Return the arranged value/result to the caller.
          return { status: 200, body: { locked: 0 } };
        },
        // Execute the next setup or assertion step for this scenario.
        sleep: async (ms) => {
          // Execute the next setup or assertion step for this scenario.
          sleeps.push(ms);
        },
        // Execute the next setup or assertion step for this scenario.
        fail: (message) => {
          // Surface a hard failure when isolation or contract is violated.
          throw new Error(message);
        },
      },
      // Execute the next setup or assertion step for this scenario.
      "token",
      // Concurrency/isolation step for the race under test.
      "lock_inactive_users",
      // Execute the next setup or assertion step for this scenario.
      10_000,
      // Execute the next setup or assertion step for this scenario.
      25,
    );
    // Assert response/page reached the expected status.
    expect(calls).toBe(3);
    // Assert browser/UI outcome matches the scenario intent.
    expect(sleeps).toEqual([25, 25]);
    // Assert response/page reached the expected status.
    expect(result.status).toBe(200);
    // Assert browser/UI outcome matches the scenario intent.
    expect(result.body).toEqual({ locked: 0 });
  });

  // Case: fails immediately on non-409 errors.
  test("fails immediately on non-409 errors", async () => {
    // Bind calls for later setup or assertions in this scope.
    let calls = 0;
    // Await async work before asserting or releasing locks.
    await expect(
      // Execute the next setup or assertion step for this scenario.
      postJobRunWhenFree(
        {
          // Execute the next setup or assertion step for this scenario.
          post: async () => {
            // Execute the next setup or assertion step for this scenario.
            calls += 1;
            // Return the arranged value/result to the caller.
            return { status: 403, body: { error: "forbidden" } };
          },
          // Execute the next setup or assertion step for this scenario.
          sleep: async () => {
            // Surface a hard failure when isolation or contract is violated.
            throw new Error("should not sleep");
          },
          // Execute the next setup or assertion step for this scenario.
          fail: (message) => {
            // Surface a hard failure when isolation or contract is violated.
            throw new Error(message);
          },
        },
        // Execute the next setup or assertion step for this scenario.
        "token",
        // Concurrency/isolation step for the race under test.
        "lock_inactive_users",
        // Execute the next setup or assertion step for this scenario.
        10_000,
        // Execute the next setup or assertion step for this scenario.
        25,
      ),
    // Execute the next setup or assertion step for this scenario.
    ).rejects.toThrow(/POST \/jobs\/run → 403/);
    // Assert response/page reached the expected status.
    expect(calls).toBe(1);
  });

  // Case: fails after timeout while still 409.
  test("fails after timeout while still 409", async () => {
    // Bind now for later setup or assertions in this scope.
    let now = 1_000;
    // Await async work before asserting or releasing locks.
    await expect(
      // Execute the next setup or assertion step for this scenario.
      postJobRunWhenFree(
        {
          // Execute the next setup or assertion step for this scenario.
          post: async () => ({
            // Fixture field status for the seeded actor/entity.
            status: 409,
            // Configure body for the request/server under test.
            body: { error: "job_already_running" },
          }),
          // Execute the next setup or assertion step for this scenario.
          sleep: async () => {
            // Execute the next setup or assertion step for this scenario.
            now += 50;
          },
          // Execute the next setup or assertion step for this scenario.
          now: () => now,
          // Execute the next setup or assertion step for this scenario.
          fail: (message) => {
            // Surface a hard failure when isolation or contract is violated.
            throw new Error(message);
          },
        },
        // Execute the next setup or assertion step for this scenario.
        "token",
        // Concurrency/isolation step for the race under test.
        "lock_inactive_users",
        // Execute the next setup or assertion step for this scenario.
        100,
        // Execute the next setup or assertion step for this scenario.
        25,
      ),
    // Execute the next setup or assertion step for this scenario.
    ).rejects.toThrow(/still 409 after 100ms/);
  });

  // Case probes concurrency/isolation: fails fast when sleep is a no-op and the clock never advances.
  test("fails fast when sleep is a no-op and the clock never advances", async () => {
    // Await async work before asserting or releasing locks.
    await expect(
      // Execute the next setup or assertion step for this scenario.
      postJobRunWhenFree(
        {
          // Execute the next setup or assertion step for this scenario.
          post: async () => ({
            // Fixture field status for the seeded actor/entity.
            status: 409,
            // Configure body for the request/server under test.
            body: { error: "job_already_running" },
          }),
          // Execute the next setup or assertion step for this scenario.
          sleep: async () => {
            /* no-op — used to hang before maxAttempts existed */
          },
          // Execute the next setup or assertion step for this scenario.
          now: () => 1_000,
          // Execute the next setup or assertion step for this scenario.
          fail: (message) => {
            // Surface a hard failure when isolation or contract is violated.
            throw new Error(message);
          },
        },
        // Execute the next setup or assertion step for this scenario.
        "token",
        // Concurrency/isolation step for the race under test.
        "lock_inactive_users",
        // Execute the next setup or assertion step for this scenario.
        100,
        // Execute the next setup or assertion step for this scenario.
        25,
      ),
    // Execute the next setup or assertion step for this scenario.
    ).rejects.toThrow(/exceeded \d+ attempts/);
  });
});
