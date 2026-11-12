// Import dependency used by this module.
import assert from "node:assert/strict";
// Import dependency used by this module.
import { afterEach, it } from "node:test";
// Import dependency used by this module.
import { fetchMe, login, logoutAll, refreshAccessToken } from "./http";

// Local constant binding.
const originalFetch = globalThis.fetch;
// Local constant binding.
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
// Test lifecycle hook.
afterEach(() => {
  // Assign value for subsequent use.
  globalThis.fetch = originalFetch;
  // Conditional branch for this case.
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  // Fallback branch when prior checks fail.
  else Reflect.deleteProperty(globalThis, "localStorage");
});

// Iterate collection / range.
for (const status of [401, 503]) {
// Unit test case.
it(`logout-all ${status} rejects, wipes local state, and serializes a following login`, async () => {
  // Local constant binding.
  const values = new Map<string, string>([["user", '{"id":"A"}']]);
  // Open multi-line construct.
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    // Arrow function / callback body.
    getItem: (k: string) => values.get(k) ?? null,
    // Arrow function / callback body.
    setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k),
  // Close multi-line construct with trailing syntax.
  } });
  // Mutable local binding.
  let release!: (res: Response) => void;
  // Local constant binding.
  const held = new Promise<Response>(resolve => { release = resolve; });
  // Local constant binding.
  const calls: string[] = [];
  // Arrow function / callback body.
  globalThis.fetch = async input => {
    // Local constant binding.
    const url = String(input); calls.push(url);
    // Conditional branch for this case.
    if (url.endsWith("/logout-all")) return held;
    // Conditional branch for this case.
    if (url.endsWith("/logout")) return new Response('{"ok":true}');
    // Return computed result to caller.
    return new Response('{"user":{"id":"B"}}');
  };
  // Local constant binding.
  const logout = logoutAll();
  // Await async work before continuing.
  await Promise.resolve(); await Promise.resolve();
  // Local constant binding.
  const rejected = assert.rejects(logout, /temporary failure/);
  // Local constant binding.
  const nextLogin = login("B@test.local", "password");
  // Assert expected test outcome.
  assert.equal(calls.some(url => url.endsWith("/login")), false);
  // Invoke helper or pass arguments.
  release(new Response('{"message":"temporary failure"}', { status }));
  // Await async work before continuing.
  await rejected; await nextLogin;
  // Assert expected test outcome.
  assert.deepEqual(JSON.parse(values.get("user")!), { id: "B" });
  // Assert expected test outcome.
  assert.deepEqual(calls.map(url => url.split("/").at(-1)), ["logout-all", "logout", "login"]);
});
}

// Iterate collection / range.
for (const status of [200, 401]) {
  // Unit test case.
  it(`stale refresh ${status} cannot update or clear the next login`, async () => {
    // Local constant binding.
    const values = new Map<string, string>([["user", JSON.stringify({ id: "A" })]]);
    // Open multi-line construct.
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      // Arrow function / callback body.
      getItem: (key: string) => values.get(key) ?? null,
      // Arrow function / callback body.
      setItem: (key: string, value: string) => values.set(key, value),
      // Arrow function / callback body.
      removeItem: (key: string) => values.delete(key),
    // Close multi-line construct with trailing syntax.
    } });
    // Mutable local binding.
    let release!: (response: Response) => void;
    // Local constant binding.
    const pending = new Promise<Response>(resolve => { release = resolve; });
    // Mutable local binding.
    let refreshes = 0;
    // Mutable local binding.
    let logins = 0;
    // Arrow function / callback body.
    globalThis.fetch = async input => {
      // Conditional branch for this case.
      if (String(input).endsWith("/auth/refresh")) {
        // Continue module logic.
        refreshes++;
        // Conditional branch for this case.
        if (refreshes === 1) return pending;
        // Return computed result to caller.
        return new Response("{}", { status: 200 });
      }
      // Continue module logic.
      logins++;
      // Return computed result to caller.
      return new Response(JSON.stringify({ user: { id: "B" } }), { status: 200 });
    };
    // Local constant binding.
    const stale = refreshAccessToken();
    // Local constant binding.
    const nextLogin = login("B@example.test", "password");
    // Assert expected test outcome.
    assert.equal(logins, 0, "new cookie login must wait for the old refresh response");
    // Assert expected test outcome.
    assert.equal(await refreshAccessToken(), "rejected", "no new cookie rotation during account transition");
    // Assert expected test outcome.
    assert.equal(refreshes, 1);
    // Invoke helper or pass arguments.
    release(new Response("{}", { status }));
    // Assert expected test outcome.
    assert.equal(await stale, "rejected");
    // Await async work before continuing.
    await nextLogin;
    // Assert expected test outcome.
    assert.equal(logins, 1);
    // Assert expected test outcome.
    assert.deepEqual(JSON.parse(values.get("user")!), { id: "B" });
    // Assert expected test outcome.
    assert.equal(await refreshAccessToken(), "refreshed");
    // Assert expected test outcome.
    assert.equal(refreshes, 2, "new login must not reuse old refresh promise");
  });
}

// Unit test case.
it("delayed profile A cannot replace the cached profile after login B", async () => {
  // Local constant binding.
  const values = new Map<string, string>();
  // Open multi-line construct.
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    // Arrow function / callback body.
    getItem: (key: string) => values.get(key) ?? null,
    // Arrow function / callback body.
    setItem: (key: string, value: string) => values.set(key, value),
  // Close multi-line construct with trailing syntax.
  } });
  // Mutable local binding.
  let release!: (response: Response) => void;
  // Local constant binding.
  const pending = new Promise<Response>(resolve => { release = resolve; });
  // Arrow function / callback body.
  globalThis.fetch = async input => String(input).endsWith("/auth/me") ? pending : new Response(JSON.stringify({ user: { id: "B" } }));
  // Local constant binding.
  const profile = fetchMe();
  // Local constant binding.
  const rejected = assert.rejects(profile, /Account changed/);
  // Await async work before continuing.
  await login("B@example.test", "password");
  // Invoke helper or pass arguments.
  release(new Response(JSON.stringify({ id: "A" })));
  // Await async work before continuing.
  await rejected;
  // Assert expected test outcome.
  assert.deepEqual(JSON.parse(values.get("user")!), { id: "B" });
});

// Unit test case.
it("fetchMe started during login cannot restore prior account after cookies switch", async () => {
  // Local constant binding.
  const values = new Map<string, string>([["user", JSON.stringify({ id: "A" })]]);
  // Open multi-line construct.
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    // Arrow function / callback body.
    getItem: (key: string) => values.get(key) ?? null,
    // Arrow function / callback body.
    setItem: (key: string, value: string) => values.set(key, value),
    // Arrow function / callback body.
    removeItem: (key: string) => values.delete(key),
  // Close multi-line construct with trailing syntax.
  } });
  // Mutable local binding.
  let releaseLogin!: (response: Response) => void;
  // Mutable local binding.
  let releaseMe!: (response: Response) => void;
  // Local constant binding.
  const pendingLogin = new Promise<Response>(resolve => { releaseLogin = resolve; });
  // Local constant binding.
  const pendingMe = new Promise<Response>(resolve => { releaseMe = resolve; });
  // Arrow function / callback body.
  globalThis.fetch = async input => {
    // Local constant binding.
    const url = String(input);
    // Conditional branch for this case.
    if (url.endsWith("/auth/login")) return pendingLogin;
    // Conditional branch for this case.
    if (url.endsWith("/auth/me")) return pendingMe;
    // Return computed result to caller.
    return new Response("{}", { status: 200 });
  };
  // Local constant binding.
  const nextLogin = login("B@example.test", "password");
  // Await async work before continuing.
  await Promise.resolve();
  // Await async work before continuing.
  await Promise.resolve();
  // Same sessionRevision as the in-flight login (after beginSessionChange).
  const staleProfile = fetchMe();
  // Local constant binding.
  const rejected = assert.rejects(staleProfile, /Account changed/);
  // Invoke helper or pass arguments.
  releaseLogin(new Response(JSON.stringify({ user: { id: "B" } }), { status: 200 }));
  // Await async work before continuing.
  await nextLogin;
  // Assert expected test outcome.
  assert.deepEqual(JSON.parse(values.get("user")!), { id: "B" });
  // Invoke helper or pass arguments.
  releaseMe(new Response(JSON.stringify({ id: "A" }), { status: 200 }));
  // Await async work before continuing.
  await rejected;
  // Assert expected test outcome.
  assert.deepEqual(JSON.parse(values.get("user")!), { id: "B" });
});
