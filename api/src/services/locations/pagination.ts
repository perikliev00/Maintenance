import { z } from "zod/v3";
// Import type(s) Prisma for typing without runtime cost.
import type { Prisma } from "@prisma/client";
import { AppError } from "../../errors";
import { decodeBase64UrlJson, encodeBase64UrlJson } from "../cursorCodec";

// Carry sort values, rather than a row reference, so archiving/deleting the
// preceding page's last row does not invalidate continuation. Scope is always
// applied separately to the next query; this token never grants access.
const cursorSchema = z.object({
  floor: z.number().int(),
  number: z.string().max(64),
  id: z.string().min(1).max(128),
}).strict();

export function activeLocationAfter(cursor?: string): Prisma.LocationWhereInput {
  if (!cursor) return {};
  let value: z.infer<typeof cursorSchema>;
  try {
    value = cursorSchema.parse(decodeBase64UrlJson(cursor));
  } catch {
    throw new AppError(400, "validation", "Invalid location cursor");
  }
  return { OR: [
    { floor: { number: { gt: value.floor } } },
    { floor: { number: value.floor }, number: { gt: value.number } },
    { floor: { number: value.floor }, number: value.number, id: { gt: value.id } },
  ] };
}

export function activeLocationCursor(row: { id: string; number: string; floor: { number: number } }): string {
  return encodeBase64UrlJson({ floor: row.floor.number, number: row.number, id: row.id });
}
