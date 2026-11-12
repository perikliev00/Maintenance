/**
 * Shared Prisma unique-constraint (P2002) helpers.
 */
import { Prisma } from "@prisma/client";

/** True when err is a Prisma unique-constraint violation (P2002). */
export function isP2002(
  // Set err on the structure being built.
  err: unknown,
// Run next step: ): err is Prisma.PrismaClientKnownRequestError {
): err is Prisma.PrismaClientKnownRequestError {
  // Return the computed result to the caller.
  return (
    // Run next step: err instanceof Prisma.PrismaClientKnownRequestError && err.c…
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

/** Normalize Prisma `meta.target` (array or string) to string keys. */
export function p2002Targets(err: Prisma.PrismaClientKnownRequestError): string[] {
  // Capture target for use in this scope.
  const target = err.meta?.target;
  // Branch when this condition holds so the right path runs.
  if (Array.isArray(target)) return target.map(String);
  // Branch when this condition holds so the right path runs.
  if (typeof target === "string") return [target];
  // Return the computed result to the caller.
  return [];
}

/** Case-insensitive substring match against unique-constraint target names. */
export function targetsMatch(
  // Set err on the structure being built.
  err: Prisma.PrismaClientKnownRequestError,
  // Set needles on the structure being built.
  needles: string[],
// Run next step: ) {
) {
  // Capture targets for use in this scope.
  const targets = p2002Targets(err).map((t) => t.toLowerCase());
  // Return the computed result to the caller.
  return needles.some((n) => targets.some((t) => t.includes(n.toLowerCase())));
}
