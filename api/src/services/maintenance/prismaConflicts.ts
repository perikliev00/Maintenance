/**
 * Prisma unique-constraint helpers for concurrent idempotent ticket commands.
 */
import { Prisma } from "@prisma/client";

/**
 * True when a unique constraint was violated (e.g. duplicate commandId).
 * Used by claim/command paths to treat duplicate commandId as idempotent success.
 */
export function isP2002(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  // Used by claim/command paths to treat duplicate commandId as idempotent success.
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}
