/**
 * Guard mutating P1 suites against the working / seed database name.
 * Call after dotenv ({ override: true }) and before PrismaClient connects.
 */
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";

/** Documented isolated DB name for sectors / shifts / my-work suites. */
export const DEFAULT_EXPECTED_TEST_DATABASE = "maintenance_p1_test";

/** High enough for SSE delivery txs + barrier holders + open stream fans. */
const DEFAULT_CONNECTION_LIMIT = 20;

export function expectedTestDatabaseName(): string {
  const fromEnv = process.env.EXPECTED_TEST_DATABASE?.trim();
  return fromEnv && fromEnv.length > 0
    ? fromEnv
    : DEFAULT_EXPECTED_TEST_DATABASE;
}

/**
 * After dotenv, point DATABASE_URL at the isolated DB name and ensure
 * connection_limit is high enough for dual Lock waiters on a shared Prisma pool.
 * Does not edit api/.env — only process.env for this process.
 *
 * TEST_DATABASE_URL (if set) wins entirely after dotenv.
 */
export function applyIsolatedTestDatabaseConfig(): void {
  const expected = expectedTestDatabaseName();
  process.env.EXPECTED_TEST_DATABASE = expected;

  if (process.env.TEST_DATABASE_URL?.trim()) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL.trim();
  }

  assert.ok(
    process.env.DATABASE_URL,
    "DATABASE_URL required after dotenv / TEST_DATABASE_URL",
  );

  process.env.DATABASE_URL = rewriteDatabaseUrl(
    process.env.DATABASE_URL,
    expected,
    DEFAULT_CONNECTION_LIMIT,
  );
}

export function rewriteDatabaseUrl(
  url: string,
  databaseName: string,
  connectionLimit: number,
): string {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").filter(Boolean);
  // pathname is typically "/dbname" or "/dbname" with optional leading junk
  if (segments.length === 0) {
    parsed.pathname = `/${databaseName}`;
  } else {
    segments[segments.length - 1] = databaseName;
    parsed.pathname = `/${segments.join("/")}`;
  }
  parsed.searchParams.set("connection_limit", String(connectionLimit));
  // URL serializes postgresql: as http-like; restore protocol if stripped
  let out = parsed.toString();
  if (url.startsWith("postgresql://") && out.startsWith("postgres://")) {
    out = `postgresql://${out.slice("postgres://".length)}`;
  } else if (url.startsWith("postgresql://") && !out.startsWith("postgresql://")) {
    out = out.replace(/^https?:\/\//, "postgresql://");
  }
  return out;
}

/** Assert current_database() matches the configured isolated name. */
export async function assertTestDatabase(prisma: PrismaClient): Promise<void> {
  const expected = expectedTestDatabaseName();
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    SELECT current_database() AS name
  `;
  const actual = rows[0]?.name;
  assert.equal(
    actual,
    expected,
    `Refusing mutating suite: current_database()=${actual} expected=${expected}. ` +
      `Use isolated DB (default ${DEFAULT_EXPECTED_TEST_DATABASE}) via TEST_DATABASE_URL ` +
      `or EXPECTED_TEST_DATABASE; do not point these suites at the working seed DB by name alone.`,
  );
}
