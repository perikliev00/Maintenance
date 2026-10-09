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
};

export async function reportIssue(input: {
  locationId: string;
  title?: string;
  issueOptionId?: string;
  categoryId?: string;
  priority?: string;
  blocksRoom: boolean;
}) {
  const res = await apiFetch(`${API_BASE}/maintenance/tickets`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      ...input,
      commandId: crypto.randomUUID(),
    }),
  });
  return parseJson(res);
}

export async function fetchMaintenanceCategories(params?: {
  includeInactive?: boolean;
  signal?: AbortSignal;
}): Promise<MaintenanceCategoryRow[]> {
  const q = new URLSearchParams();
  if (params?.includeInactive) q.set("includeInactive", "true");
  const qs = q.toString();
  const res = await apiFetch(
    `${API_BASE}/maintenance/categories${qs ? `?${qs}` : ""}`,
    { headers: authHeaders(), signal: params?.signal },
  );
  return parseJson(res);
}

export async function createMaintenanceCategory(input: {
  key: string;
  nameBg: string;
  nameEn: string;
  sortOrder?: number;
  isActive?: boolean;
}): Promise<MaintenanceCategoryRow> {
  const res = await apiFetch(`${API_BASE}/maintenance/categories`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function updateMaintenanceCategory(
  id: string,
  input: Partial<{
    nameBg: string;
    nameEn: string;
    sortOrder: number;
    isActive: boolean;
  }>,
): Promise<MaintenanceCategoryRow> {
  const res = await apiFetch(`${API_BASE}/maintenance/categories/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function archiveMaintenanceCategory(
  id: string,
): Promise<MaintenanceCategoryRow> {
  const res = await apiFetch(`${API_BASE}/maintenance/categories/${id}/archive`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function fetchIssueOptions(params?: {
  includeInactive?: boolean;
  categoryId?: string;
  signal?: AbortSignal;
}): Promise<IssueOptionRow[]> {
  const q = new URLSearchParams();
  if (params?.includeInactive) q.set("includeInactive", "true");
  if (params?.categoryId) q.set("categoryId", params.categoryId);
  const qs = q.toString();
  const res = await apiFetch(
    `${API_BASE}/maintenance/issue-options${qs ? `?${qs}` : ""}`,
    { headers: authHeaders(), signal: params?.signal },
  );
  return parseJson(res);
}

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
  const res = await apiFetch(`${API_BASE}/maintenance/issue-options`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

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
  const res = await apiFetch(`${API_BASE}/maintenance/issue-options/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function archiveIssueOption(id: string): Promise<IssueOptionRow> {
  const res = await apiFetch(`${API_BASE}/maintenance/issue-options/${id}/archive`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function reorderIssueOptions(ids: string[]): Promise<IssueOptionRow[]> {
  const res = await apiFetch(`${API_BASE}/maintenance/issue-options/reorder`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ids }),
  });
  return parseJson(res);
}

export async function fetchTickets(params?: {
  limit?: number;
  status?: "open" | "all" | "resolved" | string;
  locationId?: string;
  mine?: boolean;
  assigneeId?: string;
  priority?: string;
  slaBreached?: boolean;
  blocksRoom?: boolean;
}): Promise<MaintenanceTicket[]> {
  const search = new URLSearchParams();
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.status) search.set("status", params.status);
  if (params?.locationId) search.set("locationId", params.locationId);
  if (params?.mine) search.set("mine", "1");
  if (params?.assigneeId) search.set("assigneeId", params.assigneeId);
  if (params?.priority) search.set("priority", params.priority);
  if (params?.slaBreached) search.set("slaBreached", "1");
  if (params?.blocksRoom === true) search.set("blocksRoom", "1");
  if (params?.blocksRoom === false) search.set("blocksRoom", "0");
  const qs = search.toString();
  const res = await apiFetch(`${API_BASE}/maintenance/tickets${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function resolveIssue(ticketId: string, resolutionNotes?: string) {
  const res = await apiFetch(`${API_BASE}/maintenance/tickets/${ticketId}/resolve`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      ...(resolutionNotes?.trim()
        ? { resolutionNotes: resolutionNotes.trim() }
        : {}),
    }),
  });
  return parseJson(res);
}

export async function assignIssue(ticketId: string, assigneeId: string) {
  const res = await apiFetch(`${API_BASE}/maintenance/tickets/${ticketId}/assign`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ assigneeId }),
  });
  return parseJson(res);
}

export async function startIssue(ticketId: string) {
  const res = await apiFetch(`${API_BASE}/maintenance/tickets/${ticketId}/start`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function waitIssue(ticketId: string, reason?: string) {
  const res = await apiFetch(`${API_BASE}/maintenance/tickets/${ticketId}/wait`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      ...(reason?.trim() ? { reason: reason.trim() } : {}),
    }),
  });
  return parseJson(res);
}

export async function resumeIssue(ticketId: string) {
  const res = await apiFetch(`${API_BASE}/maintenance/tickets/${ticketId}/resume`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function closeIssue(ticketId: string) {
  const res = await apiFetch(`${API_BASE}/maintenance/tickets/${ticketId}/close`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function fetchTicketEvents(ticketId: string) {
  const res = await apiFetch(
    `${API_BASE}/maintenance/tickets/${ticketId}/events`,
    { headers: authHeaders() },
  );
  return parseJson(res);
}

export type SlaPolicyRow = {
  id: string;
  priority: string;
  hours: number;
  isActive: boolean;
};

export async function fetchSlaPolicies(): Promise<SlaPolicyRow[]> {
  const res = await apiFetch(`${API_BASE}/settings/sla-policies`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

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

export async function reopenIssue(ticketId: string, reason?: string) {
  const res = await apiFetch(
    `${API_BASE}/maintenance/tickets/${ticketId}/reopen`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      }),
    },
  );
  return parseJson(res);
}
