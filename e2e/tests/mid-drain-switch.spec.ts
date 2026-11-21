// Playwright test runner APIs for browser E2E scenarios.
import { expect, test, type Page } from "@playwright/test";
import { openAccount, storedUserId, uiLogin, USERS } from "./helpers/auth";

// Shape E2eWindow documents the fixture/response fields this suite touches.
type E2eWindow = Window & {
  __MERIDIAN_E2E_AFTER_DRAIN_CLAIM__?: () => void | Promise<void>;
  __e2eReleaseDrainClaim?: () => void;
  /** Set true only when drain actually enters the after-claim hook. */
  __e2eDrainClaimed?: boolean;
  /** Set when drain resumes after the after-claim gate and finishes abort/send path. */
  __e2eDrainResumed?: boolean;
};

// Shape QueueHit documents the fixture/response fields this suite touches.
type QueueHit = {
  found: boolean;
  userId?: string;
  status?: string;
  commandId?: string;
};

// Helper seedPendingQueue: arrange fixture data for the case.
async function seedPendingQueue(page: Page, userId: string): Promise<string> {
  return page.evaluate(async (uid) => {
    const commandId = crypto.randomUUID();
    const item = {
      id: crypto.randomUUID(),
      userId: uid,
      commandId,
      type: "cleaning.start",
      // Configure url for the request/server under test.
      url: `/api/cleaning/tasks/${crypto.randomUUID()}/start`,
      // Configure method for the request/server under test.
      method: "POST" as const,
      // Configure body for the request/server under test.
      body: { commandId, expectedVersion: 1 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "pending" as const,
      lastError: null,
      conflictCode: null,
      conflictMessage: null,
      conflictDetails: null,
      retries: 0,
    };

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("meridian-offline", 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("queue")) {
          const store = db.createObjectStore("queue", { keyPath: "id" });
          store.createIndex("userId", "userId", { unique: false });
          store.createIndex("userId_status", ["userId", "status"], {
            unique: false,
          });
        }
      };
      req.onerror = () => reject(req.error ?? new Error("idb open failed"));
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("queue", "readwrite");
        tx.objectStore("queue").put(item);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error ?? new Error("idb put failed"));
      };
    });

    return commandId;
  }, userId);
}

// Local helper findQueueItem used by cases in this file.
async function findQueueItem(
  page: Page,
  userId: string,
  commandId: string,
): Promise<QueueHit> {
  return page.evaluate(
    async ({ uid, cmd }) => {
      return new Promise<QueueHit>((resolve, reject) => {
        const req = indexedDB.open("meridian-offline", 2);
        req.onerror = () => reject(req.error ?? new Error("idb open failed"));
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("queue")) {
            db.close();
            resolve({ found: false });
            return;
          }
          const tx = db.transaction("queue", "readonly");
          const store = tx.objectStore("queue");
          const index = store.index("userId");
          const getAll = index.getAll(uid);
          getAll.onsuccess = () => {
            const rows = (getAll.result ?? []) as Array<{
              userId: string;
              status: string;
              commandId: string;
            }>;
            const hit = rows.find((r) => r.commandId === cmd);
            db.close();
            resolve(
              hit
                ? {
                    found: true,
                    userId: hit.userId,
                    status: hit.status,
                    commandId: hit.commandId,
                  }
                : { found: false },
            );
          };
          getAll.onerror = () =>
            reject(getAll.error ?? new Error("idb getAll failed"));
        };
      });
    },
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
    page,
  }) => {
    const pushRequests: string[] = [];
    await page.route("**/sync/push", async (route) => {
      pushRequests.push(route.request().postData() ?? "");
      await route.abort();
    });

    await uiLogin(page, USERS.housekeeper);
    const userAId = await storedUserId(page);
    const commandId = await seedPendingQueue(page, userAId);

    await page.evaluate(() => {
      const w = window as E2eWindow;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      w.__e2eDrainClaimed = false;
      w.__e2eDrainResumed = false;
      w.__MERIDIAN_E2E_AFTER_DRAIN_CLAIM__ = async () => {
        w.__e2eDrainClaimed = true;
        try {
          await gate;
        } finally {
          w.__e2eDrainResumed = true;
        }
      };
      w.__e2eReleaseDrainClaim = () => {
        release();
        delete w.__MERIDIAN_E2E_AFTER_DRAIN_CLAIM__;
      };
    });

    // Kick drain while the after-claim gate is held.
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    // Wait until drain has entered the after-claim hook (claim completed).
    await expect
      .poll(async () =>
        page.evaluate(() => (window as E2eWindow).__e2eDrainClaimed === true),
      )
      // Chained expectation refining the UI/API assertion.
      .toBe(true);

    // Claimed row must be "sending" before logout (proves pre-send seam).
    const claimed = await findQueueItem(page, userAId, commandId);
    expect(claimed.found, "claimed outbox row before logout").toBe(true);
    expect(claimed.userId).toBe(userAId);
    expect(claimed.status).toBe("sending");

    await openAccount(page);
    await page.getByRole("button", { name: "Log out" }).click();
    // logout() awaits IndexedDB purge before showing Sign in.
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    // Logout wipes private offline stores — A's command must not linger for B.
    const afterLogout = await findQueueItem(page, userAId, commandId);
    expect(
      afterLogout.found,
      "logout must purge user A outbox (shared-device wipe)",
    ).toBe(false);

    await page.getByLabel("Email").fill(USERS.manager);
    await page.getByLabel("Password").fill("demo1234");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();

    await page.evaluate(() => {
      (window as E2eWindow).__e2eReleaseDrainClaim?.();
    });

    // Deterministic: wait until drain resumes past the gate (abort path).
    await expect
      .poll(async () =>
        page.evaluate(() => (window as E2eWindow).__e2eDrainResumed === true),
      )
      // Chained expectation refining the UI/API assertion.
      .toBe(true);

    expect(
      pushRequests.some((body) => body.includes(commandId)),
      "user A command must not reach /sync/push after account switch",
    ).toBe(false);

    // Bound user B must not inherit A's commandId in the outbox either.
    const userBId = await storedUserId(page);
    const asB = await findQueueItem(page, userBId, commandId);
    expect(asB.found, "user B must not hold user A command").toBe(false);
  });
});
