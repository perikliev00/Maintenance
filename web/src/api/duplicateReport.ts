/**
 * Helpers for structured duplicate / probable-duplicate create responses.
 */
import { ApiRequestError } from "./http";

// Export type alias for consumers.
export type ExistingTicketSummary = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  status: string;
  // Field/property in this shape.
  title: string;
  // Field/property in this shape.
  description?: string | null;
  // Field/property in this shape.
  locationId: string;
  // Field/property in this shape.
  priority: string;
  // Field/property in this shape.
  blocksRoom: boolean;
  // Field/property in this shape.
  assigneeId?: string | null;
  // Field/property in this shape.
  reportedByEmployeeId?: string;
  // Field/property in this shape.
  openedAt?: string;
};

// Export type alias for consumers.
export type DuplicateReportInfo = {
  // Field/property in this shape.
  code: "duplicate_active" | "probable_duplicate";
  // Field/property in this shape.
  message: string;
  // Field/property in this shape.
  existingTicket: ExistingTicketSummary | null;
  // Field/property in this shape.
  matchReason: string | null;
  // Field/property in this shape.
  suggestReopenTicketId: string | null;
};

// Function definition.
function readExisting(raw: unknown): ExistingTicketSummary | null {
  // Conditional branch for this case.
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  // Local constant binding.
  const o = raw as Record<string, unknown>;
  // Conditional branch for this case.
  if (typeof o.id !== "string" || typeof o.title !== "string") return null;
  // Return computed result to caller.
  return {
    // Field/property in this shape.
    id: o.id,
    // Field/property in this shape.
    status: typeof o.status === "string" ? o.status : "unknown",
    // Field/property in this shape.
    title: o.title,
    // Field/property in this shape.
    description: typeof o.description === "string" ? o.description : null,
    // Field/property in this shape.
    locationId: typeof o.locationId === "string" ? o.locationId : "",
    // Field/property in this shape.
    priority: typeof o.priority === "string" ? o.priority : "normal",
    // Field/property in this shape.
    blocksRoom: Boolean(o.blocksRoom),
    // Field/property in this shape.
    assigneeId: typeof o.assigneeId === "string" ? o.assigneeId : null,
    // Field/property in this shape.
    reportedByEmployeeId:
      // Assign value for subsequent use.
      typeof o.reportedByEmployeeId === "string"
        // Continue module logic.
        ? o.reportedByEmployeeId
        // Continue multi-line list/arguments.
        : undefined,
    // Field/property in this shape.
    openedAt: typeof o.openedAt === "string" ? o.openedAt : undefined,
  };
}

/** Parse a thrown API error into duplicate info, or null when unrelated. */
export function parseDuplicateReportError(
  // Field/property in this shape.
  err: unknown,
// Open multi-line construct.
): DuplicateReportInfo | null {
  // Conditional branch for this case.
  if (!(err instanceof ApiRequestError)) return null;
  // Conditional branch for this case.
  if (err.code !== "duplicate_active" && err.code !== "probable_duplicate") {
    // Return computed result to caller.
    return null;
  }
  // Local constant binding.
  const details =
    // Assign value for subsequent use.
    err.details && typeof err.details === "object" && !Array.isArray(err.details)
      // Invoke helper or pass arguments.
      ? (err.details as Record<string, unknown>)
      // Continue module logic.
      : {};
  // Local constant binding.
  const match =
    // Assign value for subsequent use.
    details.match && typeof details.match === "object"
      // Invoke helper or pass arguments.
      ? (details.match as Record<string, unknown>)
      // Continue module logic.
      : null;
  // Return computed result to caller.
  return {
    // Field/property in this shape.
    code: err.code,
    // Field/property in this shape.
    message: err.message,
    // Field/property in this shape.
    existingTicket: readExisting(details.existingTicket),
    // Field/property in this shape.
    matchReason: typeof match?.reason === "string" ? match.reason : null,
    // Field/property in this shape.
    suggestReopenTicketId:
      // Assign value for subsequent use.
      typeof details.suggestReopenTicketId === "string"
        // Continue module logic.
        ? details.suggestReopenTicketId
        // Continue multi-line list/arguments.
        : null,
  };
}
