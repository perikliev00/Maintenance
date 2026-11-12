/**
 * Shared Zod shape for maintenance ticket report payloads (HTTP + sync).
 * Domain validateMaintenanceReport remains authoritative for business rules.
 */
import { z } from "zod/v3";

// Capture id for use in this scope.
const id = z.string().min(1);

/** Ticket priority values accepted by report/create payloads. */
export const maintenanceTicketPrioritySchema = z.enum([
  // Run next step: "low",
  "low",
  // Run next step: "normal",
  "normal",
  // Run next step: "high",
  "high",
  // Run next step: "urgent",
  "urgent",
]);

// Capture maintenance ticket report base schema for use in this scope.
const maintenanceTicketReportBaseSchema = z.object({
  // Set locationId on the structure being built.
  locationId: id,
  // Set title on the structure being built.
  title: z.string().min(1).optional(),
  // Set description on the structure being built.
  description: z.string().max(4000).optional(),
  // Set issueOptionId on the structure being built.
  issueOptionId: id.optional(),
  // Set categoryId on the structure being built.
  categoryId: id.optional(),
  // Set priority on the structure being built.
  priority: maintenanceTicketPrioritySchema.optional(),
  // Set blocksRoom on the structure being built.
  blocksRoom: z.boolean().optional(),
  // Set allowDuplicate on the structure being built.
  allowDuplicate: z.boolean().optional(),
  // Set duplicateOverrideReason on the structure being built.
  duplicateOverrideReason: z.string().min(1).max(1000).optional(),
  // Set confirmSimilar on the structure being built.
  confirmSimilar: z.boolean().optional(),
});

// Define withMaintenanceReportRefines — core behavior for this module.
function withMaintenanceReportRefines<T extends z.ZodTypeAny>(schema: T) {
  // Return the computed result to the caller.
  return schema
    // Continue the chained call from the previous expression.
    .refine(
      // Run next step: (data) =>
      (data) =>
        // Run next step: (Boolean(data.issueOptionId) && !data.categoryId) ||
        (Boolean(data.issueOptionId) && !data.categoryId) ||
        // Run next step: (!data.issueOptionId && Boolean(data.categoryId)),
        (!data.issueOptionId && Boolean(data.categoryId)),
      // Run next step: { message: "Provide exactly one of issueOptionId or category…
      { message: "Provide exactly one of issueOptionId or categoryId" },
    )
    // Continue the chained call from the previous expression.
    .refine(
      // Run next step: (data) =>
      (data) =>
        // Run next step: Boolean(data.issueOptionId) ||
        Boolean(data.issueOptionId) ||
        // Run next step: (Boolean(data.categoryId) &&
        (Boolean(data.categoryId) &&
          // Run next step: typeof data.title === "string" &&
          typeof data.title === "string" &&
          // Run next step: data.title.trim().length > 0),
          data.title.trim().length > 0),
      // Run next step: { message: "title is required when using categoryId" },
      { message: "title is required when using categoryId" },
    )
    // Continue the chained call from the previous expression.
    .refine(
      // Run next step: (data) =>
      (data) =>
        // Run next step: !data.allowDuplicate ||
        !data.allowDuplicate ||
        // Run next step: (typeof data.duplicateOverrideReason === "string" &&
        (typeof data.duplicateOverrideReason === "string" &&
          // Run next step: data.duplicateOverrideReason.trim().length > 0),
          data.duplicateOverrideReason.trim().length > 0),
      // Run next step: {
      {
        // Set message on the structure being built.
        message:
          // Run next step: "duplicateOverrideReason is required when allowDuplicate is …
          "duplicateOverrideReason is required when allowDuplicate is true",
      },
    );
}

/** Sync + service report payload validation. */
export const maintenanceTicketReportSchema = withMaintenanceReportRefines(
  // Run next step: maintenanceTicketReportBaseSchema,
  maintenanceTicketReportBaseSchema,
);

/** HTTP POST /tickets body (report fields + optional commandId). */
export const maintenanceTicketCreateHttpSchema = withMaintenanceReportRefines(
  // Run next step: maintenanceTicketReportBaseSchema.extend({
  maintenanceTicketReportBaseSchema.extend({
    // Set commandId on the structure being built.
    commandId: z.string().uuid().optional(),
  }),
);
