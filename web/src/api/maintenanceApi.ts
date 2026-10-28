/**
 * Maintenance tickets, issue catalog, and SLA policy REST helpers.
 * Mutations that need offline support should prefer `../offline` queued wrappers.
 */
import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";

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
  // Online path always mint a fresh commandId for server idempotency.
  const res = await apiFetch(`${API_BASE}/maintenance/tickets`, {
    method: "POST",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify({
      ...input,
      commandId: input.commandId ?? crypto.randomUUID(),
    }),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Catalog categories; pass `includeInactive` for admin editing. */
export async function fetchMaintenanceCategories(params?: {
  includeInactive?: boolean;
  signal?: AbortSignal;
}): Promise<MaintenanceCategoryRow[]> {
  // Build query string.
  const q = new URLSearchParams();
  // Branch: conditional gate.
  if (params?.includeInactive) q.set("includeInactive", "true");
  // Optional query suffix.
  const qs = q.toString();
  // Authenticated HTTP request.
  const res = await apiFetch(
    `${API_BASE}/maintenance/categories${qs ? `?${qs}` : ""}`,
    { headers: authHeaders(), signal: params?.signal },
  );
  // Return value / early exit.
  return parseJson(res);
}

/** Create a maintenance category (stable `key` + bilingual names). */
export async function createMaintenanceCategory(input: {
  key: string;
  nameBg: string;
  nameEn: string;
  sortOrder?: number;
  isActive?: boolean;
}): Promise<MaintenanceCategoryRow> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/maintenance/categories`, {
    method: "POST",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify(input),
  });
  // Return value / early exit.
  return parseJson(res);
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
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/maintenance/categories/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify(input),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Soft-archive a category (keeps historical ticket references). */
export async function archiveMaintenanceCategory(
  id: string,
): Promise<MaintenanceCategoryRow> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/maintenance/categories/${id}/archive`, {
    method: "POST",
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Issue-option catalog; optional category filter and inactive include. */
export async function fetchIssueOptions(params?: {
  includeInactive?: boolean;
  categoryId?: string;
  signal?: AbortSignal;
}): Promise<IssueOptionRow[]> {
  // Build query string.
  const q = new URLSearchParams();
  // Branch: conditional gate.
  if (params?.includeInactive) q.set("includeInactive", "true");
  // Branch: conditional gate.
  if (params?.categoryId) q.set("categoryId", params.categoryId);
  // Optional query suffix.
  const qs = q.toString();
  // Authenticated HTTP request.
  const res = await apiFetch(
    `${API_BASE}/maintenance/issue-options${qs ? `?${qs}` : ""}`,
    { headers: authHeaders(), signal: params?.signal },
  );
  // Return value / early exit.
  return parseJson(res);
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
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/maintenance/issue-options`, {
    method: "POST",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify(input),
  });
  // Return value / early exit.
  return parseJson(res);
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
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/maintenance/issue-options/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify(input),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Soft-archive an issue option so it no longer appears in report UIs. */
export async function archiveIssueOption(id: string): Promise<IssueOptionRow> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/maintenance/issue-options/${id}/archive`, {
    method: "POST",
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Persist a new sort order; `ids` is the full ordered id list. */
export async function reorderIssueOptions(ids: string[]): Promise<IssueOptionRow[]> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/maintenance/issue-options/reorder`, {
    method: "POST",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify({ ids }),
  });
  // Return value / early exit.
  return parseJson(res);
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
  const search = new URLSearchParams();
  // Branch: conditional gate.
  if (params?.limit) search.set("limit", String(params.limit));
  // Branch: conditional gate.
  if (params?.status) search.set("status", params.status);
  // Branch: conditional gate.
  if (params?.locationId) search.set("locationId", params.locationId);
  // Branch: conditional gate.
  if (params?.mine) search.set("mine", "1");
  // Branch: conditional gate.
  if (params?.assigneeId) search.set("assigneeId", params.assigneeId);
  // Branch: conditional gate.
  if (params?.priority) search.set("priority", params.priority);
  // Branch: conditional gate.
  if (params?.slaBreached) search.set("slaBreached", "1");
  // Explicit true/false — omit when undefined so the server does not filter.
  if (params?.blocksRoom === true) search.set("blocksRoom", "1");
  // Branch: conditional gate.
  if (params?.blocksRoom === false) search.set("blocksRoom", "0");
  if (params?.cursor) search.set("cursor", params.cursor);
  const wantPage = Boolean(params?.paginated || params?.cursor);
  if (wantPage) search.set("paginated", "1");
  // Optional query suffix.
  const qs = search.toString();
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/maintenance/tickets${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
    signal: params?.signal,
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Assign (or reassign) a ticket to an employee. */
export async function assignIssue(ticketId: string, assigneeId: string) {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/maintenance/tickets/${ticketId}/assign`, {
    method: "POST",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify({ assigneeId }),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Close a resolved ticket (final lifecycle step). */
export async function closeIssue(ticketId: string) {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/maintenance/tickets/${ticketId}/close`, {
    method: "POST",
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Timeline events for one ticket (status changes, notes, SLA pauses). */
export async function fetchTicketEvents(ticketId: string) {
  // Authenticated HTTP request.
  const res = await apiFetch(
    `${API_BASE}/maintenance/tickets/${ticketId}/events`,
    { headers: authHeaders() },
  );
  // Return value / early exit.
  return parseJson(res);
}

export type SlaPolicyRow = {
  id: string;
  priority: string;
  hours: number;
  isActive: boolean;
};

/** SLA hours-by-priority policies from settings. */
export async function fetchSlaPolicies(): Promise<SlaPolicyRow[]> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/settings/sla-policies`, {
    headers: authHeaders(),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Replace SLA hours (and optional active flag) for one priority. */
export async function updateSlaPolicy(
  priority: string,
  input: { hours: number; isActive?: boolean },
): Promise<SlaPolicyRow> {
  // Authenticated HTTP request.
  const res = await apiFetch(`${API_BASE}/settings/sla-policies/${priority}`, {
    method: "PUT",
    headers: authHeaders(),
    // Serialize request body.
    body: JSON.stringify(input),
  });
  // Return value / early exit.
  return parseJson(res);
}

/** Reopen a closed/resolved ticket; optional trimmed reason for audit. */
export async function reopenIssue(ticketId: string, reason?: string) {
  // Authenticated HTTP request.
  const res = await apiFetch(
    `${API_BASE}/maintenance/tickets/${ticketId}/reopen`,
    {
      method: "POST",
      headers: authHeaders(),
      // Serialize request body.
      body: JSON.stringify({
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      }),
    },
  );
  // Return value / early exit.
  return parseJson(res);
}
