/**
 * Unit coverage for 409 retry in postJobRunWhenFree (no live API).
 */
import { expect, test } from "@playwright/test";
import { postJobRunWhenFree, type JobRunPostResult } from "./jobRun";

// Suite: postJobRunWhenFree 409 retry.
test.describe("postJobRunWhenFree 409 retry", () => {
  // Case: retries 409 then returns the eventual 200.
  test("retries 409 then returns the eventual 200", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await postJobRunWhenFree(
      {
        post: async () => {
          calls += 1;
          if (calls < 3) {
            return {
              status: 409,
              // Configure body for the request/server under test.
              body: { error: "job_already_running" },
            } satisfies JobRunPostResult;
          }
          return { status: 200, body: { locked: 0 } };
        },
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        fail: (message) => {
          // Surface a hard failure when isolation or contract is violated.
          throw new Error(message);
        },
      },
      "token",
      "lock_inactive_users",
      10_000,
      25,
    );
    expect(calls).toBe(3);
    expect(sleeps).toEqual([25, 25]);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ locked: 0 });
  });

  // Case: fails immediately on non-409 errors.
  test("fails immediately on non-409 errors", async () => {
    let calls = 0;
    await expect(
      postJobRunWhenFree(
        {
          post: async () => {
            calls += 1;
            return { status: 403, body: { error: "forbidden" } };
          },
          sleep: async () => {
            // Surface a hard failure when isolation or contract is violated.
            throw new Error("should not sleep");
          },
          fail: (message) => {
            // Surface a hard failure when isolation or contract is violated.
            throw new Error(message);
          },
        },
        "token",
        "lock_inactive_users",
        10_000,
        25,
      ),
    ).rejects.toThrow(/POST \/jobs\/run → 403/);
    expect(calls).toBe(1);
  });

  // Case: fails after timeout while still 409.
  test("fails after timeout while still 409", async () => {
    let now = 1_000;
    await expect(
      postJobRunWhenFree(
        {
          post: async () => ({
            status: 409,
            // Configure body for the request/server under test.
            body: { error: "job_already_running" },
          }),
          sleep: async () => {
            now += 50;
          },
          now: () => now,
          fail: (message) => {
            // Surface a hard failure when isolation or contract is violated.
            throw new Error(message);
          },
        },
        "token",
        "lock_inactive_users",
        100,
        25,
      ),
    ).rejects.toThrow(/still 409 after 100ms/);
  });

  // Case probes concurrency/isolation: fails fast when sleep is a no-op and the clock never advances.
  test("fails fast when sleep is a no-op and the clock never advances", async () => {
    await expect(
      postJobRunWhenFree(
        {
          post: async () => ({
            status: 409,
            // Configure body for the request/server under test.
            body: { error: "job_already_running" },
          }),
          sleep: async () => {
            /* no-op — used to hang before maxAttempts existed */
          },
          now: () => 1_000,
          fail: (message) => {
            // Surface a hard failure when isolation or contract is violated.
            throw new Error(message);
          },
        },
        "token",
        "lock_inactive_users",
        100,
        25,
      ),
    ).rejects.toThrow(/exceeded \d+ attempts/);
  });
});
