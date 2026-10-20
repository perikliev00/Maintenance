import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { fetchMe, login, refreshAccessToken } from "./http";

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

for (const status of [200, 401]) {
  it(`P0-10 stale refresh ${status} cannot update or clear the next login`, async () => {
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
        refreshes++;
        if (refreshes === 1) return pending;
        return new Response("{}", { status: 200 });
      }
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

it("P0-10 delayed profile A cannot replace the cached profile after login B", async () => {
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
