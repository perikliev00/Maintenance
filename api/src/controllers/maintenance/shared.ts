/** Shared Zod schemas for maintenance ticket/catalog request bodies. */
import { z } from "zod/v3";

/** Ticket priority values accepted by create/update ticket handlers. */
export const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);
