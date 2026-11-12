// Import module zod/v3 for this service.
import { z } from "zod/v3";
// Import type(s) Prisma for typing without runtime cost.
import type { Prisma } from "@prisma/client";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module ../cursorCodec for this service.
import { decodeBase64UrlJson, encodeBase64UrlJson } from "../cursorCodec";

// Carry sort values, rather than a row reference, so archiving/deleting the
// preceding page's last row does not invalidate continuation. Scope is always
// applied separately to the next query; this token never grants access.
const cursorSchema = z.object({
  // Set floor on the structure being built.
  floor: z.number().int(),
  // Set number on the structure being built.
  number: z.string().max(64),
  // Set id on the structure being built.
  id: z.string().min(1).max(128),
// Run next step: }).strict();
}).strict();

// Define activeLocationAfter — core behavior for this module.
export function activeLocationAfter(cursor?: string): Prisma.LocationWhereInput {
  // Branch when this condition holds so the right path runs.
  if (!cursor) return {};
  // Capture value for use in this scope.
  let value: z.infer<typeof cursorSchema>;
  // Attempt the fallible work so errors can be handled below.
  try {
    // Update value as control flow progresses.
    value = cursorSchema.parse(decodeBase64UrlJson(cursor));
  // Run next step: } catch {
  } catch {
    // Abort with an error so callers can react.
    throw new AppError(400, "validation", "Invalid location cursor");
  }
  // Return the computed result to the caller.
  return { OR: [
    // Run next step: { floor: { number: { gt: value.floor } } },
    { floor: { number: { gt: value.floor } } },
    // Run next step: { floor: { number: value.floor }, number: { gt: value.number…
    { floor: { number: value.floor }, number: { gt: value.number } },
    // Run next step: { floor: { number: value.floor }, number: value.number, id: …
    { floor: { number: value.floor }, number: value.number, id: { gt: value.id } },
  // Run next step: ] };
  ] };
}

// Define activeLocationCursor — core behavior for this module.
export function activeLocationCursor(row: { id: string; number: string; floor: { number: number } }): string {
  // Return the computed result to the caller.
  return encodeBase64UrlJson({ floor: row.floor.number, number: row.number, id: row.id });
}
