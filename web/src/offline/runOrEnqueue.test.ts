// Import dependency used by this module.
import assert from "node:assert/strict";
// Import dependency used by this module.
import { it } from "node:test";
// Import dependency used by this module.
import { startCleaningQueued } from "./runOrEnqueue";
// Import dependency used by this module.
import { setOfflineUser, whenOfflineUserSettled } from "./userScope";

// Unit test case.
it("online queueable action does not retry or enqueue under B after A's pending refresh", async () => {
  // Local constant binding.
  const originalFetch = globalThis.fetch;
  // Local constant binding.
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  // Local constant binding.
  const originalOnline = navigator.onLine;
  // Invoke helper or pass arguments.
  Object.defineProperty(globalThis, "document", { configurable: true, value: { cookie: "" } });
  // Invoke helper or pass arguments.
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  // Invoke helper or pass arguments.
  setOfflineUser("A");
  // Await async work before continuing.
  await whenOfflineUserSettled();
  // Invoke helper or pass arguments.
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  // Mutable local binding.
  let enter!: () => void;
  // Local constant binding.
  const entered = new Promise<void>(resolve => { enter = resolve; });
  // Mutable local binding.
  let finish!: (response: Response) => void;
  // Local constant binding.
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  // Mutable local binding.
  let actionRequests = 0;
  // Arrow function / callback body.
  globalThis.fetch = async (input, init) => {
    // Conditional branch for this case.
    if (String(input).endsWith("/auth/refresh")) { enter(); return pending; }
    // Continue module logic.
    actionRequests++;
    // Assert expected test outcome.
    assert.equal(new Headers(init?.headers).get("X-Offline-User"), "A");
    // Return computed result to caller.
    return new Response("{}", { status: 401 });
  };
  // Guard fallible work.
  try {
    // Local constant binding.
    const action = startCleaningQueued("task-A", 1);
    // Local constant binding.
    const rejected = assert.rejects(action, (err: unknown) => (err as { status: number; code: string }).status === 409 && (err as { code: string }).code === "identity_changed");
    // Await async work before continuing.
    await entered;
    // Invoke helper or pass arguments.
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    // Invoke helper or pass arguments.
    setOfflineUser("B");
    // Await async work before continuing.
    await whenOfflineUserSettled();
    // Invoke helper or pass arguments.
    finish(new Response("{}", { status: 200 }));
    // Await async work before continuing.
    await rejected;
    // Assert expected test outcome.
    assert.equal(actionRequests, 1, "no second POST under B and no successful enqueue fallback");
  // Open multi-line construct.
  } finally {
    // Assign value for subsequent use.
    globalThis.fetch = originalFetch;
    // Conditional branch for this case.
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    // Fallback branch when prior checks fail.
    else Reflect.deleteProperty(globalThis, "document");
    // Invoke helper or pass arguments.
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    // Invoke helper or pass arguments.
    setOfflineUser(null);
    // Await async work before continuing.
    await whenOfflineUserSettled();
    // Invoke helper or pass arguments.
    Object.defineProperty(navigator, "onLine", { configurable: true, value: originalOnline });
  }
});
