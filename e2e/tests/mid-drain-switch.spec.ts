import { expect, test, type Page } from "@playwright/test";
import { storedUserId, uiLogin, USERS } from "./helpers/auth";

type E2eWindow = Window & {
  __MERIDIAN_E2E_AFTER_DRAIN_CLAIM__?: () => void | Promise<void>;
  __e2eReleaseDrainClaim?: () => void;
};

async function seedPendingQueue(page: Page, userId: string): Promise<string> {
  return page.evaluate(async (uid) => {
    const commandId = crypto.randomUUID();
    const item = {
      id: crypto.randomUUID(),
      userId: uid,
      commandId,
      type: "cleaning.start",
      url: `/api/cleaning/tasks/${crypto.randomUUID()}/start`,
      method: "POST" as const,
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

/**
 * P0-10 / T-DRAIN-01 (browser): after outbox claim, logout+login as another
 * user must abort before /sync/push so user A's command never leaves the tab.
 */
test.describe("mid-drain account switch", () => {
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
      w.__MERIDIAN_E2E_AFTER_DRAIN_CLAIM__ = () => gate;
      w.__e2eReleaseDrainClaim = () => {
        release();
        delete w.__MERIDIAN_E2E_AFTER_DRAIN_CLAIM__;
      };
    });

    // Kick drain while the after-claim gate is held.
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    // Wait until drain has claimed (hook installed and drain entered it).
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            typeof (window as E2eWindow).__e2eReleaseDrainClaim === "function",
        ),
      )
      .toBe(true);

    // Small beat so drain is blocked inside the hook (not still listing IDB).
    await page.waitForTimeout(200);

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    await page.getByLabel("Email").fill(USERS.manager);
    await page.getByLabel("Password").fill("demo1234");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();

    await page.evaluate(() => {
      (window as E2eWindow).__e2eReleaseDrainClaim?.();
    });

    // Give a drained abort a moment; push must never have fired with A's command.
    await page.waitForTimeout(500);
    expect(
      pushRequests.some((body) => body.includes(commandId)),
      "user A command must not reach /sync/push after account switch",
    ).toBe(false);
  });
});
