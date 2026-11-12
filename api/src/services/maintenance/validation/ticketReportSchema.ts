/**
 * Shared Zod shape for maintenance ticket report payloads (HTTP + sync).
 * Domain validateMaintenanceReport remains authoritative for business rules.
 */
import { z } from "zod/v3";

const id = z.string().min(1);

/** Ticket priority values accepted by report/create payloads. */
export const maintenanceTicketPrioritySchema = z.enum([
  "low",
  "normal",
  "high",
  "urgent",
]);

// Capture maintenance ticket report base schema for use in this scope.
const maintenanceTicketReportBaseSchema = z.object({
  locationId: id,
  title: z.string().min(1).optional(),
  description: z.string().max(4000).optional(),
  issueOptionId: id.optional(),
  categoryId: id.optional(),
  priority: maintenanceTicketPrioritySchema.optional(),
  blocksRoom: z.boolean().optional(),
  allowDuplicate: z.boolean().optional(),
  duplicateOverrideReason: z.string().min(1).max(1000).optional(),
  confirmSimilar: z.boolean().optional(),
});

function withMaintenanceReportRefines<T extends z.ZodTypeAny>(schema: T) {
  return schema
    // Continue the chained call from the previous expression.
    .refine(
      (data) =>
        (Boolean(data.issueOptionId) && !data.categoryId) ||
        (!data.issueOptionId && Boolean(data.categoryId)),
      { message: "Provide exactly one of issueOptionId or categoryId" },
    )
    // Continue the chained call from the previous expression.
    .refine(
      (data) =>
        Boolean(data.issueOptionId) ||
        (Boolean(data.categoryId) &&
          typeof data.title === "string" &&
          data.title.trim().length > 0),
      { message: "title is required when using categoryId" },
    )
    // Continue the chained call from the previous expression.
    .refine(
      (data) =>
        !data.allowDuplicate ||
        (typeof data.duplicateOverrideReason === "string" &&
          data.duplicateOverrideReason.trim().length > 0),
      {
        message:
          "duplicateOverrideReason is required when allowDuplicate is true",
      },
    );
}

/** Sync + service report payload validation. */
export const maintenanceTicketReportSchema = withMaintenanceReportRefines(
  maintenanceTicketReportBaseSchema,
);

/** HTTP POST /tickets body (report fields + optional commandId). */
export const maintenanceTicketCreateHttpSchema = withMaintenanceReportRefines(
  maintenanceTicketReportBaseSchema.extend({
    commandId: z.string().uuid().optional(),
  }),
);
