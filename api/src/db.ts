/**
 * Shared Prisma client for the API process (one connection pool per process).
 * Import this singleton from services/controllers instead of constructing
 * additional PrismaClient instances.
 */
// Prisma ORM client constructor for the shared singleton below.
import { PrismaClient } from "@prisma/client";

/**
 * Isolated P1 suites hold interactive transactions on purpose (lock barriers).
 * Prisma's default 5s timeout aborts those waiters before the harness can
 * observe them under CI load. Production keeps Prisma defaults.
 */
const isolatedTestClient =
  Boolean(process.env.EXPECTED_TEST_DATABASE?.trim()) ||
  Boolean(process.env.TEST_DATABASE_URL?.trim());

/** Process-wide Prisma client (connection pool shared across handlers). */
export const prisma = new PrismaClient(
  isolatedTestClient
    ? { transactionOptions: { maxWait: 20_000, timeout: 60_000 } }
    : undefined,
);