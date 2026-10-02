/** Known/example secrets that must never run in production. */
const INSECURE_JWT_SECRETS = new Set([
  "dev-jwt-secret-change-me",
  "local-dev-only-insecure-secret-do-not-use-in-prod",
]);

const MIN_JWT_SECRET_LENGTH = 32;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }
  return secret;
}

/**
 * Fail fast on missing JWT_SECRET. In production, also reject denylisted
 * or short secrets so a copied .env.example cannot silently ship.
 */
export function assertEnv(): void {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "JWT_SECRET is not set. Generate one with: openssl rand -base64 48",
    );
  }

  const insecure = INSECURE_JWT_SECRETS.has(secret);
  const tooShort = secret.length < MIN_JWT_SECRET_LENGTH;

  if (isProduction()) {
    if (insecure) {
      throw new Error(
        "JWT_SECRET is a known insecure default and cannot be used in production",
      );
    }
    if (tooShort) {
      throw new Error(
        `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters in production`,
      );
    }
    return;
  }

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
