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

  it("rejects DISABLE_JOB_SCHEDULER in production", () => {
    withEnv(
      { ...validProduction, DISABLE_JOB_SCHEDULER: "1" },
      () => {
        assert.throws(() => assertEnv(), /DISABLE_JOB_SCHEDULER/);
      },
    );
  });

  it("rejects DISABLE_JOB_SCHEDULER when APP_ENV=staging (even if NODE_ENV=development)", () => {
    withEnv(
      {
        NODE_ENV: "development",
        PORT: "4000",
        JWT_SECRET: "r".repeat(48),
        DISABLE_JOB_SCHEDULER: "1",
        APP_ENV: "staging",
        DEPLOY_ENV: undefined,
        ENVIRONMENT: undefined,
        RELEASE_SHA: undefined,
      },
      () => {
        assert.throws(() => assertEnv(), /staging\/production/);
      },
    );
  });

  it("rejects DISABLE_JOB_SCHEDULER when DEPLOY_ENV=staging alone", () => {
    withEnv(
      {
        NODE_ENV: "development",
        PORT: "4000",
        JWT_SECRET: "r".repeat(48),
        DISABLE_JOB_SCHEDULER: "1",
        APP_ENV: undefined,
        DEPLOY_ENV: "staging",
        ENVIRONMENT: undefined,
        RELEASE_SHA: undefined,
      },
      () => {
        assert.throws(() => assertEnv(), /staging\/production/);
      },
    );
  });

  it("rejects DISABLE_JOB_SCHEDULER when ENVIRONMENT=prod alone", () => {
    withEnv(
      {
        NODE_ENV: "development",
        PORT: "4000",
        JWT_SECRET: "r".repeat(48),
        DISABLE_JOB_SCHEDULER: "1",
        APP_ENV: undefined,
        DEPLOY_ENV: undefined,
        ENVIRONMENT: "prod",
        RELEASE_SHA: undefined,
      },
      () => {
        assert.throws(() => assertEnv(), /staging\/production/);
      },
    );
  });

  it("rejects when APP_ENV=development but DEPLOY_ENV=staging (any-of)", () => {
    withEnv(
      {
        NODE_ENV: "development",
        PORT: "4000",
        JWT_SECRET: "r".repeat(48),
        DISABLE_JOB_SCHEDULER: "1",
        APP_ENV: "development",
        DEPLOY_ENV: "staging",
        ENVIRONMENT: undefined,
        RELEASE_SHA: undefined,
      },
      () => {
        assert.throws(() => assertEnv(), /staging\/production/);
      },
    );
  });

  it("rejects when APP_ENV is empty string but DEPLOY_ENV=staging", () => {
    withEnv(
      {
        NODE_ENV: "development",
        PORT: "4000",
        JWT_SECRET: "r".repeat(48),
        DISABLE_JOB_SCHEDULER: "1",
        APP_ENV: "",
        DEPLOY_ENV: "staging",
        ENVIRONMENT: undefined,
        RELEASE_SHA: undefined,
      },
      () => {
        assert.throws(() => assertEnv(), /staging\/production/);
      },
    );
  });

  for (const alias of [
    "stage",
    "stg",
    "preprod",
    "uat",
    "production",
    "live",
    "qa",
    "prd",
    "production-eu",
    "staging-1",
  ] as const) {
    it(`rejects DISABLE_JOB_SCHEDULER for non-local APP_ENV=${alias}`, () => {
      withEnv(
        {
          NODE_ENV: "development",
          PORT: "4000",
          JWT_SECRET: "r".repeat(48),
          DISABLE_JOB_SCHEDULER: "1",
          APP_ENV: alias,
          DEPLOY_ENV: undefined,
          ENVIRONMENT: undefined,
          RELEASE_SHA: undefined,
        },
        () => {
          assert.throws(() => assertEnv(), /staging\/production/);
        },
      );
    });
  }

  it("rejects APP_ENV=Production (case normalization)", () => {
    withEnv(
      {
        NODE_ENV: "development",
        PORT: "4000",
        JWT_SECRET: "r".repeat(48),
        DISABLE_JOB_SCHEDULER: "1",
        APP_ENV: "Production",
        DEPLOY_ENV: undefined,
        ENVIRONMENT: undefined,
        RELEASE_SHA: undefined,
      },
      () => {
        assert.throws(() => assertEnv(), /staging\/production/);
      },
    );
  });

  it("rejects APP_ENV with surrounding whitespace (trim)", () => {
    withEnv(
      {
        NODE_ENV: "development",
        PORT: "4000",
        JWT_SECRET: "r".repeat(48),
        DISABLE_JOB_SCHEDULER: "1",
        APP_ENV: " Staging ",
        DEPLOY_ENV: undefined,
        ENVIRONMENT: undefined,
        RELEASE_SHA: undefined,
      },
      () => {
        assert.throws(() => assertEnv(), /staging\/production/);
      },
    );
  });

  it("rejects DISABLE_JOB_SCHEDULER when RELEASE_SHA is set (deployed image)", () => {
    withEnv(
      {
        NODE_ENV: "development",
        PORT: "4000",
        JWT_SECRET: "r".repeat(48),
        DISABLE_JOB_SCHEDULER: "1",
        APP_ENV: undefined,
        DEPLOY_ENV: undefined,
        ENVIRONMENT: undefined,
        RELEASE_SHA: "abc123",
      },
      () => {
        assert.throws(() => assertEnv(), /RELEASE_SHA/);
      },
    );
  });

  it("allows DISABLE_JOB_SCHEDULER in local development without deploy markers", () => {
    withEnv(
      {
        NODE_ENV: "development",
        PORT: "4000",
        JWT_SECRET: "r".repeat(48),
        DISABLE_JOB_SCHEDULER: "1",
        APP_ENV: undefined,
        DEPLOY_ENV: undefined,
        ENVIRONMENT: undefined,
        RELEASE_SHA: undefined,
      },
      () => {
        assert.doesNotThrow(() => assertEnv());
      },
    );
  });

  it("allows DISABLE_JOB_SCHEDULER when APP_ENV is explicitly development", () => {
    withEnv(
      {
        NODE_ENV: "development",
        PORT: "4000",
        JWT_SECRET: "r".repeat(48),
        DISABLE_JOB_SCHEDULER: "1",
        APP_ENV: "development",
        DEPLOY_ENV: undefined,
        ENVIRONMENT: undefined,
        RELEASE_SHA: undefined,
      },
      () => {
        assert.doesNotThrow(() => assertEnv());
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
