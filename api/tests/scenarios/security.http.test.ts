// Load isolated P1 test env before any Prisma/DB clients connect.
import "../preloadIsolatedTestEnv";
// Node test runner and strict assertions for API suite checks.
import assert from "node:assert/strict";
// Node test runner and strict assertions for API suite checks.
import { after, before, it } from "node:test";
// Import bindings from node:child_process.
import { spawnSync } from "node:child_process";
// Import bindings from node:crypto.
import { randomUUID } from "node:crypto";
// Import bindings from ../../src/db.
import { prisma } from "../../src/db";
// Guard that mutating suites only run against the isolated test database.
import { assertTestDatabase } from "../assertTestDatabase";
// HTTP harness to listen an in-process API for request-level tests.
import { listenApp, closeServer } from "../httpHarness";
// Import bindings from ../../src/env.
import { assertEnv } from "../../src/env";

// Execute the next setup or assertion step for this scenario.
let api: string;
// Execute the next setup or assertion step for this scenario.
let server: Awaited<ReturnType<typeof listenApp>>["server"];
// Bind previous for later setup or assertions in this scope.
const previous = { disabled: process.env.E2E_DISABLE_RATE_LIMIT, proxy: process.env.TRUST_PROXY };
// Arrange shared preconditions before cases run.
before(async () => {
  // Refuse to mutate unless connected to the isolated test database.
  await assertTestDatabase(prisma);
  // Override env for isolation, rate-limit disable, or scheduler quieting.
  delete process.env.E2E_DISABLE_RATE_LIMIT;
  // Override env for isolation, rate-limit disable, or scheduler quieting.
  process.env.TRUST_PROXY = "1";
  // Start or stop the in-process API server for this suite.
  ({ api, server } = await listenApp());
});
// Release servers/DB clients so later suites stay isolated.
after(async () => {
  // Guard optional cleanup or alternate assertion paths.
  if (server) await closeServer(server);
  // Iterate to cover variants or wait until a condition holds.
  for (const [key, value] of [["E2E_DISABLE_RATE_LIMIT", previous.disabled], ["TRUST_PROXY", previous.proxy]]) {
    // Branch on env so isolation settings win over ambient config.
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
  // Disconnect Prisma so the pool does not leak across suites.
  await prisma.$disconnect();
});
// Local helper post used by cases in this file.
async function post(path: string, body: unknown, ip: string) {
  // Return the arranged value/result to the caller.
  return fetch(`${api}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": ip }, body: JSON.stringify(body) });
}
// Case: enabled login limiter shares one normalized email bucket.
it("enabled login limiter shares one normalized email bucket", async () => {
  // Assert the observed value matches the intended post-condition.
  assert.notEqual(process.env.E2E_DISABLE_RATE_LIMIT, "1");
  // email: unique stamp so parallel runs do not collide.
  const email = `${randomUUID()}@rate.test`;
  // Repeat/poll to widen the race window or wait for lock waiters.
  for (let i = 0; i < 10; i++) {
    // res: HTTP response captured for status/body checks.
    const res = await post("/auth/login", { email: i % 2 ? ` ${email.toUpperCase()} ` : email, password: "wrong" }, "198.51.100.31");
    // Assert HTTP status matches the contract for this path.
    assert.ok([400, 401].includes(res.status), `attempt ${i + 1}: ${res.status}`);
  }
  // Assert HTTP status matches the contract for this path.
  assert.equal((await post("/auth/login", { email: email.toUpperCase(), password: "wrong" }, "198.51.100.31")).status, 429);
  // Assert HTTP status matches the contract for this path.
  assert.equal((await post("/auth/login", { email: `other-${email}`, password: "wrong" }, "198.51.100.31")).status, 401);
  // Assert HTTP status matches the contract for this path.
  assert.equal((await post("/auth/login", { email, password: "wrong" }, "198.51.100.32")).status, 401);
});
// Case: enabled redeem limiter resets after its real window.
it("enabled redeem limiter resets after its real window", async t => {
  // Assert the observed value matches the intended post-condition.
  assert.notEqual(process.env.E2E_DISABLE_RATE_LIMIT, "1");
  // Execute the next setup or assertion step for this scenario.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  // Bind input for later setup or assertions in this scope.
  const input = { code: "INVALID-CODE", deviceLabel: "test", fingerprint: "test" };
  // Try path where partial failure must not leak suite state.
  try {
    // Assert HTTP status matches the contract for this path.
    for (let i = 0; i < 20; i++) assert.equal((await post("/invitations/redeem", input, "198.51.100.41")).status, 400);
    // Assert HTTP status matches the contract for this path.
    assert.equal((await post("/invitations/redeem", input, "198.51.100.41")).status, 429);
    // Assert HTTP status matches the contract for this path.
    assert.equal((await post("/invitations/redeem", input, "198.51.100.42")).status, 400);
    // Execute the next setup or assertion step for this scenario.
    t.mock.timers.tick(15 * 60 * 1000 + 1);
    // Assert HTTP status matches the contract for this path.
    assert.equal((await post("/invitations/redeem", input, "198.51.100.41")).status, 400);
  // Execute the next setup or assertion step for this scenario.
  } finally { t.mock.timers.reset(); }
});
// Case: production rejects missing, example and short JWT secrets before listen/jobs.
it("production rejects missing, example and short JWT secrets before listen/jobs", () => {
  // Bind original for later setup or assertions in this scope.
  const original = {
    // Override env for isolation, rate-limit disable, or scheduler quieting.
    secret: process.env.JWT_SECRET,
    // Override env for isolation, rate-limit disable, or scheduler quieting.
    mode: process.env.NODE_ENV,
    // Override env for isolation, rate-limit disable, or scheduler quieting.
    webOrigin: process.env.WEB_ORIGIN,
    // Override env for isolation, rate-limit disable, or scheduler quieting.
    databaseUrl: process.env.DATABASE_URL,
    // Override env for isolation, rate-limit disable, or scheduler quieting.
    trustProxy: process.env.TRUST_PROXY,
    // Override env for isolation, rate-limit disable, or scheduler quieting.
    cookieSecure: process.env.COOKIE_SECURE,
    // Override env for isolation, rate-limit disable, or scheduler quieting.
    rateLimit: process.env.E2E_DISABLE_RATE_LIMIT,
    // Override env for isolation, rate-limit disable, or scheduler quieting.
    port: process.env.PORT,
  };
  // Satisfy production checks that run before JWT so this case isolates secrets.
  const productionBase = {
    // Execute the next setup or assertion step for this scenario.
    NODE_ENV: "production",
    // Execute the next setup or assertion step for this scenario.
    WEB_ORIGIN: "https://maintenance.example.com",
    // Override env for isolation, rate-limit disable, or scheduler quieting.
    DATABASE_URL: process.env.DATABASE_URL?.startsWith("postgres")
      // Override env for isolation, rate-limit disable, or scheduler quieting.
      ? process.env.DATABASE_URL
      : "postgresql://db/maintenance",
    // Execute the next setup or assertion step for this scenario.
    TRUST_PROXY: "1",
    // Session/CSRF step exercising auth lifecycle.
    COOKIE_SECURE: "true",
    // Pagination step for list/contract coverage.
    E2E_DISABLE_RATE_LIMIT: "0",
    // Valid port required: assertEnv validates PORT before JWT_SECRET.
    PORT: "43721",
  };
  // Try path where partial failure must not leak suite state.
  try {
    // Execute the next setup or assertion step for this scenario.
    Object.assign(process.env, productionBase);
    // Iterate to cover variants or wait until a condition holds.
    for (const secret of ["", "dev-jwt-secret-change-me", "local-dev-only-insecure-secret-do-not-use-in-prod", "too-short"]) {
      // Override env for isolation, rate-limit disable, or scheduler quieting.
      process.env.JWT_SECRET = secret;
      // Assert the observed value matches the intended post-condition.
      assert.throws(assertEnv, /JWT_SECRET/);
      // Bind child for later setup or assertions in this scope.
      const child = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts"], {
        // Runner option controlling stability or isolation of the suite.
        cwd: process.cwd(), encoding: "utf8", timeout: 10000,
        // Configure env for the request/server under test.
        env: {
          // Continue the call chain for setup or assertion detail.
          ...process.env,
          // Continue the call chain for setup or assertion detail.
          ...productionBase,
          // Execute the next setup or assertion step for this scenario.
          JWT_SECRET: secret,
          // Execute the next setup or assertion step for this scenario.
          DOTENV_CONFIG_PATH: "tests/scenarios/nonexistent.env",
        },
      });
      // Assert HTTP status matches the contract for this path.
      assert.equal(child.status, 1, child.stderr);
      // Assert the observed value matches the intended post-condition.
      assert.match(child.stderr, /JWT_SECRET/);
      // Delivery/replay step for async notification paths.
      assert.doesNotMatch(child.stdout, /API listening|scheduler started/);
    }
    // Override env for isolation, rate-limit disable, or scheduler quieting.
    process.env.JWT_SECRET = "valid-production-secret-32-characters-or-more";
    // Delivery/replay step for async notification paths.
    assert.doesNotThrow(assertEnv);
  // Execute the next setup or assertion step for this scenario.
  } finally {
    // Iterate to cover variants or wait until a condition holds.
    for (const [key, value] of [
      // Execute the next setup or assertion step for this scenario.
      ["JWT_SECRET", original.secret],
      // Execute the next setup or assertion step for this scenario.
      ["NODE_ENV", original.mode],
      // Execute the next setup or assertion step for this scenario.
      ["WEB_ORIGIN", original.webOrigin],
      // Execute the next setup or assertion step for this scenario.
      ["DATABASE_URL", original.databaseUrl],
      // Execute the next setup or assertion step for this scenario.
      ["TRUST_PROXY", original.trustProxy],
      // Session/CSRF step exercising auth lifecycle.
      ["COOKIE_SECURE", original.cookieSecure],
      // Pagination step for list/contract coverage.
      ["E2E_DISABLE_RATE_LIMIT", original.rateLimit],
      // Execute the next setup or assertion step for this scenario.
      ["PORT", original.port],
    // Execute the next setup or assertion step for this scenario.
    ] as const) {
      // Branch on env so isolation settings win over ambient config.
      if (value === undefined) delete process.env[key];
      // Execute the next setup or assertion step for this scenario.
      else process.env[key] = value;
    }
  }
});
