import "../preloadIsolatedTestEnv";
import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/db";
import { assertTestDatabase } from "../assertTestDatabase";
import { listenApp, closeServer } from "../httpHarness";
import { assertEnv } from "../../src/env";

let api: string;
let server: Awaited<ReturnType<typeof listenApp>>["server"];
const previous = { disabled: process.env.E2E_DISABLE_RATE_LIMIT, proxy: process.env.TRUST_PROXY };
before(async () => {
  await assertTestDatabase(prisma);
  delete process.env.E2E_DISABLE_RATE_LIMIT;
  process.env.TRUST_PROXY = "1";
  ({ api, server } = await listenApp());
});
after(async () => {
  if (server) await closeServer(server);
  for (const [key, value] of [["E2E_DISABLE_RATE_LIMIT", previous.disabled], ["TRUST_PROXY", previous.proxy]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
  await prisma.$disconnect();
});
async function post(path: string, body: unknown, ip: string) {
  return fetch(`${api}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": ip }, body: JSON.stringify(body) });
}
it("P1-93 enabled login limiter shares one normalized email bucket", async () => {
  assert.notEqual(process.env.E2E_DISABLE_RATE_LIMIT, "1");
  const email = `${randomUUID()}@rate.test`;
  for (let i = 0; i < 10; i++) {
    const res = await post("/auth/login", { email: i % 2 ? ` ${email.toUpperCase()} ` : email, password: "wrong" }, "198.51.100.31");
    assert.ok([400, 401].includes(res.status), `attempt ${i + 1}: ${res.status}`);
  }
  assert.equal((await post("/auth/login", { email: email.toUpperCase(), password: "wrong" }, "198.51.100.31")).status, 429);
  assert.equal((await post("/auth/login", { email: `other-${email}`, password: "wrong" }, "198.51.100.31")).status, 401);
  assert.equal((await post("/auth/login", { email, password: "wrong" }, "198.51.100.32")).status, 401);
});
it("P1-94 enabled redeem limiter resets after its real window", async t => {
  assert.notEqual(process.env.E2E_DISABLE_RATE_LIMIT, "1");
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const input = { code: "INVALID-CODE", deviceLabel: "test", fingerprint: "test" };
  try {
    for (let i = 0; i < 20; i++) assert.equal((await post("/invitations/redeem", input, "198.51.100.41")).status, 400);
    assert.equal((await post("/invitations/redeem", input, "198.51.100.41")).status, 429);
    assert.equal((await post("/invitations/redeem", input, "198.51.100.42")).status, 400);
    t.mock.timers.tick(15 * 60 * 1000 + 1);
    assert.equal((await post("/invitations/redeem", input, "198.51.100.41")).status, 400);
  } finally { t.mock.timers.reset(); }
});
it("P1-128 production rejects missing, example and short JWT secrets before listen/jobs", () => {
  const original = {
    secret: process.env.JWT_SECRET,
    mode: process.env.NODE_ENV,
    webOrigin: process.env.WEB_ORIGIN,
    databaseUrl: process.env.DATABASE_URL,
    trustProxy: process.env.TRUST_PROXY,
    cookieSecure: process.env.COOKIE_SECURE,
    rateLimit: process.env.E2E_DISABLE_RATE_LIMIT,
    port: process.env.PORT,
  };
  // Satisfy production checks that run before JWT so this case isolates secrets.
  const productionBase = {
    NODE_ENV: "production",
    WEB_ORIGIN: "https://maintenance.example.com",
    DATABASE_URL: process.env.DATABASE_URL?.startsWith("postgres")
      ? process.env.DATABASE_URL
      : "postgresql://db/maintenance",
    TRUST_PROXY: "1",
    COOKIE_SECURE: "true",
    E2E_DISABLE_RATE_LIMIT: "0",
    // Valid port required: assertEnv validates PORT before JWT_SECRET.
    PORT: "43721",
  };
  try {
    Object.assign(process.env, productionBase);
    for (const secret of ["", "dev-jwt-secret-change-me", "local-dev-only-insecure-secret-do-not-use-in-prod", "too-short"]) {
      process.env.JWT_SECRET = secret;
      assert.throws(assertEnv, /JWT_SECRET/);
      const child = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts"], {
        cwd: process.cwd(), encoding: "utf8", timeout: 10000,
        env: {
          ...process.env,
          ...productionBase,
          JWT_SECRET: secret,
          DOTENV_CONFIG_PATH: "tests/scenarios/nonexistent.env",
        },
      });
      assert.equal(child.status, 1, child.stderr);
      assert.match(child.stderr, /JWT_SECRET/);
      assert.doesNotMatch(child.stdout, /API listening|scheduler started/);
    }
    process.env.JWT_SECRET = "valid-production-secret-32-characters-or-more";
    assert.doesNotThrow(assertEnv);
  } finally {
    for (const [key, value] of [
      ["JWT_SECRET", original.secret],
      ["NODE_ENV", original.mode],
      ["WEB_ORIGIN", original.webOrigin],
      ["DATABASE_URL", original.databaseUrl],
      ["TRUST_PROXY", original.trustProxy],
      ["COOKIE_SECURE", original.cookieSecure],
      ["E2E_DISABLE_RATE_LIMIT", original.rateLimit],
      ["PORT", original.port],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
