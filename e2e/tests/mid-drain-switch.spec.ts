// Playwright test runner APIs for browser E2E scenarios.
import { expect, test, type Page } from "@playwright/test";
// Import bindings from ./helpers/auth.
import { storedUserId, uiLogin, USERS } from "./helpers/auth";

// Shape E2eWindow documents the fixture/response fields this suite touches.
type E2eWindow = Window & {
  // Execute the next setup or assertion step for this scenario.
  __MERIDIAN_E2E_AFTER_DRAIN_CLAIM__?: () => void | Promise<void>;
  // Execute the next setup or assertion step for this scenario.
  __e2eReleaseDrainClaim?: () => void;
  /** Set true only when drain actually enters the after-claim hook. */
  __e2eDrainClaimed?: boolean;
  /** Set when drain resumes after the after-claim gate and finishes abort/send path. */
  __e2eDrainResumed?: boolean;
};

// Shape QueueHit documents the fixture/response fields this suite touches.
type QueueHit = {
  // Execute the next setup or assertion step for this scenario.
  found: boolean;
  // Execute the next setup or assertion step for this scenario.
  userId?: string;
  // Execute the next setup or assertion step for this scenario.
  status?: string;
  // Execute the next setup or assertion step for this scenario.
  commandId?: string;
};

// Helper seedPendingQueue: arrange fixture data for the case.
async function seedPendingQueue(page: Page, userId: string): Promise<string> {
  // Return the arranged value/result to the caller.
  return page.evaluate(async (uid) => {
    // commandId: unique stamp so parallel runs do not collide.
    const commandId = crypto.randomUUID();
    // Bind item for later setup or assertions in this scope.
    const item = {
      // Execute the next setup or assertion step for this scenario.
      id: crypto.randomUUID(),
      // Execute the next setup or assertion step for this scenario.
      userId: uid,
      // Execute the next setup or assertion step for this scenario.
      commandId,
      // Execute the next setup or assertion step for this scenario.
      type: "cleaning.start",
      // Configure url for the request/server under test.
      url: `/api/cleaning/tasks/${crypto.randomUUID()}/start`,
      // Configure method for the request/server under test.
      method: "POST" as const,
      // Configure body for the request/server under test.
      body: { commandId, expectedVersion: 1 },
      // Execute the next setup or assertion step for this scenario.
      createdAt: Date.now(),
      // Execute the next setup or assertion step for this scenario.
      updatedAt: Date.now(),
      // Fixture field status for the seeded actor/entity.
      status: "pending" as const,
      // Execute the next setup or assertion step for this scenario.
      lastError: null,
      // Execute the next setup or assertion step for this scenario.
      conflictCode: null,
      // Execute the next setup or assertion step for this scenario.
      conflictMessage: null,
      // Execute the next setup or assertion step for this scenario.
      conflictDetails: null,
      // Runner option controlling stability or isolation of the suite.
      retries: 0,
    };

    // Await async work before asserting or releasing locks.
    await new Promise<void>((resolve, reject) => {
      // Bind req for later setup or assertions in this scope.
      const req = indexedDB.open("meridian-offline", 2);
      // Execute the next setup or assertion step for this scenario.
      req.onupgradeneeded = () => {
        // Bind db for later setup or assertions in this scope.
        const db = req.result;
        // Conditional path for setup, cleanup, or alternate outcomes.
        if (!db.objectStoreNames.contains("queue")) {
          // Bind store for later setup or assertions in this scope.
          const store = db.createObjectStore("queue", { keyPath: "id" });
          // Seed prerequisite rows so the mutation under test has a realistic baseline.
          store.createIndex("userId", "userId", { unique: false });
          // Seed prerequisite rows so the mutation under test has a realistic baseline.
          store.createIndex("userId_status", ["userId", "status"], {
            // Execute the next setup or assertion step for this scenario.
            unique: false,
          });
        }
      };
      // Execute the next setup or assertion step for this scenario.
      req.onerror = () => reject(req.error ?? new Error("idb open failed"));
      // Execute the next setup or assertion step for this scenario.
      req.onsuccess = () => {
        // Bind db for later setup or assertions in this scope.
        const db = req.result;
        // Bind tx for later setup or assertions in this scope.
        const tx = db.transaction("queue", "readwrite");
        // Execute the next setup or assertion step for this scenario.
        tx.objectStore("queue").put(item);
        // Execute the next setup or assertion step for this scenario.
        tx.oncomplete = () => {
          // Execute the next setup or assertion step for this scenario.
          db.close();
          // Execute the next setup or assertion step for this scenario.
          resolve();
        };
        // Execute the next setup or assertion step for this scenario.
        tx.onerror = () => reject(tx.error ?? new Error("idb put failed"));
      };
    });

    // Return the arranged value/result to the caller.
    return commandId;
  // Execute the next setup or assertion step for this scenario.
  }, userId);
}

// Local helper findQueueItem used by cases in this file.
async function findQueueItem(
  // Execute the next setup or assertion step for this scenario.
  page: Page,
  // Execute the next setup or assertion step for this scenario.
  userId: string,
  // Execute the next setup or assertion step for this scenario.
  commandId: string,
// Execute the next setup or assertion step for this scenario.
): Promise<QueueHit> {
  // Return the arranged value/result to the caller.
  return page.evaluate(
    // Execute the next setup or assertion step for this scenario.
    async ({ uid, cmd }) => {
      // Return the arranged value/result to the caller.
      return new Promise<QueueHit>((resolve, reject) => {
        // Bind req for later setup or assertions in this scope.
        const req = indexedDB.open("meridian-offline", 2);
        // Execute the next setup or assertion step for this scenario.
        req.onerror = () => reject(req.error ?? new Error("idb open failed"));
        // Execute the next setup or assertion step for this scenario.
        req.onsuccess = () => {
          // Bind db for later setup or assertions in this scope.
          const db = req.result;
          // Conditional path for setup, cleanup, or alternate outcomes.
          if (!db.objectStoreNames.contains("queue")) {
            // Execute the next setup or assertion step for this scenario.
            db.close();
            // Execute the next setup or assertion step for this scenario.
            resolve({ found: false });
            // Execute the next setup or assertion step for this scenario.
            return;
          }
          // Bind tx for later setup or assertions in this scope.
          const tx = db.transaction("queue", "readonly");
          // Bind store for later setup or assertions in this scope.
          const store = tx.objectStore("queue");
          // Bind index for later setup or assertions in this scope.
          const index = store.index("userId");
          // Bind getAll for later setup or assertions in this scope.
          const getAll = index.getAll(uid);
          // Execute the next setup or assertion step for this scenario.
          getAll.onsuccess = () => {
            // Bind rows for later setup or assertions in this scope.
            const rows = (getAll.result ?? []) as Array<{
              // Execute the next setup or assertion step for this scenario.
              userId: string;
              // Fixture field status for the seeded actor/entity.
              status: string;
              // Execute the next setup or assertion step for this scenario.
              commandId: string;
            // Execute the next setup or assertion step for this scenario.
            }>;
            // Bind hit for later setup or assertions in this scope.
            const hit = rows.find((r) => r.commandId === cmd);
            // Execute the next setup or assertion step for this scenario.
            db.close();
            // Execute the next setup or assertion step for this scenario.
            resolve(
              // Execute the next setup or assertion step for this scenario.
              hit
                ? {
                    // Execute the next setup or assertion step for this scenario.
                    found: true,
                    // Execute the next setup or assertion step for this scenario.
                    userId: hit.userId,
                    // Fixture field status for the seeded actor/entity.
                    status: hit.status,
                    // Execute the next setup or assertion step for this scenario.
                    commandId: hit.commandId,
                  }
                : { found: false },
            );
          };
          // Execute the next setup or assertion step for this scenario.
          getAll.onerror = () =>
            // Execute the next setup or assertion step for this scenario.
            reject(getAll.error ?? new Error("idb getAll failed"));
        };
      });
    },
    // Execute the next setup or assertion step for this scenario.
    { uid: userId, cmd: commandId },
  );
}

/**
 * (browser): after outbox claim, logout+login as another
 * user must abort before /sync/push so user A's command never leaves the tab.
 *
 * Logout deliberately wipes the outbox (shared-device rule). Unit tests cover
 * in-memory survival of a claimed row when identity flips without purge.
 */
test.describe("mid-drain account switch", () => {
  // Case: aborts sync push when profile switches after drain claim.
  test("aborts sync push when profile switches after drain claim", async ({
    // Execute the next setup or assertion step for this scenario.
    page,
  // Execute the next setup or assertion step for this scenario.
  }) => {
    // Execute the next setup or assertion step for this scenario.
    const pushRequests: string[] = [];
    // Await async work before asserting or releasing locks.
    await page.route("**/sync/push", async (route) => {
      // Execute the next setup or assertion step for this scenario.
      pushRequests.push(route.request().postData() ?? "");
      // Await async work before asserting or releasing locks.
      await route.abort();
    });

    // Drive the browser through the user-visible workflow step.
    await uiLogin(page, USERS.housekeeper);
    // userAId: unique stamp so parallel runs do not collide.
    const userAId = await storedUserId(page);
    // commandId: unique stamp so parallel runs do not collide.
    const commandId = await seedPendingQueue(page, userAId);

    // Await async work before asserting or releasing locks.
    await page.evaluate(() => {
      // Bind w for later setup or assertions in this scope.
      const w = window as E2eWindow;
      // Execute the next setup or assertion step for this scenario.
      let release!: () => void;
      // Bind gate for later setup or assertions in this scope.
      const gate = new Promise<void>((resolve) => {
        // Execute the next setup or assertion step for this scenario.
        release = resolve;
      });
      // Execute the next setup or assertion step for this scenario.
      w.__e2eDrainClaimed = false;
      // Execute the next setup or assertion step for this scenario.
      w.__e2eDrainResumed = false;
      // Execute the next setup or assertion step for this scenario.
      w.__MERIDIAN_E2E_AFTER_DRAIN_CLAIM__ = async () => {
        // Execute the next setup or assertion step for this scenario.
        w.__e2eDrainClaimed = true;
        // Try path where partial failure must not leak suite state.
        try {
          // Await async work before asserting or releasing locks.
          await gate;
        // Execute the next setup or assertion step for this scenario.
        } finally {
          // Execute the next setup or assertion step for this scenario.
          w.__e2eDrainResumed = true;
        }
      };
      // Execute the next setup or assertion step for this scenario.
      w.__e2eReleaseDrainClaim = () => {
        // Execute the next setup or assertion step for this scenario.
        release();
        // SQL fragment used to observe locks or assert DB state.
        delete w.__MERIDIAN_E2E_AFTER_DRAIN_CLAIM__;
      };
    });

    // Kick drain while the after-claim gate is held.
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    // Wait until drain has entered the after-claim hook (claim completed).
    await expect
      // Continue the call chain for setup or assertion detail.
      .poll(async () =>
        // Execute the next setup or assertion step for this scenario.
        page.evaluate(() => (window as E2eWindow).__e2eDrainClaimed === true),
      )
      // Chained expectation refining the UI/API assertion.
      .toBe(true);

    // Claimed row must be "sending" before logout (proves pre-send seam).
    const claimed = await findQueueItem(page, userAId, commandId);
    // Assert browser/UI outcome matches the scenario intent.
    expect(claimed.found, "claimed outbox row before logout").toBe(true);
    // Assert browser/UI outcome matches the scenario intent.
    expect(claimed.userId).toBe(userAId);
    // Assert response/page reached the expected status.
    expect(claimed.status).toBe("sending");

    // Drive the browser through the user-visible workflow step.
    await page.getByRole("button", { name: "Log out" }).click();
    // logout() awaits IndexedDB purge before showing Sign in.
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    // Logout wipes private offline stores — A's command must not linger for B.
    const afterLogout = await findQueueItem(page, userAId, commandId);
    // Assert browser/UI outcome matches the scenario intent.
    expect(
      // Session/CSRF step exercising auth lifecycle.
      afterLogout.found,
      // Session/CSRF step exercising auth lifecycle.
      "logout must purge user A outbox (shared-device wipe)",
    // Execute the next setup or assertion step for this scenario.
    ).toBe(false);

    // Await async work before asserting or releasing locks.
    await page.getByLabel("Email").fill(USERS.manager);
    // Await async work before asserting or releasing locks.
    await page.getByLabel("Password").fill("demo1234");
    // Drive the browser through the user-visible workflow step.
    await page.getByRole("button", { name: "Sign in" }).click();
    // Assert UI visibility/state after the user action.
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();

    // Await async work before asserting or releasing locks.
    await page.evaluate(() => {
      // Execute the next setup or assertion step for this scenario.
      (window as E2eWindow).__e2eReleaseDrainClaim?.();
    });

    // Deterministic: wait until drain resumes past the gate (abort path).
    await expect
      // Continue the call chain for setup or assertion detail.
      .poll(async () =>
        // Execute the next setup or assertion step for this scenario.
        page.evaluate(() => (window as E2eWindow).__e2eDrainResumed === true),
      )
      // Chained expectation refining the UI/API assertion.
      .toBe(true);

    // Assert browser/UI outcome matches the scenario intent.
    expect(
      // Execute the next setup or assertion step for this scenario.
      pushRequests.some((body) => body.includes(commandId)),
      // Execute the next setup or assertion step for this scenario.
      "user A command must not reach /sync/push after account switch",
    // Execute the next setup or assertion step for this scenario.
    ).toBe(false);

    // Bound user B must not inherit A's commandId in the outbox either.
    const userBId = await storedUserId(page);
    // asB: synchronize actors so the race window is observable.
    const asB = await findQueueItem(page, userBId, commandId);
    // Assert browser/UI outcome matches the scenario intent.
    expect(asB.found, "user B must not hold user A command").toBe(false);
  });
});
