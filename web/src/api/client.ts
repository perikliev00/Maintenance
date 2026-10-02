const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type Role =
  | "reception"
  | "housekeeper"
  | "supervisor"
  | "technician"
  | "manager"
  | "admin"
  | "owner";

export const ROLE_LABELS: Record<Role, string> = {
  owner: "собственик",
  housekeeper: "камериер",
  technician: "техник",
  reception: "рецепция",
  supervisor: "супервайзър",
  manager: "управител",
  admin: "администратор",
};

export const ALL_ROLES: Role[] = [
  "owner",
  "admin",
  "manager",
  "supervisor",
  "reception",
  "technician",
  "housekeeper",
];

export type Panel = "home" | "rooms" | "team" | "control";

export type Action =
  | "rooms.view"
  | "rooms.mark_dirty"
  | "cleaning.create"
  | "cleaning.start"
  | "cleaning.complete"
  | "cleaning.inspect"
  | "cleaning.reassign"
  | "cleaning.review_overdue"
  | "tickets.report"
  | "tickets.resolve"
  | "people.view"
  | "people.change_role"
  | "control.access";

const ALL_PANELS: Panel[] = ["home", "rooms", "team", "control"];

const PANEL_BY_ROLE: Record<Exclude<Role, "owner">, Panel[]> = {
  housekeeper: ["home", "rooms"],
  technician: ["home", "rooms"],
  reception: ["home", "rooms"],
  supervisor: ["home", "rooms", "team"],
  manager: ["home", "rooms", "team", "control"],
  admin: ["home", "rooms", "team"],
};

const LANDING_BY_ROLE: Record<Role, Panel> = {
  housekeeper: "home",
  technician: "home",
  reception: "rooms",
  supervisor: "rooms",
  manager: "control",
  admin: "team",
  owner: "control",
};

export function isOwner(role: Role): boolean {
  return role === "owner";
}

/** Client-side mirror of server registry (offline / stale session fallback). */
export function panelsForRole(role: Role): Panel[] {
  if (isOwner(role)) return [...ALL_PANELS];
  return [...PANEL_BY_ROLE[role as Exclude<Role, "owner">]];
}

export function landingForRole(role: Role): Panel {
  return LANDING_BY_ROLE[role];
}

export function canViewTeam(role: Role): boolean {
  return panelsForRole(role).includes("team");
}

export function canViewControl(role: Role): boolean {
  return panelsForRole(role).includes("control");
}

export function canResolveIssues(role: Role): boolean {
  return isOwner(role) || ["supervisor", "manager", "technician", "admin"].includes(role);
}

export function canPerformAction(user: AuthUser, action: Action): boolean {
  if (isOwner(user.role)) return true;
  if (user.actions?.length) return user.actions.includes(action);
  // Fallback mirrors when session predates capabilities
  if (action === "tickets.resolve") return canResolveIssues(user.role);
  if (action === "people.view") return canViewTeam(user.role);
  if (action === "control.access" || action === "people.change_role") {
    return canViewControl(user.role);
  }
  return false;
}

export function panelsForUser(user: AuthUser): Panel[] {
  if (user.panels?.length) return user.panels;
  return panelsForRole(user.role);
}

export function landingForUser(user: AuthUser): Panel {
  if (user.landing) return user.landing;
  return landingForRole(user.role);
}

/** Roles a manager is allowed to assign via Control. */
export function assignableRolesFor(actor: Role): Role[] {
  if (actor === "owner") return [...ALL_ROLES];
  if (actor === "manager") {
    return ALL_ROLES.filter((r) => r !== "owner" && r !== "admin");
  }
  return [];
}

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  employeeId: string;
  fullName: string;
  panels?: Panel[];
  actions?: Action[];
  landing?: Panel;
};

export type MaintenanceTicket = {
  id: string;
  title: string;
  category: string;
  priority: string;
  blocksRoom: boolean;
  status: string;
  openedAt: string;
  resolvedAt: string | null;
  resolutionNotes: string | null;
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
  resolvedBy: {
    id: string;
    fullName: string;
    employeeNumber: string;
  } | null;
};

export type Person = {
  id: string;
  employeeId: string;
  fullName: string;
  employeeNumber: string;
  email: string;
  role: Role;
  department: string | null;
  isActive: boolean;
  createdAt: string;
};

export type Room = {
  id: string;
  number: string;
  floor: number;
  floorName: string;
  building: string;
  buildingCode: string;
  catalogStatus: string;
  occupancy: string;
  cleaningStatus: string;
  serviceStatus: string;
  readiness: "ready" | "not_ready" | "needs_check";
  readinessReasons: string[];
  blockingIssues: Array<{
    id: string;
    title: string;
    category: string;
    priority: string;
    status: string;
  }>;
  activeTask: {
    id: string;
    status: string;
    priority: string;
    dueAt: string | null;
    version: number;
    reassignReason: string | null;
    assignee: { id: string; fullName: string; employeeNumber: string } | null;
    runningSession: {
      id: string;
      startedAt: string;
      employeeId: string;
    } | null;
    lastCompletedSession: {
      id: string;
      finishedAt: string | null;
      notes: string | null;
      employee: { id: string; fullName: string; employeeNumber: string };
    } | null;
    lastInspection: {
      id: string;
      result: string;
      findings: string | null;
      inspectedAt: string;
      inspector: { id: string; fullName: string; employeeNumber: string };
    } | null;
  } | null;
};

export type OverdueSession = {
  sessionId: string;
  taskId: string;
  startedAt: string;
  elapsedMinutes: number;
  employee: { id: string; fullName: string; employeeNumber: string };
  room: { id: string; number: string; buildingCode: string; floor: number };
};

type ApiError = {
  error?: string;
  message?: string;
};

function authHeaders(): HeadersInit {
  const token = getToken();
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as ApiError;
    throw new Error(err.message ?? err.error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export function getToken(): string | null {
  return localStorage.getItem("token");
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function clearToken() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await parseJson<{ token: string; user: AuthUser }>(res);
  localStorage.setItem("token", data.token);
  localStorage.setItem("user", JSON.stringify(data.user));
  return data;
}

export async function fetchMe(): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/auth/me`, { headers: authHeaders() });
  const user = await parseJson<AuthUser>(res);
  localStorage.setItem("user", JSON.stringify(user));
  return user;
}

export async function fetchRooms(): Promise<Room[]> {
  const res = await fetch(`${API_BASE}/rooms`, { headers: authHeaders() });
  return parseJson(res);
}

export async function markRoomDirty(roomId: string): Promise<Room> {
  const res = await fetch(`${API_BASE}/rooms/${roomId}/mark-dirty`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function createCleaningTask(input: {
  locationId: string;
  hotelDate: string;
  priority?: string;
  assignedEmployeeId?: string;
  dueAt?: string;
}) {
  const res = await fetch(`${API_BASE}/cleaning/tasks`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function startCleaningTask(taskId: string, expectedVersion?: number) {
  const res = await fetch(`${API_BASE}/cleaning/tasks/${taskId}/start`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      expectedVersion,
    }),
  });
  return parseJson(res);
}

export async function completeCleaningSession(sessionId: string, notes?: string) {
  const res = await fetch(`${API_BASE}/cleaning/sessions/${sessionId}/complete`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      ...(notes?.trim() ? { notes: notes.trim() } : {}),
    }),
  });
  return parseJson(res);
}

export async function inspectCleaningTask(
  taskId: string,
  result: "approved" | "rejected",
  findings?: string,
) {
  const res = await fetch(`${API_BASE}/cleaning/tasks/${taskId}/inspect`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      result,
      findings,
    }),
  });
  return parseJson(res);
}

export async function reassignCleaningTask(
  taskId: string,
  assignedEmployeeId: string,
  reason: string,
  expectedVersion?: number,
) {
  const res = await fetch(`${API_BASE}/cleaning/tasks/${taskId}/reassign`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      assignedEmployeeId,
      reason,
      expectedVersion,
    }),
  });
  return parseJson(res);
}

export async function fetchOverdueSessions(): Promise<OverdueSession[]> {
  const res = await fetch(`${API_BASE}/cleaning/sessions/review`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function reportIssue(input: {
  locationId: string;
  title: string;
  category: string;
  priority?: string;
  blocksRoom: boolean;
}) {
  const res = await fetch(`${API_BASE}/maintenance/tickets`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      ...input,
      commandId: crypto.randomUUID(),
    }),
  });
  return parseJson(res);
}

export async function fetchTickets(params?: {
  limit?: number;
  status?: "open" | "all" | "resolved";
  locationId?: string;
}): Promise<MaintenanceTicket[]> {
  const search = new URLSearchParams();
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.status) search.set("status", params.status);
  if (params?.locationId) search.set("locationId", params.locationId);
  const qs = search.toString();
  const res = await fetch(`${API_BASE}/maintenance/tickets${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function resolveIssue(ticketId: string, resolutionNotes?: string) {
  const res = await fetch(`${API_BASE}/maintenance/tickets/${ticketId}/resolve`, {
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

export async function fetchHousekeepers() {
  const res = await fetch(`${API_BASE}/cleaning/employees/housekeepers`, {
    headers: authHeaders(),
  });
  return parseJson<Array<{ id: string; fullName: string; employeeNumber: string }>>(res);
}

export async function fetchPeople(params?: {
  q?: string;
  role?: string;
  includeInactive?: boolean;
}): Promise<Person[]> {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.role) search.set("role", params.role);
  if (params?.includeInactive) search.set("includeInactive", "true");
  const qs = search.toString();
  const res = await fetch(`${API_BASE}/people${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function updatePersonRole(userId: string, role: Role): Promise<Person> {
  const res = await fetch(`${API_BASE}/people/${userId}/role`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ role }),
  });
  return parseJson(res);
}

export function todayHotelDate(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
