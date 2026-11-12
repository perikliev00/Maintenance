/**
 * Guard mutating P1 suites against the working / seed database name.
 * Call after dotenv ({ override: true }) and before PrismaClient connects.
 */
import assert from "node:assert/strict";
// Type-only import from @prisma/client for compile-time contracts.
import type { PrismaClient } from "@prisma/client";

/** Documented isolated DB name for sectors / shifts / my-work suites. */
export const DEFAULT_EXPECTED_TEST_DATABASE = "maintenance_p1_test";

/** High enough for SSE delivery txs + barrier holders + open stream fans. */
const DEFAULT_CONNECTION_LIMIT = 20;

// Export helper expectedTestDatabaseName for reuse across related tests.
export function expectedTestDatabaseName(): string {
  // Bind fromEnv for later setup or assertions in this scope.
  const fromEnv = process.env.EXPECTED_TEST_DATABASE?.trim();
  // Return the arranged value/result to the caller.
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
  // Bind expected for later setup or assertions in this scope.
  const expected = expectedTestDatabaseName();
  // Override env for isolation, rate-limit disable, or scheduler quieting.
  process.env.EXPECTED_TEST_DATABASE = expected;

  // Branch on env so isolation settings win over ambient config.
  if (process.env.TEST_DATABASE_URL?.trim()) {
    // Override env for isolation, rate-limit disable, or scheduler quieting.
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL.trim();
  }

  // Assert the observed value matches the intended post-condition.
  assert.ok(
    // Override env for isolation, rate-limit disable, or scheduler quieting.
    process.env.DATABASE_URL,
    // Execute the next setup or assertion step for this scenario.
    "DATABASE_URL required after dotenv / TEST_DATABASE_URL",
  );

  // Override env for isolation, rate-limit disable, or scheduler quieting.
  process.env.DATABASE_URL = rewriteDatabaseUrl(
    // Override env for isolation, rate-limit disable, or scheduler quieting.
    process.env.DATABASE_URL,
    // Execute the next setup or assertion step for this scenario.
    expected,
    // Pagination step for list/contract coverage.
    DEFAULT_CONNECTION_LIMIT,
  );
}

// Export helper rewriteDatabaseUrl for reuse across related tests.
export function rewriteDatabaseUrl(
  // Configure url for the request/server under test.
  url: string,
  // Execute the next setup or assertion step for this scenario.
  databaseName: string,
  // Pagination step for list/contract coverage.
  connectionLimit: number,
// Execute the next setup or assertion step for this scenario.
): string {
  // Bind parsed for later setup or assertions in this scope.
  const parsed = new URL(url);
  // Bind segments for later setup or assertions in this scope.
  const segments = parsed.pathname.split("/").filter(Boolean);
  // pathname is typically "/dbname" or "/dbname" with optional leading junk
  if (segments.length === 0) {
    // Execute the next setup or assertion step for this scenario.
    parsed.pathname = `/${databaseName}`;
  // Execute the next setup or assertion step for this scenario.
  } else {
    // Execute the next setup or assertion step for this scenario.
    segments[segments.length - 1] = databaseName;
    // Execute the next setup or assertion step for this scenario.
    parsed.pathname = `/${segments.join("/")}`;
  }
  // Pagination step for list/contract coverage.
  parsed.searchParams.set("connection_limit", String(connectionLimit));
  // URL serializes postgresql: as http-like; restore protocol if stripped
  let out = parsed.toString();
  // Conditional path for setup, cleanup, or alternate outcomes.
  if (url.startsWith("postgresql://") && out.startsWith("postgres://")) {
    // Execute the next setup or assertion step for this scenario.
    out = `postgresql://${out.slice("postgres://".length)}`;
  // Execute the next setup or assertion step for this scenario.
  } else if (url.startsWith("postgresql://") && !out.startsWith("postgresql://")) {
    // Execute the next setup or assertion step for this scenario.
    out = out.replace(/^https?:\/\//, "postgresql://");
  }
  // Return the arranged value/result to the caller.
  return out;
}

/** Assert current_database() matches the configured isolated name. */
export async function assertTestDatabase(prisma: PrismaClient): Promise<void> {
  // Bind expected for later setup or assertions in this scope.
  const expected = expectedTestDatabaseName();
  // rows: synchronize actors so the race window is observable.
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    SELECT current_database() AS name
  `;
  // Bind actual for later setup or assertions in this scope.
  const actual = rows[0]?.name;
  // Assert the observed value matches the intended post-condition.
  assert.equal(
    // Execute the next setup or assertion step for this scenario.
    actual,
    // Execute the next setup or assertion step for this scenario.
    expected,
    // Execute the next setup or assertion step for this scenario.
    `Refusing mutating suite: current_database()=${actual} expected=${expected}. ` +
      // Concurrency/isolation step for the race under test.
      `Use isolated DB (default ${DEFAULT_EXPECTED_TEST_DATABASE}) via TEST_DATABASE_URL ` +
      // Seed prerequisite rows so the mutation under test has a realistic baseline.
      `or EXPECTED_TEST_DATABASE; do not point these suites at the working seed DB by name alone.`,
  );
}
