/**
 * Shared Prisma unique-constraint (P2002) helpers.
 */
import { Prisma } from "@prisma/client";

/** True when err is a Prisma unique-constraint violation (P2002). */
export function isP2002(
  err: unknown,
): err is Prisma.PrismaClientKnownRequestError {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

/** Normalize Prisma `meta.target` (array or string) to string keys. */
export function p2002Targets(err: Prisma.PrismaClientKnownRequestError): string[] {
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.map(String);
  if (typeof target === "string") return [target];
  return [];
}

/** Case-insensitive substring match against unique-constraint target names. */
export function targetsMatch(
  err: Prisma.PrismaClientKnownRequestError,
  needles: string[],
) {
  const targets = p2002Targets(err).map((t) => t.toLowerCase());
  return needles.some((n) => targets.some((t) => t.includes(n.toLowerCase())));
}
