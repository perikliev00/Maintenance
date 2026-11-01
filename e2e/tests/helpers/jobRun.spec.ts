/**
 * Unit coverage for 409 retry in postJobRunWhenFree (no live API).
 */
import { expect, test } from "@playwright/test";
import { postJobRunWhenFree, type JobRunPostResult } from "./jobRun";

test.describe("postJobRunWhenFree 409 retry", () => {
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
              body: { error: "job_already_running" },
            } satisfies JobRunPostResult;
          }
          return { status: 200, body: { locked: 0 } };
        },
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        fail: (message) => {
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
            throw new Error("should not sleep");
          },
          fail: (message) => {
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

  test("fails after timeout while still 409", async () => {
    let now = 1_000;
    await expect(
      postJobRunWhenFree(
        {
          post: async () => ({
            status: 409,
            body: { error: "job_already_running" },
          }),
          sleep: async () => {
            now += 50;
          },
          now: () => now,
          fail: (message) => {
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

  test("fails fast when sleep is a no-op and the clock never advances", async () => {
    await expect(
      postJobRunWhenFree(
        {
          post: async () => ({
            status: 409,
            body: { error: "job_already_running" },
          }),
          sleep: async () => {
            /* no-op — used to hang before maxAttempts existed */
          },
          now: () => 1_000,
          fail: (message) => {
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
