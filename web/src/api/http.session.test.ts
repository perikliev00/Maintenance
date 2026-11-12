import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { fetchMe, login, logoutAll, refreshAccessToken } from "./http";

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
// Test lifecycle hook.
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

// Iterate collection / range.
for (const status of [401, 503]) {
it(`logout-all ${status} rejects, wipes local state, and serializes a following login`, async () => {
  const values = new Map<string, string>([["user", '{"id":"A"}']]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k),
  } });
  let release!: (res: Response) => void;
  const held = new Promise<Response>(resolve => { release = resolve; });
  const calls: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input); calls.push(url);
    if (url.endsWith("/logout-all")) return held;
    if (url.endsWith("/logout")) return new Response('{"ok":true}');
    return new Response('{"user":{"id":"B"}}');
  };
  const logout = logoutAll();
  await Promise.resolve(); await Promise.resolve();
  const rejected = assert.rejects(logout, /temporary failure/);
  const nextLogin = login("B@test.local", "password");
  assert.equal(calls.some(url => url.endsWith("/login")), false);
  release(new Response('{"message":"temporary failure"}', { status }));
  await rejected; await nextLogin;
  assert.deepEqual(JSON.parse(values.get("user")!), { id: "B" });
  assert.deepEqual(calls.map(url => url.split("/").at(-1)), ["logout-all", "logout", "login"]);
});
}

// Iterate collection / range.
for (const status of [200, 401]) {
  it(`stale refresh ${status} cannot update or clear the next login`, async () => {
    const values = new Map<string, string>([["user", JSON.stringify({ id: "A" })]]);
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    } });
    let release!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { release = resolve; });
    let refreshes = 0;
    let logins = 0;
    globalThis.fetch = async input => {
      if (String(input).endsWith("/auth/refresh")) {
        // Continue module logic.
        refreshes++;
        if (refreshes === 1) return pending;
        return new Response("{}", { status: 200 });
      }
      // Continue module logic.
      logins++;
      return new Response(JSON.stringify({ user: { id: "B" } }), { status: 200 });
    };
    const stale = refreshAccessToken();
    const nextLogin = login("B@example.test", "password");
    assert.equal(logins, 0, "new cookie login must wait for the old refresh response");
    assert.equal(await refreshAccessToken(), "rejected", "no new cookie rotation during account transition");
    assert.equal(refreshes, 1);
    release(new Response("{}", { status }));
    assert.equal(await stale, "rejected");
    await nextLogin;
    assert.equal(logins, 1);
    assert.deepEqual(JSON.parse(values.get("user")!), { id: "B" });
    assert.equal(await refreshAccessToken(), "refreshed");
    assert.equal(refreshes, 2, "new login must not reuse old refresh promise");
  });
}

it("delayed profile A cannot replace the cached profile after login B", async () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  let release!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  globalThis.fetch = async input => String(input).endsWith("/auth/me") ? pending : new Response(JSON.stringify({ user: { id: "B" } }));
  const profile = fetchMe();
  const rejected = assert.rejects(profile, /Account changed/);
  await login("B@example.test", "password");
  release(new Response(JSON.stringify({ id: "A" })));
  await rejected;
  assert.deepEqual(JSON.parse(values.get("user")!), { id: "B" });
});

it("fetchMe started during login cannot restore prior account after cookies switch", async () => {
  const values = new Map<string, string>([["user", JSON.stringify({ id: "A" })]]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  let releaseLogin!: (response: Response) => void;
  let releaseMe!: (response: Response) => void;
  const pendingLogin = new Promise<Response>(resolve => { releaseLogin = resolve; });
  const pendingMe = new Promise<Response>(resolve => { releaseMe = resolve; });
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith("/auth/login")) return pendingLogin;
    if (url.endsWith("/auth/me")) return pendingMe;
    return new Response("{}", { status: 200 });
  };
  const nextLogin = login("B@example.test", "password");
  await Promise.resolve();
  await Promise.resolve();
  // Same sessionRevision as the in-flight login (after beginSessionChange).
  const staleProfile = fetchMe();
  const rejected = assert.rejects(staleProfile, /Account changed/);
  releaseLogin(new Response(JSON.stringify({ user: { id: "B" } }), { status: 200 }));
  await nextLogin;
  assert.deepEqual(JSON.parse(values.get("user")!), { id: "B" });
  releaseMe(new Response(JSON.stringify({ id: "A" }), { status: 200 }));
  await rejected;
  assert.deepEqual(JSON.parse(values.get("user")!), { id: "B" });
});
