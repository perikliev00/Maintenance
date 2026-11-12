/** Known/example secrets that must never run in production. */
const INSECURE_JWT_SECRETS = new Set([
  // Copied from .env.example — refuse in production.
  "dev-jwt-secret-change-me",
  // Alternate local placeholder that must not ship.
  "local-dev-only-insecure-secret-do-not-use-in-prod",
]);

// Production JWT_SECRET must be at least this many characters.
const MIN_JWT_SECRET_LENGTH = 32;

// True when NODE_ENV is exactly "production".
function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Only these APP_ENV / DEPLOY_ENV / ENVIRONMENT values may coexist with
 * DISABLE_JOB_SCHEDULER=1. Anything else (staging, live, qa, production-eu, …)
 * is treated as a non-local deploy marker (allowlist, not denylist).
 */
const LOCAL_DEPLOY_LABELS = new Set([
  "development",
  "dev",
  "test",
  "local",
]);

/**
 * DISABLE_JOB_SCHEDULER is local/E2E only. Refuse it for production, any
 * non-local deploy label on APP_ENV/DEPLOY_ENV/ENVIRONMENT (any-of allowlist),
 * and any deployed image that sets RELEASE_SHA (compose.prod.yml).
 */
export function assertDisableJobSchedulerAllowed(
  env: NodeJS.ProcessEnv = process.env,
): void {
  // No-op when the dangerous flag is unset.
  if (env.DISABLE_JOB_SCHEDULER !== "1") return;
  // Production can never disable the scheduler via this flag.
  if (env.NODE_ENV === "production") {
    throw new Error("DISABLE_JOB_SCHEDULER cannot be enabled in production");
  }
  // Collect non-empty deploy labels and normalize case/whitespace.
  const deployLabels = [env.APP_ENV, env.DEPLOY_ENV, env.ENVIRONMENT]
    .map((value) => (value ?? "").trim().toLowerCase())
    .filter(Boolean);
  // Any label outside the local allowlist means a real deploy → refuse.
  if (deployLabels.some((label) => !LOCAL_DEPLOY_LABELS.has(label))) {
    throw new Error(
      "DISABLE_JOB_SCHEDULER cannot be enabled in staging/production (APP_ENV/DEPLOY_ENV/ENVIRONMENT)",
    );
  }
  // RELEASE_SHA is set on deployed images even when NODE_ENV is development.
  if (env.RELEASE_SHA?.trim()) {
    throw new Error(
      "DISABLE_JOB_SCHEDULER cannot be enabled when RELEASE_SHA is set (deployed environment)",
    );
  }
}

/**
 * Fail fast on missing JWT_SECRET. In production, also reject denylisted
 * or short secrets so a copied .env.example cannot silently ship.
 */
export function assertEnv(): void {
  // Default NODE_ENV to development when unset (local runs).
  const env = process.env.NODE_ENV ?? "development";
  // Only the three canonical Node environments are accepted.
  if (!new Set(["development", "test", "production"]).has(env)) {
    throw new Error("NODE_ENV must be development, test, or production");
  }
  // Parse PORT with the same default the server uses.
  const port = Number(process.env.PORT ?? 4000);
  // Reject NaN, floats, and out-of-range TCP ports.
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  // Split WEB_ORIGIN allowlist the same way CORS configuration does.
  const origins = (process.env.WEB_ORIGIN ?? "http://localhost:5173")
    .split(",").map((value) => value.trim()).filter(Boolean);
  // Each origin must be a bare http(s) origin (no path) so CORS compares cleanly.
  if (origins.some((value) => {
    try { const url = new URL(value); return !["http:", "https:"].includes(url.protocol) || url.origin !== value.replace(/\/$/, ""); }
    catch { return true; }
  })) throw new Error("WEB_ORIGIN must be a comma-separated list of HTTP(S) origins");
  // Extra production-only hard requirements before JWT checks.
  if (isProduction()) {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    // Production must point at Postgres, not a placeholder or other driver.
    if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) throw new Error("DATABASE_URL must be a PostgreSQL URL in production");
    // Browser SPA must be served over HTTPS in production.
    if (!process.env.WEB_ORIGIN?.trim() || origins.some((value) => !value.startsWith("https://"))) throw new Error("Production WEB_ORIGIN must contain an explicit HTTPS origin allowlist");
    // Rate-limit keys need X-Forwarded-For from the reverse proxy.
    if (process.env.TRUST_PROXY !== "1") throw new Error("Production must set TRUST_PROXY=1 behind the configured reverse proxy");
  }
  // JWT signing secret is required in every environment.
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "JWT_SECRET is not set. Generate one with: openssl rand -base64 48",
    );
  }

  // True when the secret is a known example placeholder.
  const insecure = INSECURE_JWT_SECRETS.has(secret);
  // True when the secret is shorter than the production floor.
  const tooShort = secret.length < MIN_JWT_SECRET_LENGTH;

  // Always — not only inside the production block — so staging with
  // NODE_ENV=development + APP_ENV/RELEASE_SHA still cannot disable jobs.
  assertDisableJobSchedulerAllowed();

  if (isProduction()) {
    // Known insecure defaults must never ship.
    if (insecure) {
      throw new Error(
        "JWT_SECRET is a known insecure default and cannot be used in production",
      );
    }
    // Enforce minimum entropy via length in production.
    if (tooShort) {
      throw new Error(
        `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters in production`,
      );
    }
    // Rate-limit bypass is test-only and must not reach production.
    if (process.env.E2E_DISABLE_RATE_LIMIT === "1" || process.env.E2E_DISABLE_RATE_LIMIT === "true") {
      throw new Error("E2E_DISABLE_RATE_LIMIT cannot be enabled in production");
    }
    // "demo" in the secret suggests a non-production key material.
    if ((secret ?? "").toLowerCase().includes("demo")) {
      throw new Error("JWT_SECRET cannot contain demo in production");
    }
    // Auth cookies must remain Secure in production.
    if (process.env.COOKIE_SECURE === "false") {
      throw new Error("COOKIE_SECURE=false cannot be used in production");
    }
    return;
  }

  // Non-production: warn instead of failing so local .env.example still boots.
  if (insecure) {
    console.warn(
      "WARNING: JWT_SECRET is a known insecure default. Safe for local dev only; production will refuse to start.",
    );
  } else if (tooShort) {
    console.warn(
      `WARNING: JWT_SECRET is shorter than ${MIN_JWT_SECRET_LENGTH} characters. Production requires a longer secret.`,
    );
  }
}
