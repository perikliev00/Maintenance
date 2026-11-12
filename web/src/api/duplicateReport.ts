/**
 * Helpers for structured duplicate / probable-duplicate create responses.
 */
import { ApiRequestError } from "./http";

export type ExistingTicketSummary = {
  id: string;
  status: string;
  title: string;
  description?: string | null;
  locationId: string;
  priority: string;
  blocksRoom: boolean;
  assigneeId?: string | null;
  reportedByEmployeeId?: string;
  openedAt?: string;
};

export type DuplicateReportInfo = {
  code: "duplicate_active" | "probable_duplicate";
  message: string;
  existingTicket: ExistingTicketSummary | null;
  matchReason: string | null;
  suggestReopenTicketId: string | null;
};

// Function definition.
function readExisting(raw: unknown): ExistingTicketSummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.title !== "string") return null;
  return {
    id: o.id,
    status: typeof o.status === "string" ? o.status : "unknown",
    title: o.title,
    description: typeof o.description === "string" ? o.description : null,
    locationId: typeof o.locationId === "string" ? o.locationId : "",
    priority: typeof o.priority === "string" ? o.priority : "normal",
    blocksRoom: Boolean(o.blocksRoom),
    assigneeId: typeof o.assigneeId === "string" ? o.assigneeId : null,
    reportedByEmployeeId:
      typeof o.reportedByEmployeeId === "string"
        // Continue module logic.
        ? o.reportedByEmployeeId
        : undefined,
    openedAt: typeof o.openedAt === "string" ? o.openedAt : undefined,
  };
}

/** Parse a thrown API error into duplicate info, or null when unrelated. */
export function parseDuplicateReportError(
  err: unknown,
): DuplicateReportInfo | null {
  if (!(err instanceof ApiRequestError)) return null;
  if (err.code !== "duplicate_active" && err.code !== "probable_duplicate") {
    return null;
  }
  const details =
    err.details && typeof err.details === "object" && !Array.isArray(err.details)
      ? (err.details as Record<string, unknown>)
      // Continue module logic.
      : {};
  const match =
    details.match && typeof details.match === "object"
      ? (details.match as Record<string, unknown>)
      // Continue module logic.
      : null;
  return {
    code: err.code,
    message: err.message,
    existingTicket: readExisting(details.existingTicket),
    matchReason: typeof match?.reason === "string" ? match.reason : null,
    suggestReopenTicketId:
      typeof details.suggestReopenTicketId === "string"
        // Continue module logic.
        ? details.suggestReopenTicketId
        : null,
  };
}
