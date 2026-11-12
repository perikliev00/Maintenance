/**
 * Maintenance tickets, issue catalog, and SLA policy REST helpers.
 * Mutations that need offline support should prefer `../offline` queued wrappers.
 */
import { API_BASE, apiFetch, apiGet, apiPatch, apiPost, authHeaders, buildQuery, parseJson } from "./http";

// Export type alias for consumers.
export type MaintenanceCategoryRow = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  key: string;
  // Field/property in this shape.
  nameBg: string;
  // Field/property in this shape.
  nameEn: string;
  // Field/property in this shape.
  sortOrder: number;
  // Field/property in this shape.
  isActive: boolean;
};

// Export type alias for consumers.
export type IssueOptionRow = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  maintenanceCategoryId: string;
  // Field/property in this shape.
  kind: "maintenance" | "housekeeping";
  // Field/property in this shape.
  nameBg: string;
  // Field/property in this shape.
  nameEn: string;
  // Field/property in this shape.
  defaultPriority: string | null;
  // Field/property in this shape.
  defaultBlocksRoom: boolean | null;
  // Field/property in this shape.
  sortOrder: number;
  // Field/property in this shape.
  isActive: boolean;
  // Field/property in this shape.
  maintenanceCategory?: MaintenanceCategoryRow;
};

// Export type alias for consumers.
export type MaintenanceTicket = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  title: string;
  /** Optional clarification; canonical issue name stays in title. */
  description?: string | null;
  // Field/property in this shape.
  category: string;
  // Field/property in this shape.
  categoryKey?: string;
  // Field/property in this shape.
  categoryLabelBg?: string;
  // Field/property in this shape.
  categoryLabelEn?: string;
  // Field/property in this shape.
  priority: string;
  // Field/property in this shape.
  blocksRoom: boolean;
  // Field/property in this shape.
  status: string;
  // Field/property in this shape.
  openedAt: string;
  // Field/property in this shape.
  dueAt?: string | null;
  // Field/property in this shape.
  resolvedAt: string | null;
  // Field/property in this shape.
  resolutionNotes: string | null;
  // Field/property in this shape.
  closedAt?: string | null;
  // Field/property in this shape.
  slaPausedAt?: string | null;
  // Field/property in this shape.
  location: {
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    number: string;
    /** Present on ticket payloads; archived rooms appear in history views. */
    catalogStatus?: string;
    // Field/property in this shape.
    floor: { number: number; building: { code: string; name: string } };
  };
  // Field/property in this shape.
  reportedBy: {
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    fullName: string;
    // Field/property in this shape.
    employeeNumber: string;
  };
  // Field/property in this shape.
  assignee?: {
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    fullName: string;
    // Field/property in this shape.
    employeeNumber: string;
  // Close multi-line construct with trailing syntax.
  } | null;
  // Field/property in this shape.
  resolvedBy: {
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    fullName: string;
    // Field/property in this shape.
    employeeNumber: string;
  // Close multi-line construct with trailing syntax.
  } | null;
  // Field/property in this shape.
  closedBy?: {
    // Field/property in this shape.
    id: string;
    // Field/property in this shape.
    fullName: string;
    // Field/property in this shape.
    employeeNumber: string;
  // Close multi-line construct with trailing syntax.
  } | null;
  // Field/property in this shape.
  slaBreached?: boolean;
  /** Present when create succeeded after a prior closed ticket for the same identity. */
  suggestReopenTicketId?: string | null;
};

// Export type alias for consumers.
export type ReportIssueInput = {
  // Field/property in this shape.
  locationId: string;
  // Field/property in this shape.
  title?: string;
  // Field/property in this shape.
  description?: string;
  // Field/property in this shape.
  issueOptionId?: string;
  // Field/property in this shape.
  categoryId?: string;
  // Field/property in this shape.
  priority?: string;
  // Field/property in this shape.
  blocksRoom?: boolean;
  // Field/property in this shape.
  allowDuplicate?: boolean;
  // Field/property in this shape.
  duplicateOverrideReason?: string;
  // Field/property in this shape.
  confirmSimilar?: boolean;
  /** Stable idempotency key; minted when omitted. */
  commandId?: string;
};

/**
 * Create a ticket online. Sends a fresh `commandId` for server idempotency.
 * For offline-capable reporting use `reportTicketQueued` from `../offline`.
 */
export async function reportIssue(input: ReportIssueInput) {
  // Return computed result to caller.
  return apiPost("/maintenance/tickets", {
    // Spread remaining fields/props.
    ...input,
    // Field/property in this shape.
    commandId: input.commandId ?? crypto.randomUUID(),
  });
}

/** Catalog categories; pass `includeInactive` for admin editing. */
export async function fetchMaintenanceCategories(params?: {
  // Field/property in this shape.
  includeInactive?: boolean;
  // Field/property in this shape.
  signal?: AbortSignal;
// Open multi-line construct.
}): Promise<MaintenanceCategoryRow[]> {
  // Return computed result to caller.
  return apiGet(
    // Open multi-line construct.
    `/maintenance/categories${buildQuery({
      // Field/property in this shape.
      includeInactive: params?.includeInactive || undefined,
    // Continue multi-line list/arguments.
    })}`,
    // Continue multi-line list/arguments.
    { signal: params?.signal },
  );
}

/** Create a maintenance category (stable `key` + bilingual names). */
export async function createMaintenanceCategory(input: {
  // Field/property in this shape.
  key: string;
  // Field/property in this shape.
  nameBg: string;
  // Field/property in this shape.
  nameEn: string;
  // Field/property in this shape.
  sortOrder?: number;
  // Field/property in this shape.
  isActive?: boolean;
// Open multi-line construct.
}): Promise<MaintenanceCategoryRow> {
  // Return computed result to caller.
  return apiPost("/maintenance/categories", input);
}

/** Patch category display fields / sort / active flag. */
export async function updateMaintenanceCategory(
  // Field/property in this shape.
  id: string,
  // Field/property in this shape.
  input: Partial<{
    // Field/property in this shape.
    nameBg: string;
    // Field/property in this shape.
    nameEn: string;
    // Field/property in this shape.
    sortOrder: number;
    // Field/property in this shape.
    isActive: boolean;
  // Continue multi-line list/arguments.
  }>,
// Open multi-line construct.
): Promise<MaintenanceCategoryRow> {
  // Return computed result to caller.
  return apiPatch(`/maintenance/categories/${id}`, input);
}

/** Soft-archive a category (keeps historical ticket references). */
export async function archiveMaintenanceCategory(
  // Field/property in this shape.
  id: string,
// Open multi-line construct.
): Promise<MaintenanceCategoryRow> {
  // Return computed result to caller.
  return apiPost(`/maintenance/categories/${id}/archive`);
}

/** Issue-option catalog; optional category filter and inactive include. */
export async function fetchIssueOptions(params?: {
  // Field/property in this shape.
  includeInactive?: boolean;
  // Field/property in this shape.
  categoryId?: string;
  // Field/property in this shape.
  signal?: AbortSignal;
// Open multi-line construct.
}): Promise<IssueOptionRow[]> {
  // Return computed result to caller.
  return apiGet(
    // Open multi-line construct.
    `/maintenance/issue-options${buildQuery({
      // Field/property in this shape.
      includeInactive: params?.includeInactive || undefined,
      // Field/property in this shape.
      categoryId: params?.categoryId,
    // Continue multi-line list/arguments.
    })}`,
    // Continue multi-line list/arguments.
    { signal: params?.signal },
  );
}

/** Create a selectable issue option under a category. */
export async function createIssueOption(input: {
  // Field/property in this shape.
  maintenanceCategoryId: string;
  // Field/property in this shape.
  kind: "maintenance" | "housekeeping";
  // Field/property in this shape.
  nameBg: string;
  // Field/property in this shape.
  nameEn: string;
  // Field/property in this shape.
  defaultPriority?: string;
  // Field/property in this shape.
  defaultBlocksRoom?: boolean;
  // Field/property in this shape.
  sortOrder?: number;
  // Field/property in this shape.
  isActive?: boolean;
// Open multi-line construct.
}): Promise<IssueOptionRow> {
  // Return computed result to caller.
  return apiPost("/maintenance/issue-options", input);
}

/** Patch an issue option (including moving it to another category). */
export async function updateIssueOption(
  // Field/property in this shape.
  id: string,
  // Field/property in this shape.
  input: Partial<{
    // Field/property in this shape.
    maintenanceCategoryId: string;
    // Field/property in this shape.
    kind: "maintenance" | "housekeeping";
    // Field/property in this shape.
    nameBg: string;
    // Field/property in this shape.
    nameEn: string;
    // Field/property in this shape.
    defaultPriority: string | null;
    // Field/property in this shape.
    defaultBlocksRoom: boolean | null;
    // Field/property in this shape.
    sortOrder: number;
    // Field/property in this shape.
    isActive: boolean;
  // Continue multi-line list/arguments.
  }>,
// Open multi-line construct.
): Promise<IssueOptionRow> {
  // Return computed result to caller.
  return apiPatch(`/maintenance/issue-options/${id}`, input);
}

/** Soft-archive an issue option so it no longer appears in report UIs. */
export async function archiveIssueOption(id: string): Promise<IssueOptionRow> {
  // Return computed result to caller.
  return apiPost(`/maintenance/issue-options/${id}/archive`);
}

/** Persist a new sort order; `ids` is the full ordered id list. */
export async function reorderIssueOptions(ids: string[]): Promise<IssueOptionRow[]> {
  // Return computed result to caller.
  return apiPost("/maintenance/issue-options/reorder", { ids });
}

// Export type alias for consumers.
export type TicketListPage = {
  // Field/property in this shape.
  items: MaintenanceTicket[];
  // Field/property in this shape.
  nextCursor: string | null;
  // Field/property in this shape.
  total: number;
};

// Local type alias shaping data.
type FetchTicketsParams = {
  // Field/property in this shape.
  limit?: number;
  // Field/property in this shape.
  status?: "open" | "all" | "resolved" | string;
  // Field/property in this shape.
  locationId?: string;
  // Field/property in this shape.
  mine?: boolean;
  // Field/property in this shape.
  assigneeId?: string;
  // Field/property in this shape.
  priority?: string;
  // Field/property in this shape.
  slaBreached?: boolean;
  // Field/property in this shape.
  blocksRoom?: boolean;
  /** Opaque keyset cursor from a prior paginated response. */
  cursor?: string;
  /**
   * When true (or when `cursor` is set), returns `{ items, nextCursor, total }`.
   * Legacy callers omit this and still receive a bare ticket array.
   */
  paginated?: boolean;
  // Field/property in this shape.
  signal?: AbortSignal;
};

/**
 * List tickets with optional status / assignee / SLA / blocksRoom filters.
 * `blocksRoom` uses `"1"`/`"0"` query encoding (not bare boolean strings).
 */
export async function fetchTickets(
  // Field/property in this shape.
  params: FetchTicketsParams & { paginated: true },
// Close multi-line construct with trailing syntax.
): Promise<TicketListPage>;
// Exported async function entry point.
export async function fetchTickets(
  // Field/property in this shape.
  params?: FetchTicketsParams,
// Close multi-line construct with trailing syntax.
): Promise<MaintenanceTicket[]>;
// Exported async function entry point.
export async function fetchTickets(
  // Field/property in this shape.
  params?: FetchTicketsParams,
// Open multi-line construct.
): Promise<MaintenanceTicket[] | TicketListPage> {
  // Local constant binding.
  const wantPage = Boolean(params?.paginated || params?.cursor);
  // Return computed result to caller.
  return apiGet(
    // Open multi-line construct.
    `/maintenance/tickets${buildQuery({
      // Field/property in this shape.
      limit: params?.limit,
      // Field/property in this shape.
      status: params?.status,
      // Field/property in this shape.
      locationId: params?.locationId,
      // Field/property in this shape.
      mine: params?.mine ? "1" : undefined,
      // Field/property in this shape.
      assigneeId: params?.assigneeId,
      // Field/property in this shape.
      priority: params?.priority,
      // Field/property in this shape.
      slaBreached: params?.slaBreached ? "1" : undefined,
      // Field/property in this shape.
      blocksRoom:
        // Assign value for subsequent use.
        params?.blocksRoom === true
          // Continue module logic.
          ? "1"
          // Assign value for subsequent use.
          : params?.blocksRoom === false
            // Continue module logic.
            ? "0"
            // Continue multi-line list/arguments.
            : undefined,
      // Field/property in this shape.
      cursor: params?.cursor,
      // Field/property in this shape.
      paginated: wantPage ? "1" : undefined,
    // Continue multi-line list/arguments.
    })}`,
    // Continue multi-line list/arguments.
    { signal: params?.signal },
  );
}

/** Timeline events for one ticket (status changes, notes, SLA pauses). */
export async function fetchTicketEvents(ticketId: string) {
  // Return computed result to caller.
  return apiGet(`/maintenance/tickets/${ticketId}/events`);
}

// Export type alias for consumers.
export type SlaPolicyRow = {
  // Field/property in this shape.
  id: string;
  // Field/property in this shape.
  priority: string;
  // Field/property in this shape.
  hours: number;
  // Field/property in this shape.
  isActive: boolean;
};

/** SLA hours-by-priority policies from settings. */
export async function fetchSlaPolicies(): Promise<SlaPolicyRow[]> {
  // Return computed result to caller.
  return apiGet("/settings/sla-policies");
}

/** Replace SLA hours (and optional active flag) for one priority. */
export async function updateSlaPolicy(
  // Field/property in this shape.
  priority: string,
  // Field/property in this shape.
  input: { hours: number; isActive?: boolean },
// Open multi-line construct.
): Promise<SlaPolicyRow> {
  // Local constant binding.
  const res = await apiFetch(`${API_BASE}/settings/sla-policies/${priority}`, {
    // Field/property in this shape.
    method: "PUT",
    // Field/property in this shape.
    headers: authHeaders(),
    // Field/property in this shape.
    body: JSON.stringify(input),
  });
  // Return computed result to caller.
  return parseJson(res);
}
