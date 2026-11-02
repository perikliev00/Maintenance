/**
 * Maintenance tickets, issue catalog, and SLA policy REST helpers.
 * Mutations that need offline support should prefer `../offline` queued wrappers.
 */
import { API_BASE, apiFetch, apiGet, apiPatch, apiPost, authHeaders, buildQuery, parseJson } from "./http";

export type MaintenanceCategoryRow = {
  id: string;
  key: string;
  nameBg: string;
  nameEn: string;
  sortOrder: number;
  isActive: boolean;
};

export type IssueOptionRow = {
  id: string;
  maintenanceCategoryId: string;
  kind: "maintenance" | "housekeeping";
  nameBg: string;
  nameEn: string;
  defaultPriority: string | null;
  defaultBlocksRoom: boolean | null;
  sortOrder: number;
  isActive: boolean;
  maintenanceCategory?: MaintenanceCategoryRow;
};

export type MaintenanceTicket = {
  id: string;
  title: string;
  /** Optional clarification; canonical issue name stays in title. */
  description?: string | null;
  category: string;
  categoryKey?: string;
  categoryLabelBg?: string;
  categoryLabelEn?: string;
  priority: string;
  blocksRoom: boolean;
  status: string;
  openedAt: string;
  dueAt?: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  closedAt?: string | null;
  slaPausedAt?: string | null;
  location: {
    id: string;
    number: string;
    /** Present on ticket payloads; archived rooms appear in history views. */
    catalogStatus?: string;
    floor: { number: number; building: { code: string; name: string } };
  };
  reportedBy: {
    id: string;
    fullName: string;
    employeeNumber: string;
  };
  assignee?: {
    id: string;
    fullName: string;
    employeeNumber: string;
  } | null;
  resolvedBy: {
    id: string;
    fullName: string;
    employeeNumber: string;
  } | null;
  closedBy?: {
    id: string;
    fullName: string;
    employeeNumber: string;
  } | null;
  slaBreached?: boolean;
  /** Present when create succeeded after a prior closed ticket for the same identity. */
  suggestReopenTicketId?: string | null;
};

export type ReportIssueInput = {
  locationId: string;
  title?: string;
  description?: string;
  issueOptionId?: string;
  categoryId?: string;
  priority?: string;
  blocksRoom?: boolean;
  allowDuplicate?: boolean;
  duplicateOverrideReason?: string;
  confirmSimilar?: boolean;
  /** Stable idempotency key; minted when omitted. */
  commandId?: string;
};

/**
 * Create a ticket online. Sends a fresh `commandId` for server idempotency.
 * For offline-capable reporting use `reportTicketQueued` from `../offline`.
 */
export async function reportIssue(input: ReportIssueInput) {
  return apiPost("/maintenance/tickets", {
    ...input,
    commandId: input.commandId ?? crypto.randomUUID(),
  });
}

/** Catalog categories; pass `includeInactive` for admin editing. */
export async function fetchMaintenanceCategories(params?: {
  includeInactive?: boolean;
  signal?: AbortSignal;
}): Promise<MaintenanceCategoryRow[]> {
  return apiGet(
    `/maintenance/categories${buildQuery({
      includeInactive: params?.includeInactive || undefined,
    })}`,
    { signal: params?.signal },
  );
}

/** Create a maintenance category (stable `key` + bilingual names). */
export async function createMaintenanceCategory(input: {
  key: string;
  nameBg: string;
  nameEn: string;
  sortOrder?: number;
  isActive?: boolean;
}): Promise<MaintenanceCategoryRow> {
  return apiPost("/maintenance/categories", input);
}

/** Patch category display fields / sort / active flag. */
export async function updateMaintenanceCategory(
  id: string,
  input: Partial<{
    nameBg: string;
    nameEn: string;
    sortOrder: number;
    isActive: boolean;
  }>,
): Promise<MaintenanceCategoryRow> {
  return apiPatch(`/maintenance/categories/${id}`, input);
}

/** Soft-archive a category (keeps historical ticket references). */
export async function archiveMaintenanceCategory(
  id: string,
): Promise<MaintenanceCategoryRow> {
  return apiPost(`/maintenance/categories/${id}/archive`);
}

/** Issue-option catalog; optional category filter and inactive include. */
export async function fetchIssueOptions(params?: {
  includeInactive?: boolean;
  categoryId?: string;
  signal?: AbortSignal;
}): Promise<IssueOptionRow[]> {
  return apiGet(
    `/maintenance/issue-options${buildQuery({
      includeInactive: params?.includeInactive || undefined,
      categoryId: params?.categoryId,
    })}`,
    { signal: params?.signal },
  );
}

/** Create a selectable issue option under a category. */
export async function createIssueOption(input: {
  maintenanceCategoryId: string;
  kind: "maintenance" | "housekeeping";
  nameBg: string;
  nameEn: string;
  defaultPriority?: string;
  defaultBlocksRoom?: boolean;
  sortOrder?: number;
  isActive?: boolean;
}): Promise<IssueOptionRow> {
  return apiPost("/maintenance/issue-options", input);
}

/** Patch an issue option (including moving it to another category). */
export async function updateIssueOption(
  id: string,
  input: Partial<{
    maintenanceCategoryId: string;
    kind: "maintenance" | "housekeeping";
    nameBg: string;
    nameEn: string;
    defaultPriority: string | null;
    defaultBlocksRoom: boolean | null;
    sortOrder: number;
    isActive: boolean;
  }>,
): Promise<IssueOptionRow> {
  return apiPatch(`/maintenance/issue-options/${id}`, input);
}

/** Soft-archive an issue option so it no longer appears in report UIs. */
export async function archiveIssueOption(id: string): Promise<IssueOptionRow> {
  return apiPost(`/maintenance/issue-options/${id}/archive`);
}

/** Persist a new sort order; `ids` is the full ordered id list. */
export async function reorderIssueOptions(ids: string[]): Promise<IssueOptionRow[]> {
  return apiPost("/maintenance/issue-options/reorder", { ids });
}

export type TicketListPage = {
  items: MaintenanceTicket[];
  nextCursor: string | null;
  total: number;
};

type FetchTicketsParams = {
  limit?: number;
  status?: "open" | "all" | "resolved" | string;
  locationId?: string;
  mine?: boolean;
  assigneeId?: string;
  priority?: string;
  slaBreached?: boolean;
  blocksRoom?: boolean;
  /** Opaque keyset cursor from a prior paginated response. */
  cursor?: string;
  /**
   * When true (or when `cursor` is set), returns `{ items, nextCursor, total }`.
   * Legacy callers omit this and still receive a bare ticket array.
   */
  paginated?: boolean;
  signal?: AbortSignal;
};

/**
 * List tickets with optional status / assignee / SLA / blocksRoom filters.
 * `blocksRoom` uses `"1"`/`"0"` query encoding (not bare boolean strings).
 */
export async function fetchTickets(
  params: FetchTicketsParams & { paginated: true },
): Promise<TicketListPage>;
export async function fetchTickets(
  params?: FetchTicketsParams,
): Promise<MaintenanceTicket[]>;
export async function fetchTickets(
  params?: FetchTicketsParams,
): Promise<MaintenanceTicket[] | TicketListPage> {
  const wantPage = Boolean(params?.paginated || params?.cursor);
  return apiGet(
    `/maintenance/tickets${buildQuery({
      limit: params?.limit,
      status: params?.status,
      locationId: params?.locationId,
      mine: params?.mine ? "1" : undefined,
      assigneeId: params?.assigneeId,
      priority: params?.priority,
      slaBreached: params?.slaBreached ? "1" : undefined,
      blocksRoom:
        params?.blocksRoom === true
          ? "1"
          : params?.blocksRoom === false
            ? "0"
            : undefined,
      cursor: params?.cursor,
      paginated: wantPage ? "1" : undefined,
    })}`,
    { signal: params?.signal },
  );
}

/** Timeline events for one ticket (status changes, notes, SLA pauses). */
export async function fetchTicketEvents(ticketId: string) {
  return apiGet(`/maintenance/tickets/${ticketId}/events`);
}

export type SlaPolicyRow = {
  id: string;
  priority: string;
  hours: number;
  isActive: boolean;
};

/** SLA hours-by-priority policies from settings. */
export async function fetchSlaPolicies(): Promise<SlaPolicyRow[]> {
  return apiGet("/settings/sla-policies");
}

/** Replace SLA hours (and optional active flag) for one priority. */
export async function updateSlaPolicy(
  priority: string,
  input: { hours: number; isActive?: boolean },
): Promise<SlaPolicyRow> {
  const res = await apiFetch(`${API_BASE}/settings/sla-policies/${priority}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}
