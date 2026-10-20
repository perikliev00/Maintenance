import assert from "node:assert/strict";
import { it } from "node:test";
import { startCleaningQueued } from "./runOrEnqueue";
import { setOfflineUser, whenOfflineUserSettled } from "./userScope";

it("P0-10 online queueable action does not retry or enqueue under B after A's pending refresh", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalOnline = navigator.onLine;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { cookie: "" } });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  setOfflineUser("A");
  await whenOfflineUserSettled();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  let enter!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  let actionRequests = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith("/auth/refresh")) { enter(); return pending; }
    actionRequests++;
    assert.equal(new Headers(init?.headers).get("X-Offline-User"), "A");
    return new Response("{}", { status: 401 });
  };
  try {
    const action = startCleaningQueued("task-A", 1);
    const rejected = assert.rejects(action, (err: unknown) => (err as { status: number; code: string }).status === 409 && (err as { code: string }).code === "identity_changed");
    await entered;
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    setOfflineUser("B");
    await whenOfflineUserSettled();
    finish(new Response("{}", { status: 200 }));
    await rejected;
    assert.equal(actionRequests, 1, "no second POST under B and no successful enqueue fallback");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    setOfflineUser(null);
    await whenOfflineUserSettled();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: originalOnline });
  }
});
