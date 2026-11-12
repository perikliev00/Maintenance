// Strict assertions for assertEnv allow/deny matrix.
import assert from "node:assert/strict";
// Node test runner suite helpers.
import { describe, it } from "node:test";
// Environment validator under test.
import { assertEnv } from "./env";

/** Restore process.env keys changed during a single assertEnv case. */
function withEnv(
  // Provide patch field used by this structure.
  patch: Record<string, string | undefined>,
  // Provide run field used by this structure.
  run: () => void,
// Support the surrounding logic for this step.
): void {
  // Snapshot the full env so we can restore after the case.
  const before = { ...process.env };
  // Apply the case-specific overlay (undefined deletes the key).
  for (const [key, value] of Object.entries(patch)) {
    // Conditional branch for the case described by this guard.
    if (value === undefined) delete process.env[key];
    // Fallback branch when earlier conditions were false.
    else process.env[key] = value;
  }
  // Begin guarded block to catch runtime failures.
  try {
    // Invoke run to perform this step.
    run();
  // Support the surrounding logic for this step.
  } finally {
    // Drop keys introduced during the case.
    for (const key of Object.keys(process.env)) {
      // Conditional branch for the case described by this guard.
      if (!(key in before)) delete process.env[key];
    }
    // Restore prior values for keys that existed before.
    Object.assign(process.env, before);
  }
}

// Minimal production-passing baseline reused by rejection cases.
const validProduction = {
  // Provide NODE_ENV field used by this structure.
  NODE_ENV: "production",
  // Provide PORT field used by this structure.
  PORT: "4000",
  // Provide JWT_SECRET field used by this structure.
  JWT_SECRET: "r".repeat(48),
  // Provide DATABASE_URL field used by this structure.
  DATABASE_URL: "postgresql://db/maintenance",
  // Provide WEB_ORIGIN field used by this structure.
  WEB_ORIGIN: "https://maintenance.example.com",
  // Provide TRUST_PROXY field used by this structure.
  TRUST_PROXY: "1",
  // Provide E2E_DISABLE_RATE_LIMIT field used by this structure.
  E2E_DISABLE_RATE_LIMIT: "0",
  // Provide COOKIE_SECURE field used by this structure.
  COOKIE_SECURE: "true",
// Support the surrounding logic for this step.
} as const;

// Group related tests under a shared suite name.
describe("environment validation", () => {
  // E2E rate-limit bypass must never reach production.
  it("rejects test-only rate-limit bypass in production", () => {
    // Invoke withEnv to perform this step.
    withEnv(
      // Support the surrounding logic for this step.
      { ...validProduction, E2E_DISABLE_RATE_LIMIT: "1" },
      // Support the surrounding logic for this step.
      () => {
        // Assert expected behavior in this test case.
        assert.throws(() => assertEnv(), /E2E_DISABLE_RATE_LIMIT/);
      },
    );
  });

  // Scheduler disable flag is forbidden when NODE_ENV=production.
  it("rejects DISABLE_JOB_SCHEDULER in production", () => {
    // Invoke withEnv to perform this step.
    withEnv(
      // Support the surrounding logic for this step.
      { ...validProduction, DISABLE_JOB_SCHEDULER: "1" },
      // Support the surrounding logic for this step.
      () => {
        // Assert expected behavior in this test case.
        assert.throws(() => assertEnv(), /DISABLE_JOB_SCHEDULER/);
      },
    );
  });

  // Staging APP_ENV blocks the flag even if NODE_ENV looks local.
  it("rejects DISABLE_JOB_SCHEDULER when APP_ENV=staging (even if NODE_ENV=development)", () => {
    // Invoke withEnv to perform this step.
    withEnv(
      {
        // Provide NODE_ENV field used by this structure.
        NODE_ENV: "development",
        // Provide PORT field used by this structure.
        PORT: "4000",
        // Provide JWT_SECRET field used by this structure.
        JWT_SECRET: "r".repeat(48),
        // Provide DISABLE_JOB_SCHEDULER field used by this structure.
        DISABLE_JOB_SCHEDULER: "1",
        // Provide APP_ENV field used by this structure.
        APP_ENV: "staging",
        // Provide DEPLOY_ENV field used by this structure.
        DEPLOY_ENV: undefined,
        // Provide ENVIRONMENT field used by this structure.
        ENVIRONMENT: undefined,
        // Provide RELEASE_SHA field used by this structure.
        RELEASE_SHA: undefined,
      },
      // Support the surrounding logic for this step.
      () => {
        // Assert expected behavior in this test case.
        assert.throws(() => assertEnv(), /staging\/production/);
      },
    );
  });

  // DEPLOY_ENV alone is enough to classify as non-local.
  it("rejects DISABLE_JOB_SCHEDULER when DEPLOY_ENV=staging alone", () => {
    // Invoke withEnv to perform this step.
    withEnv(
      {
        // Provide NODE_ENV field used by this structure.
        NODE_ENV: "development",
        // Provide PORT field used by this structure.
        PORT: "4000",
        // Provide JWT_SECRET field used by this structure.
        JWT_SECRET: "r".repeat(48),
        // Provide DISABLE_JOB_SCHEDULER field used by this structure.
        DISABLE_JOB_SCHEDULER: "1",
        // Provide APP_ENV field used by this structure.
        APP_ENV: undefined,
        // Provide DEPLOY_ENV field used by this structure.
        DEPLOY_ENV: "staging",
        // Provide ENVIRONMENT field used by this structure.
        ENVIRONMENT: undefined,
        // Provide RELEASE_SHA field used by this structure.
        RELEASE_SHA: undefined,
      },
      // Support the surrounding logic for this step.
      () => {
        // Assert expected behavior in this test case.
        assert.throws(() => assertEnv(), /staging\/production/);
      },
    );
  });

  // ENVIRONMENT alone is enough to classify as non-local.
  it("rejects DISABLE_JOB_SCHEDULER when ENVIRONMENT=prod alone", () => {
    // Invoke withEnv to perform this step.
    withEnv(
      {
        // Provide NODE_ENV field used by this structure.
        NODE_ENV: "development",
        // Provide PORT field used by this structure.
        PORT: "4000",
        // Provide JWT_SECRET field used by this structure.
        JWT_SECRET: "r".repeat(48),
        // Provide DISABLE_JOB_SCHEDULER field used by this structure.
        DISABLE_JOB_SCHEDULER: "1",
        // Provide APP_ENV field used by this structure.
        APP_ENV: undefined,
        // Provide DEPLOY_ENV field used by this structure.
        DEPLOY_ENV: undefined,
        // Provide ENVIRONMENT field used by this structure.
        ENVIRONMENT: "prod",
        // Provide RELEASE_SHA field used by this structure.
        RELEASE_SHA: undefined,
      },
      // Support the surrounding logic for this step.
      () => {
        // Assert expected behavior in this test case.
        assert.throws(() => assertEnv(), /staging\/production/);
      },
    );
  });

  // Any-of: one non-local label among several still refuses.
  it("rejects when APP_ENV=development but DEPLOY_ENV=staging (any-of)", () => {
    // Invoke withEnv to perform this step.
    withEnv(
      {
        // Provide NODE_ENV field used by this structure.
        NODE_ENV: "development",
        // Provide PORT field used by this structure.
        PORT: "4000",
        // Provide JWT_SECRET field used by this structure.
        JWT_SECRET: "r".repeat(48),
        // Provide DISABLE_JOB_SCHEDULER field used by this structure.
        DISABLE_JOB_SCHEDULER: "1",
        // Provide APP_ENV field used by this structure.
        APP_ENV: "development",
        // Provide DEPLOY_ENV field used by this structure.
        DEPLOY_ENV: "staging",
        // Provide ENVIRONMENT field used by this structure.
        ENVIRONMENT: undefined,
        // Provide RELEASE_SHA field used by this structure.
        RELEASE_SHA: undefined,
      },
      // Support the surrounding logic for this step.
      () => {
        // Assert expected behavior in this test case.
        assert.throws(() => assertEnv(), /staging\/production/);
      },
    );
  });

  // Empty APP_ENV is ignored; DEPLOY_ENV=staging still refuses.
  it("rejects when APP_ENV is empty string but DEPLOY_ENV=staging", () => {
    // Invoke withEnv to perform this step.
    withEnv(
      {
        // Provide NODE_ENV field used by this structure.
        NODE_ENV: "development",
        // Provide PORT field used by this structure.
        PORT: "4000",
        // Provide JWT_SECRET field used by this structure.
        JWT_SECRET: "r".repeat(48),
        // Provide DISABLE_JOB_SCHEDULER field used by this structure.
        DISABLE_JOB_SCHEDULER: "1",
        // Provide APP_ENV field used by this structure.
        APP_ENV: "",
        // Provide DEPLOY_ENV field used by this structure.
        DEPLOY_ENV: "staging",
        // Provide ENVIRONMENT field used by this structure.
        ENVIRONMENT: undefined,
        // Provide RELEASE_SHA field used by this structure.
        RELEASE_SHA: undefined,
      },
      // Support the surrounding logic for this step.
      () => {
        // Assert expected behavior in this test case.
        assert.throws(() => assertEnv(), /staging\/production/);
      },
    );
  });

  // Non-local aliases that must not be treated as local allowlist members.
  for (const alias of [
    // Support the surrounding logic for this step.
    "stage",
    // Support the surrounding logic for this step.
    "stg",
    // Support the surrounding logic for this step.
    "preprod",
    // Support the surrounding logic for this step.
    "uat",
    // Support the surrounding logic for this step.
    "production",
    // Support the surrounding logic for this step.
    "live",
    // Support the surrounding logic for this step.
    "qa",
    // Support the surrounding logic for this step.
    "prd",
    // Support the surrounding logic for this step.
    "production-eu",
    // Support the surrounding logic for this step.
    "staging-1",
  // Support the surrounding logic for this step.
  ] as const) {
    // Define a single test case and its expectation.
    it(`rejects DISABLE_JOB_SCHEDULER for non-local APP_ENV=${alias}`, () => {
      // Invoke withEnv to perform this step.
      withEnv(
        {
          // Provide NODE_ENV field used by this structure.
          NODE_ENV: "development",
          // Provide PORT field used by this structure.
          PORT: "4000",
          // Provide JWT_SECRET field used by this structure.
          JWT_SECRET: "r".repeat(48),
          // Provide DISABLE_JOB_SCHEDULER field used by this structure.
          DISABLE_JOB_SCHEDULER: "1",
          // Provide APP_ENV field used by this structure.
          APP_ENV: alias,
          // Provide DEPLOY_ENV field used by this structure.
          DEPLOY_ENV: undefined,
          // Provide ENVIRONMENT field used by this structure.
          ENVIRONMENT: undefined,
          // Provide RELEASE_SHA field used by this structure.
          RELEASE_SHA: undefined,
        },
        // Support the surrounding logic for this step.
        () => {
          // Assert expected behavior in this test case.
          assert.throws(() => assertEnv(), /staging\/production/);
        },
      );
    });
  }

  // Labels are lowercased before the allowlist check.
  it("rejects APP_ENV=Production (case normalization)", () => {
    // Invoke withEnv to perform this step.
    withEnv(
      {
        // Provide NODE_ENV field used by this structure.
        NODE_ENV: "development",
        // Provide PORT field used by this structure.
        PORT: "4000",
        // Provide JWT_SECRET field used by this structure.
        JWT_SECRET: "r".repeat(48),
        // Provide DISABLE_JOB_SCHEDULER field used by this structure.
        DISABLE_JOB_SCHEDULER: "1",
        // Provide APP_ENV field used by this structure.
        APP_ENV: "Production",
        // Provide DEPLOY_ENV field used by this structure.
        DEPLOY_ENV: undefined,
        // Provide ENVIRONMENT field used by this structure.
        ENVIRONMENT: undefined,
        // Provide RELEASE_SHA field used by this structure.
        RELEASE_SHA: undefined,
      },
      // Support the surrounding logic for this step.
      () => {
        // Assert expected behavior in this test case.
        assert.throws(() => assertEnv(), /staging\/production/);
      },
    );
  });

  // Labels are trimmed before the allowlist check.
  it("rejects APP_ENV with surrounding whitespace (trim)", () => {
    // Invoke withEnv to perform this step.
    withEnv(
      {
        // Provide NODE_ENV field used by this structure.
        NODE_ENV: "development",
        // Provide PORT field used by this structure.
        PORT: "4000",
        // Provide JWT_SECRET field used by this structure.
        JWT_SECRET: "r".repeat(48),
        // Provide DISABLE_JOB_SCHEDULER field used by this structure.
        DISABLE_JOB_SCHEDULER: "1",
        // Provide APP_ENV field used by this structure.
        APP_ENV: " Staging ",
        // Provide DEPLOY_ENV field used by this structure.
        DEPLOY_ENV: undefined,
        // Provide ENVIRONMENT field used by this structure.
        ENVIRONMENT: undefined,
        // Provide RELEASE_SHA field used by this structure.
        RELEASE_SHA: undefined,
      },
      // Support the surrounding logic for this step.
      () => {
        // Assert expected behavior in this test case.
        assert.throws(() => assertEnv(), /staging\/production/);
      },
    );
  });

  // Deployed images set RELEASE_SHA even when NODE_ENV is development.
  it("rejects DISABLE_JOB_SCHEDULER when RELEASE_SHA is set (deployed image)", () => {
    // Invoke withEnv to perform this step.
    withEnv(
      {
        // Provide NODE_ENV field used by this structure.
        NODE_ENV: "development",
        // Provide PORT field used by this structure.
        PORT: "4000",
        // Provide JWT_SECRET field used by this structure.
        JWT_SECRET: "r".repeat(48),
        // Provide DISABLE_JOB_SCHEDULER field used by this structure.
        DISABLE_JOB_SCHEDULER: "1",
        // Provide APP_ENV field used by this structure.
        APP_ENV: undefined,
        // Provide DEPLOY_ENV field used by this structure.
        DEPLOY_ENV: undefined,
        // Provide ENVIRONMENT field used by this structure.
        ENVIRONMENT: undefined,
        // Provide RELEASE_SHA field used by this structure.
        RELEASE_SHA: "abc123",
      },
      // Support the surrounding logic for this step.
      () => {
        // Assert expected behavior in this test case.
        assert.throws(() => assertEnv(), /RELEASE_SHA/);
      },
    );
  });

  // Local development without deploy markers may disable the scheduler.
  it("allows DISABLE_JOB_SCHEDULER in local development without deploy markers", () => {
    // Invoke withEnv to perform this step.
    withEnv(
      {
        // Provide NODE_ENV field used by this structure.
        NODE_ENV: "development",
        // Provide PORT field used by this structure.
        PORT: "4000",
        // Provide JWT_SECRET field used by this structure.
        JWT_SECRET: "r".repeat(48),
        // Provide DISABLE_JOB_SCHEDULER field used by this structure.
        DISABLE_JOB_SCHEDULER: "1",
        // Provide APP_ENV field used by this structure.
        APP_ENV: undefined,
        // Provide DEPLOY_ENV field used by this structure.
        DEPLOY_ENV: undefined,
        // Provide ENVIRONMENT field used by this structure.
        ENVIRONMENT: undefined,
        // Provide RELEASE_SHA field used by this structure.
        RELEASE_SHA: undefined,
      },
      // Support the surrounding logic for this step.
      () => {
        // Assert expected behavior in this test case.
        assert.doesNotThrow(() => assertEnv());
      },
    );
  });

  // Explicit APP_ENV=development is on the local allowlist.
  it("allows DISABLE_JOB_SCHEDULER when APP_ENV is explicitly development", () => {
    // Invoke withEnv to perform this step.
    withEnv(
      {
        // Provide NODE_ENV field used by this structure.
        NODE_ENV: "development",
        // Provide PORT field used by this structure.
        PORT: "4000",
        // Provide JWT_SECRET field used by this structure.
        JWT_SECRET: "r".repeat(48),
        // Provide DISABLE_JOB_SCHEDULER field used by this structure.
        DISABLE_JOB_SCHEDULER: "1",
        // Provide APP_ENV field used by this structure.
        APP_ENV: "development",
        // Provide DEPLOY_ENV field used by this structure.
        DEPLOY_ENV: undefined,
        // Provide ENVIRONMENT field used by this structure.
        ENVIRONMENT: undefined,
        // Provide RELEASE_SHA field used by this structure.
        RELEASE_SHA: undefined,
      },
      // Support the surrounding logic for this step.
      () => {
        // Assert expected behavior in this test case.
        assert.doesNotThrow(() => assertEnv());
      },
    );
  });

  // PORT must be a valid TCP port integer.
  it("rejects malformed ports", () => {
    // Invoke withEnv to perform this step.
    withEnv({ NODE_ENV: "test", PORT: "70000", JWT_SECRET: "x" }, () => {
      // Assert expected behavior in this test case.
      assert.throws(() => assertEnv(), /PORT must be/);
    });
  });

  // Sanity check that the shared production baseline still passes.
  it("accepts a complete valid production configuration", () => {
    // Invoke withEnv to perform this step.
    withEnv({ ...validProduction }, () => {
      // Assert expected behavior in this test case.
      assert.doesNotThrow(() => assertEnv());
    });
  });

  // Table-driven production misconfiguration cases.
  const productionRejections: Array<{
    // Provide name field used by this structure.
    name: string;
    // Provide patch field used by this structure.
    patch: Record<string, string | undefined>;
    // Provide message field used by this structure.
    message: RegExp;
  // Support the surrounding logic for this step.
  }> = [
    {
      // Provide name field used by this structure.
      name: "missing DATABASE_URL",
      // Provide patch field used by this structure.
      patch: { DATABASE_URL: undefined },
      // Provide message field used by this structure.
      message: /DATABASE_URL must be a PostgreSQL URL/,
    },
    {
      // Provide name field used by this structure.
      name: "non-postgres DATABASE_URL",
      // Provide patch field used by this structure.
      patch: { DATABASE_URL: "mysql://db/maintenance" },
      // Provide message field used by this structure.
      message: /DATABASE_URL must be a PostgreSQL URL/,
    },
    {
      // Provide name field used by this structure.
      name: "empty WEB_ORIGIN allowlist",
      // Provide patch field used by this structure.
      patch: { WEB_ORIGIN: "" },
      // Provide message field used by this structure.
      message: /Production WEB_ORIGIN must contain an explicit HTTPS origin allowlist/,
    },
    {
      // Provide name field used by this structure.
      name: "HTTP WEB_ORIGIN in production",
      // Provide patch field used by this structure.
      patch: { WEB_ORIGIN: "http://maintenance.example.com" },
      // Provide message field used by this structure.
      message: /Production WEB_ORIGIN must contain an explicit HTTPS origin allowlist/,
    },
    {
      // Provide name field used by this structure.
      name: "mixed HTTP origin in allowlist",
      // Provide patch field used by this structure.
      patch: {
        // Provide WEB_ORIGIN field used by this structure.
        WEB_ORIGIN:
          // Support the surrounding logic for this step.
          "https://maintenance.example.com,http://insecure.example.com",
      },
      // Provide message field used by this structure.
      message: /Production WEB_ORIGIN must contain an explicit HTTPS origin allowlist/,
    },
    {
      // Provide name field used by this structure.
      name: "TRUST_PROXY not set to 1",
      // Provide patch field used by this structure.
      patch: { TRUST_PROXY: "0" },
      // Provide message field used by this structure.
      message: /Production must set TRUST_PROXY=1/,
    },
    {
      // Provide name field used by this structure.
      name: "JWT_SECRET containing demo",
      // Provide patch field used by this structure.
      patch: { JWT_SECRET: `demo-${"r".repeat(48)}` },
      // Provide message field used by this structure.
      message: /JWT_SECRET cannot contain demo/,
    },
    {
      // Provide name field used by this structure.
      name: "COOKIE_SECURE=false",
      // Provide patch field used by this structure.
      patch: { COOKIE_SECURE: "false" },
      // Provide message field used by this structure.
      message: /COOKIE_SECURE=false cannot be used in production/,
    },
  // Support the surrounding logic for this step.
  ];

  // Each row overlays validProduction and expects the listed message.
  for (const { name, patch, message } of productionRejections) {
    // Define a single test case and its expectation.
    it(`rejects production misconfiguration: ${name}`, () => {
      // Invoke withEnv to perform this step.
      withEnv({ ...validProduction, ...patch }, () => {
        // Assert expected behavior in this test case.
        assert.throws(() => assertEnv(), message);
      });
    });
  }
});
