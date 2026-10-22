import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertEnv } from "./env";

/** Restore process.env keys changed during a single assertEnv case. */
function withEnv(
  patch: Record<string, string | undefined>,
  run: () => void,
): void {
  const before = { ...process.env };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in before)) delete process.env[key];
    }
    Object.assign(process.env, before);
  }
}

const validProduction = {
  NODE_ENV: "production",
  PORT: "4000",
  JWT_SECRET: "r".repeat(48),
  DATABASE_URL: "postgresql://db/maintenance",
  WEB_ORIGIN: "https://maintenance.example.com",
  TRUST_PROXY: "1",
  E2E_DISABLE_RATE_LIMIT: "0",
  COOKIE_SECURE: "true",
} as const;

describe("environment validation", () => {
  it("rejects test-only rate-limit bypass in production", () => {
    withEnv(
      { ...validProduction, E2E_DISABLE_RATE_LIMIT: "1" },
      () => {
        assert.throws(() => assertEnv(), /E2E_DISABLE_RATE_LIMIT/);
      },
    );
  });

  it("rejects malformed ports", () => {
    withEnv({ NODE_ENV: "test", PORT: "70000", JWT_SECRET: "x" }, () => {
      assert.throws(() => assertEnv(), /PORT must be/);
    });
  });

  it("accepts a complete valid production configuration", () => {
    withEnv({ ...validProduction }, () => {
      assert.doesNotThrow(() => assertEnv());
    });
  });

  const productionRejections: Array<{
    name: string;
    patch: Record<string, string | undefined>;
    message: RegExp;
  }> = [
    {
      name: "missing DATABASE_URL",
      patch: { DATABASE_URL: undefined },
      message: /DATABASE_URL must be a PostgreSQL URL/,
    },
    {
      name: "non-postgres DATABASE_URL",
      patch: { DATABASE_URL: "mysql://db/maintenance" },
      message: /DATABASE_URL must be a PostgreSQL URL/,
    },
    {
      name: "empty WEB_ORIGIN allowlist",
      patch: { WEB_ORIGIN: "" },
      message: /Production WEB_ORIGIN must contain an explicit HTTPS origin allowlist/,
    },
    {
      name: "HTTP WEB_ORIGIN in production",
      patch: { WEB_ORIGIN: "http://maintenance.example.com" },
      message: /Production WEB_ORIGIN must contain an explicit HTTPS origin allowlist/,
    },
    {
      name: "mixed HTTP origin in allowlist",
      patch: {
        WEB_ORIGIN:
          "https://maintenance.example.com,http://insecure.example.com",
      },
      message: /Production WEB_ORIGIN must contain an explicit HTTPS origin allowlist/,
    },
    {
      name: "TRUST_PROXY not set to 1",
      patch: { TRUST_PROXY: "0" },
      message: /Production must set TRUST_PROXY=1/,
    },
    {
      name: "JWT_SECRET containing demo",
      patch: { JWT_SECRET: `demo-${"r".repeat(48)}` },
      message: /JWT_SECRET cannot contain demo/,
    },
    {
      name: "COOKIE_SECURE=false",
      patch: { COOKIE_SECURE: "false" },
      message: /COOKIE_SECURE=false cannot be used in production/,
    },
  ];

  for (const { name, patch, message } of productionRejections) {
    it(`rejects production misconfiguration: ${name}`, () => {
      withEnv({ ...validProduction, ...patch }, () => {
        assert.throws(() => assertEnv(), message);
      });
    });
  }
});
