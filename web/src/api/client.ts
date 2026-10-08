import {
  classifyRefreshFailure,
  type RefreshOutcome,
} from "./sessionPolicy";

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

export type { RefreshOutcome };

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

export type Panel =
  | "mywork"
  | "repairs"
  | "home"
  | "rooms"
  | "common"
  | "team"
  | "live"
  | "plan"
  | "attendance"
  | "cards"
  | "results"
  | "analytics"
  | "cleaning"
  | "audit"
  | "control"
  | "settings"
  | "permissions"
  | "notifications";

export type Action =
  | "rooms.view"
  | "rooms.mark_dirty"
  | "rooms.manage"
  | "rooms.set_occupancy"
  | "rooms.set_service_status"
  | "cleaning.create"
  | "cleaning.start"
  | "cleaning.complete"
  | "cleaning.inspect"
  | "cleaning.reassign"
  | "cleaning.review_overdue"
  | "cleaning.results_view"
  | "operations.view_live"
  | "tickets.report"
  | "tickets.resolve"
  | "tickets.assign"
  | "tickets.close"
  | "people.view"
  | "people.change_role"
  | "people.invite"
  | "control.access"
  | "settings.manage"
  | "permissions.manage"
  | "plan.view"
  | "plan.manage"
  | "attendance.view"
  | "attendance.ingest"
  | "attendance.request_adjustment"
  | "attendance.approve_adjustment"
  | "cards.view"
  | "cards.issue"
  | "cards.revoke"
  | "analytics.view"
  | "sectors.manage"
  | "sectors.transfer_cross"
  | "shifts.manage"
  | "issue_options.manage"
  | "audit.view"
  | "jobs.view";

const ALL_PANELS: Panel[] = [
  "mywork",
  "repairs",
  "home",
  "rooms",
  "common",
  "team",
  "live",
  "plan",
  "attendance",
  "cards",
  "results",
  "analytics",
  "cleaning",
  "audit",
  "control",
  "settings",
  "permissions",
  "notifications",
];

const PANEL_BY_ROLE: Record<Exclude<Role, "owner">, Panel[]> = {
  housekeeper: ["mywork", "home", "rooms", "common"],
  technician: ["mywork", "repairs", "home", "rooms", "common"],
  reception: ["home", "rooms", "common", "plan", "cards"],
  supervisor: [
    "home",
    "rooms",
    "common",
    "team",
    "live",
    "plan",
    "attendance",
    "cards",
    "results",
    "analytics",
    "cleaning",
    "repairs",
  ],
  manager: [
    "home",
    "rooms",
    "common",
    "team",
    "live",
    "plan",
    "attendance",
    "cards",
    "results",
    "analytics",
    "cleaning",
    "repairs",
    "audit",
    "control",
    "settings",
    "permissions",
  ],
  admin: [
    "home",
    "rooms",
    "common",
    "team",
    "plan",
    "attendance",
    "cards",
    "results",
    "analytics",
    "cleaning",
    "repairs",
    "audit",
    "settings",
    "permissions",
  ],
};

const LANDING_BY_ROLE: Record<Role, Panel> = {
  housekeeper: "mywork",
  technician: "mywork",
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

export function canAssignIssues(role: Role): boolean {
  return (
    isOwner(role) ||
    ["reception", "supervisor", "manager", "admin"].includes(role)
  );
}

export function canCloseIssues(role: Role): boolean {
  return isOwner(role) || ["supervisor", "manager", "admin"].includes(role);
}

export function canPerformAction(user: AuthUser, action: Action): boolean {
  if (isOwner(user.role)) return true;
  if (user.actions?.length) return user.actions.includes(action);
  // Fallback mirrors when session predates capabilities
  if (action === "tickets.resolve") return canResolveIssues(user.role);
  if (action === "tickets.assign") return canAssignIssues(user.role);
  if (action === "tickets.close") return canCloseIssues(user.role);
  if (action === "people.view") return canViewTeam(user.role);
  if (action === "people.invite") {
    return ["manager", "admin"].includes(user.role);
  }
  if (action === "control.access" || action === "people.change_role") {
    return canViewControl(user.role);
  }
  if (action === "settings.manage") {
    return ["manager", "admin"].includes(user.role);
  }
  if (action === "permissions.manage") {
    return ["manager", "admin"].includes(user.role);
  }
  if (action === "operations.view_live") {
    return ["supervisor", "manager"].includes(user.role);
  }
  if (action === "cards.view" || action === "cards.issue") {
    return ["reception", "supervisor", "manager", "admin"].includes(user.role);
  }
  if (action === "cards.revoke") {
    return ["manager", "admin"].includes(user.role);
  }
  if (action === "plan.view" || action === "plan.manage") {
    return (
      ["reception", "supervisor", "manager"].includes(user.role) ||
      (action === "plan.view" && user.role === "admin")
    );
  }
  if (action === "analytics.view") {
    return ["supervisor", "manager", "admin"].includes(user.role);
  }
  if (action === "sectors.manage" || action === "shifts.manage") {
    return ["supervisor", "manager", "admin"].includes(user.role);
  }
  if (action === "sectors.transfer_cross") {
    return ["manager", "admin"].includes(user.role);
  }
  if (action === "rooms.manage") {
    return ["supervisor", "manager", "admin"].includes(user.role);
  }
  if (action === "rooms.set_occupancy") {
    return ["reception", "supervisor", "manager"].includes(user.role);
  }
  if (action === "rooms.set_service_status") {
    return ["supervisor", "manager", "admin"].includes(user.role);
  }
  if (action === "issue_options.manage") {
    return ["manager", "admin"].includes(user.role);
  }
  if (action === "audit.view" || action === "jobs.view") {
    return ["manager", "admin"].includes(user.role);
  }
  return false;
}

export function panelsForUser(user: AuthUser): Panel[] {
  const base = user.panels?.length
    ? [...user.panels]
    : [...panelsForRole(user.role)];
  if (!base.includes("notifications")) {
    base.push("notifications");
  }
  return base;
}

/** Apply module toggles from public settings onto role panels. */
export function filterPanelsByModules(
  panels: Panel[],
  modules?: PublicSettings["modules"] | null,
): Panel[] {
  if (!modules) return panels;
  return panels.filter((p) => {
    if (p === "rooms") return modules.rooms !== false;
    if (p === "common") return modules.common !== false;
    if (p === "team") return modules.team !== false;
    if (p === "live") return modules.live !== false;
    if (p === "plan") return modules.daily_plan !== false;
    if (p === "control") return modules.control !== false;
    if (p === "attendance") return modules.attendance !== false;
    if (p === "cards") return modules.access_cards !== false;
    if (p === "results") return modules.analytics !== false;
    if (p === "analytics") return modules.analytics !== false;
    if (p === "cleaning") return modules.cleaning !== false;
    if (p === "mywork") {
      return (
        modules.my_work !== false &&
        (modules.maintenance !== false || modules.cleaning !== false)
      );
    }
    if (p === "repairs") {
      return modules.repairs !== false && modules.maintenance !== false;
    }
    if (p === "audit") return modules.audit !== false;
    // permissions / settings follow role grants
    if (p === "home") {
      return modules.maintenance !== false || modules.cleaning !== false;
    }
    return true;
  });
}

export function landingForUser(user: AuthUser): Panel {
  if (user.landing) return user.landing;
  return landingForRole(user.role);
}

/** Roles the actor may assign via Control (mirrors API policy). */
export function assignableRolesFor(actor: Role): Role[] {
  if (actor === "owner") return [...ALL_ROLES];
  // Non-owners never assign owner/admin, even with people.change_role.
  return ALL_ROLES.filter((r) => r !== "owner" && r !== "admin");
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
  /** Set for supervisors — count of active sectors they primarily supervise. */
  supervisedSectorCount?: number | null;
};

export type PublicSettings = {
  modules: {
    rooms: boolean;
    common: boolean;
    cleaning: boolean;
    maintenance: boolean;
    my_work?: boolean;
    repairs?: boolean;
    team: boolean;
    live: boolean;
    control: boolean;
    daily_plan: boolean;
    attendance: boolean;
    access_cards: boolean;
    analytics: boolean;
    audit?: boolean;
  };
  interface: {
    defaultTheme: "dark" | "light";
    locale: "bg" | "en";
    density: "comfortable" | "compact";
  };
  operations: {
    overdueSessionMinutes: number;
    defaultTaskDueHours: number;
    defaultTicketSlaHours: number;
    riskTicketThreshold: number;
    riskWindowDays: number;
    hotelTimezone: string;
  };
  flags: {
    show_overdue_banner: boolean;
    require_inspection: boolean;
  };
};

export type SettingsBundle = Record<
  string,
  {
    key: string;
    value: unknown;
    updatedAt: string;
    updatedByEmployeeId: string | null;
  }
>;

export type SettingHistoryRow = {
  id: string;
  key: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  createdAt: string;
  actor: { id: string; fullName: string; employeeNumber: string };
};

export type SystemStatus = {
  api: { ok: boolean };
  database: { ok: boolean; pingMs: number };
  counts: {
    rooms: number;
    commonAreas: number;
    openTickets: number;
    runningSessions: number;
  };
  serverTime: string;
  version: string;
};

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

export type Person = {
  id: string;
  employeeId: string;
  userId: string | null;
  fullName: string;
  employeeNumber: string;
  email: string | null;
  role: Role | null;
  department: string | null;
  isActive: boolean;
  onboarded: boolean;
  deviceCount: number;
  createdAt: string;
};

export type Invitation = {
  id: string;
  codeHint: string;
  employeeId: string;
  fullName: string;
  employeeNumber: string;
  role: Role;
  email: string;
  status: "issued" | "consumed" | "expired" | "revoked";
  expiresAt: string;
  createdAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
  createdBy: { id: string; email: string; fullName: string };
};

export type IssuedInvitation = {
  invitation: Invitation;
  code: string;
  qrPayload: string;
  expiresAt: string;
};

export type DeviceRow = {
  id: string;
  label: string;
  fingerprint: string;
  employeeId: string;
  userId: string;
  fullName: string;
  employeeNumber: string;
  email: string;
  role: Role;
  activatedAt: string;
  lastSeenAt: string;
};

export type Room = {
  id: string;
  floorId?: string;
  number: string;
  kind?: "room" | "common_area";
  floor: number;
  floorName: string;
  building: string;
  buildingCode: string;
  catalogStatus: string;
  occupancy: string;
  cleaningStatus: string;
  serviceStatus: string;
  qrToken?: string;
  sector?: {
    id: string;
    code: string;
    nameBg: string;
    nameEn: string;
  } | null;
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

export type LocationHierarchyBuilding = {
  id: string;
  name: string;
  code: string;
  floors: Array<{ id: string; number: number; name: string }>;
};

export type LocationOccupancy = "vacant" | "occupied" | "unknown";
export type LocationServiceStatus =
  | "in_service"
  | "out_of_service"
  | "unknown";
export type LocationKind = "room" | "common_area";

export type OverdueSession = {
  sessionId: string;
  taskId: string;
  startedAt: string;
  elapsedMinutes: number;
  employee: { id: string; fullName: string; employeeNumber: string };
  room: { id: string; number: string; buildingCode: string; floor: number };
};

export type LiveBoardLocation = {
  id: string;
  number: string;
  kind: string;
  buildingCode: string;
  floor: number;
};

export type LiveBoardEmployee = {
  id: string;
  fullName: string;
  employeeNumber: string;
};

export type LiveActiveSession = {
  sessionId: string;
  taskId: string;
  startedAt: string;
  elapsedMinutes: number;
  overdue: boolean;
  anomaly: boolean;
  employee: LiveBoardEmployee;
  location: LiveBoardLocation;
};

export type LiveCompletedSession = {
  sessionId: string;
  taskId: string;
  startedAt: string;
  finishedAt: string;
  durationMinutes: number;
  employee: LiveBoardEmployee;
  location: LiveBoardLocation;
};

export type LiveNeedsAttention = {
  kind: "awaiting_inspection" | "past_due" | "blocking_ticket";
  id: string;
  title: string;
  location: LiveBoardLocation;
  employee: LiveBoardEmployee | null;
  dueAt: string | null;
  priority: string | null;
  status: string;
};

export type LiveAuditItem = {
  at: string;
  type: string;
  summary: string;
  locationNumber: string | null;
  entityId: string;
  actorName?: string | null;
};

export type AuditEventRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  occurredAt: string;
  reason: string | null;
  before: unknown;
  after: unknown;
  locationId: string | null;
  summary: string | null;
  actor: { id: string; fullName: string; employeeNumber: string } | null;
};

export type OperationsLive = {
  updatedAt: string;
  overdueThresholdMinutes: number;
  anomalyThresholdMinutes: number;
  activeSessions: LiveActiveSession[];
  recentlyCompleted: LiveCompletedSession[];
  needsAttention: LiveNeedsAttention[];
  auditFeed: LiveAuditItem[];
  counts: {
    active: number;
    overdue: number;
    anomalies: number;
    awaitingInspection: number;
    blockingTickets: number;
  };
};

type ApiError = {
  error?: string;
  message?: string;
};

export class ApiRequestError extends Error {
  readonly kind: "http" | "network";
  readonly status?: number;
  /** Set when a 401 triggered /auth/refresh during this request. */
  refreshOutcome?: RefreshOutcome;
  authRejected?: boolean;

  constructor(
    message: string,
    opts: {
      kind: "http" | "network";
      status?: number;
      refreshOutcome?: RefreshOutcome;
      authRejected?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "ApiRequestError";
    this.kind = opts.kind;
    this.status = opts.status;
    this.refreshOutcome = opts.refreshOutcome;
    this.authRejected = opts.authRejected;
  }
}

/** Last /auth/refresh outcome (for attaching to subsequent 401 parse errors). */
let lastRefreshOutcome: RefreshOutcome | null = null;

function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|; )csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

function buildAuthHeaders(method = "GET"): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const upper = method.toUpperCase();
  if (upper !== "GET" && upper !== "HEAD" && upper !== "OPTIONS") {
    const csrf = getCsrfToken();
    if (csrf) {
      headers["X-CSRF-Token"] = csrf;
    }
  }
  return headers;
}

function authHeaders(method = "GET"): HeadersInit {
  return buildAuthHeaders(method);
}

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const body = data as ApiError;
    const message = body.message ?? body.error ?? `HTTP ${res.status}`;
    const err = new ApiRequestError(message, {
      kind: "http",
      status: res.status,
    });
    if (res.status === 401 || res.status === 403) {
      if (lastRefreshOutcome) {
        err.refreshOutcome = lastRefreshOutcome;
        err.authRejected = lastRefreshOutcome === "rejected";
      } else {
        err.authRejected = true;
      }
    }
    throw err;
  }
  return data as T;
}

/** True when a non-secret user cache exists (cookie session may still be valid). */
export function hasCachedSession(): boolean {
  return getStoredUser() !== null;
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

export function clearSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("user");
  // Best-effort: drop private IndexedDB + leftover authenticated HTTP caches
  // so a shared device cannot surface the previous user's offline data.
  void import("../offline").then((m) => {
    m.clearPrivateOfflineState();
  });
}

/** @deprecated Use clearSession */
export function clearToken() {
  clearSession();
}

/** @deprecated Tokens are httpOnly cookies — always null in JS. */
export function getToken(): string | null {
  return null;
}

let refreshInFlight: Promise<RefreshOutcome> | null = null;

export async function refreshAccessToken(): Promise<RefreshOutcome> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: buildAuthHeaders("POST"),
      });
      if (res.ok) {
        lastRefreshOutcome = "refreshed";
        return "refreshed";
      }
      const classified = classifyRefreshFailure(res.status);
      lastRefreshOutcome = classified;
      if (classified === "rejected") {
        clearSession();
      }
      return classified;
    } catch {
      lastRefreshOutcome = "transient";
      // Network/timeout — keep offline outbox; identity pending verification.
      return "transient";
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

function shouldSkipRefresh(url: string): boolean {
  return (
    url.includes("/auth/login") ||
    url.includes("/auth/refresh") ||
    url.includes("/auth/logout")
  );
}

/** Cookie-session fetch with CSRF and single-flight refresh on 401. */
async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    ...buildAuthHeaders(method),
    ...(init.headers as Record<string, string> | undefined),
  };

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers,
      credentials: "include",
    });
  } catch (cause) {
    throw new ApiRequestError("Network error", { kind: "network", cause });
  }

  if (res.status !== 401 || shouldSkipRefresh(url)) {
    return res;
  }

  const outcome = await refreshAccessToken();
  if (outcome !== "refreshed") {
    return res;
  }

  const retryHeaders: Record<string, string> = {
    ...buildAuthHeaders(method),
    ...(init.headers as Record<string, string> | undefined),
  };
  try {
    return await fetch(url, {
      ...init,
      headers: retryHeaders,
      credentials: "include",
    });
  } catch (cause) {
    throw new ApiRequestError("Network error", { kind: "network", cause });
  }
}

export async function logout(): Promise<void> {
  try {
    await apiFetch(`${API_BASE}/auth/logout`, { method: "POST" });
  } catch {
    /* best-effort */
  } finally {
    clearSession();
  }
}

export async function logoutAll(): Promise<void> {
  try {
    await apiFetch(`${API_BASE}/auth/logout-all`, { method: "POST" });
  } catch {
    /* best-effort */
  } finally {
    clearSession();
  }
}

export type LiveEventType =
  | "location.changed"
  | "cleaning.changed"
  | "ticket.changed"
  | "settings.changed"
  | "people.changed"
  | "notification.changed"
  | "connected";

export type LiveEvent = {
  type: LiveEventType;
  locationId?: string;
  taskId?: string;
  ticketId?: string;
  recipientEmployeeId?: string;
  at?: string;
  ok?: boolean;
  userId?: string;
};

const LIVE_EVENT_TYPES = new Set<string>([
  "connected",
  "location.changed",
  "cleaning.changed",
  "ticket.changed",
  "settings.changed",
  "people.changed",
  "notification.changed",
]);

function parseSseChunk(
  buffer: string,
  onEvent: (event: LiveEvent) => void,
): string {
  const parts = buffer.split("\n\n");
  const remainder = parts.pop() ?? "";

  for (const part of parts) {
    let eventType = "message";
    const dataLines: string[] = [];
    for (const rawLine of part.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (!LIVE_EVENT_TYPES.has(eventType)) continue;
    let data: Record<string, unknown> = {};
    const rawData = dataLines.join("\n");
    if (rawData) {
      try {
        data = JSON.parse(rawData) as Record<string, unknown>;
      } catch {
        data = {};
      }
    }
    onEvent({
      type: eventType as LiveEventType,
      ...data,
    });
  }

  return remainder;
}

/** Short-lived SSE ticket for EventSource clients (prefer Bearer fetch stream). */
export async function fetchSseTicket(): Promise<{
  token: string;
  expiresIn: number;
}> {
  const res = await apiFetch(`${API_BASE}/events/ticket`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

type LiveListener = {
  onEvent: (event: LiveEvent) => void;
  onError?: (err: Event) => void;
};

/** One shared SSE stream for the whole app — pages must not open parallel ones. */
const liveListeners = new Set<LiveListener>();
let liveController: AbortController | null = null;
let liveReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let liveBackoffMs = 1000;
let liveConnecting = false;
const LIVE_MAX_BACKOFF_MS = 30_000;

function emitLiveEvent(event: LiveEvent) {
  for (const listener of [...liveListeners]) {
    try {
      listener.onEvent(event);
    } catch {
      /* ignore listener errors */
    }
  }
}

function emitLiveError(err: Event) {
  for (const listener of [...liveListeners]) {
    try {
      listener.onError?.(err);
    } catch {
      /* ignore */
    }
  }
}

function stopSharedLiveStream() {
  if (liveReconnectTimer) {
    clearTimeout(liveReconnectTimer);
    liveReconnectTimer = null;
  }
  liveController?.abort();
  liveController = null;
  liveConnecting = false;
  liveBackoffMs = 1000;
}

function scheduleSharedLiveReconnect() {
  if (liveListeners.size === 0) return;
  if (liveReconnectTimer) return;
  liveReconnectTimer = setTimeout(() => {
    liveReconnectTimer = null;
    void ensureSharedLiveStream();
  }, liveBackoffMs);
  liveBackoffMs = Math.min(liveBackoffMs * 2, LIVE_MAX_BACKOFF_MS);
}

async function ensureSharedLiveStream() {
  if (liveListeners.size === 0 || liveConnecting) return;
  if (liveController && !liveController.signal.aborted) return;

  liveConnecting = true;
  const controller = new AbortController();
  liveController = controller;

  try {
    const res = await apiFetch(`${API_BASE}/events/stream`, {
      signal: controller.signal,
    });

    if (controller.signal.aborted) return;

    if (res.status === 401) {
      emitLiveError(new Event("error"));
      return;
    }

    if (!res.ok || !res.body) {
      emitLiveError(new Event("error"));
      scheduleSharedLiveReconnect();
      return;
    }

    liveBackoffMs = 1000;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (!controller.signal.aborted && liveListeners.size > 0) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = parseSseChunk(buffer, emitLiveEvent);
    }

    if (!controller.signal.aborted && liveListeners.size > 0) {
      emitLiveError(new Event("error"));
      scheduleSharedLiveReconnect();
    }
  } catch (err) {
    if (controller.signal.aborted) return;
    if (err instanceof DOMException && err.name === "AbortError") return;
    emitLiveError(new Event("error"));
    scheduleSharedLiveReconnect();
  } finally {
    if (liveController === controller) {
      liveController = null;
    }
    liveConnecting = false;
  }
}

/** Subscribe to server-sent live events via a shared credentialed fetch stream. */
export function subscribeLiveEvents(
  onEvent: (event: LiveEvent) => void,
  onError?: (err: Event) => void,
): () => void {
  const listener: LiveListener = { onEvent, onError };
  liveListeners.add(listener);
  void ensureSharedLiveStream();

  return () => {
    liveListeners.delete(listener);
    if (liveListeners.size === 0) {
      stopSharedLiveStream();
    }
  };
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await parseJson<{
    user: AuthUser;
    expiresIn?: number;
  }>(res);
  localStorage.setItem("user", JSON.stringify(data.user));
  return data;
}

export async function fetchMe(): Promise<AuthUser> {
  const res = await apiFetch(`${API_BASE}/auth/me`, { headers: authHeaders() });
  const user = await parseJson<AuthUser>(res);
  localStorage.setItem("user", JSON.stringify(user));
  return user;
}

export async function fetchRooms(init?: { signal?: AbortSignal }): Promise<Room[]> {
  const res = await apiFetch(`${API_BASE}/rooms`, {
    headers: authHeaders(),
    signal: init?.signal,
  });
  return parseJson(res);
}

export async function fetchCommonAreas(init?: {
  signal?: AbortSignal;
}): Promise<Room[]> {
  const res = await apiFetch(`${API_BASE}/common-areas`, {
    headers: authHeaders(),
    signal: init?.signal,
  });
  return parseJson(res);
}

export async function markRoomDirty(roomId: string): Promise<Room> {
  const res = await apiFetch(`${API_BASE}/rooms/${roomId}/mark-dirty`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function markCommonAreaDirty(locationId: string): Promise<Room> {
  const res = await apiFetch(`${API_BASE}/common-areas/${locationId}/mark-dirty`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function fetchLocationHierarchy(): Promise<
  LocationHierarchyBuilding[]
> {
  const res = await apiFetch(`${API_BASE}/locations/hierarchy`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function fetchLocationsCatalog(params?: {
  kind?: LocationKind;
  includeArchived?: boolean;
}): Promise<Room[]> {
  const search = new URLSearchParams();
  if (params?.kind) search.set("kind", params.kind);
  if (params?.includeArchived) search.set("includeArchived", "true");
  const qs = search.toString();
  const res = await apiFetch(`${API_BASE}/locations${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function createLocation(input: {
  floorId: string;
  number: string;
  kind?: LocationKind;
  occupancy?: LocationOccupancy;
  serviceStatus?: LocationServiceStatus;
}): Promise<Room> {
  const res = await apiFetch(`${API_BASE}/locations`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function updateLocation(
  id: string,
  input: {
    floorId?: string;
    number?: string;
    kind?: LocationKind;
  },
): Promise<Room> {
  const res = await apiFetch(`${API_BASE}/locations/${id}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function archiveLocation(id: string): Promise<Room> {
  const res = await apiFetch(`${API_BASE}/locations/${id}/archive`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function restoreLocation(id: string): Promise<Room> {
  const res = await apiFetch(`${API_BASE}/locations/${id}/restore`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function setLocationOccupancy(
  id: string,
  occupancy: LocationOccupancy,
): Promise<Room> {
  const res = await apiFetch(`${API_BASE}/locations/${id}/occupancy`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ occupancy }),
  });
  return parseJson(res);
}

export async function setLocationServiceStatus(
  id: string,
  serviceStatus: LocationServiceStatus,
): Promise<Room> {
  const res = await apiFetch(`${API_BASE}/locations/${id}/service-status`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ serviceStatus }),
  });
  return parseJson(res);
}

export async function fetchCleaningTasks(params?: {
  mine?: boolean;
  hotelDate?: string;
  status?: string;
}): Promise<CleaningTaskRow[]> {
  const search = new URLSearchParams();
  if (params?.mine) search.set("mine", "1");
  if (params?.hotelDate) search.set("hotelDate", params.hotelDate);
  if (params?.status) search.set("status", params.status);
  const qs = search.toString();
  const res = await apiFetch(`${API_BASE}/cleaning/tasks${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export type CleaningTaskRow = {
  id: string;
  locationId: string;
  hotelDate: string;
  priority: string;
  status: string;
  version: number;
  assignedEmployeeId: string | null;
  shiftId?: string | null;
  reassignReason: string | null;
  location: {
    id: string;
    number: string;
    kind: string;
    floor: { number: number; building: { code: string; name: string } };
  };
  assignedEmployee: {
    id: string;
    fullName: string;
    employeeNumber: string;
  } | null;
  shift?: {
    id: string;
    code: string;
    nameBg: string;
    nameEn: string;
    startTime: string;
    endTime: string;
  } | null;
  sessions: Array<{
    id: string;
    employeeId: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    notes: string | null;
  }>;
  inspections: Array<{
    id: string;
    result: string;
    findings: string | null;
    inspectedAt: string;
    inspector?: { id: string; fullName: string; employeeNumber: string };
  }>;
};

export async function createCleaningTask(input: {
  locationId: string;
  hotelDate: string;
  priority?: string;
  assignedEmployeeId?: string;
  shiftId?: string | null;
  dueAt?: string;
  serviceType?: CleaningServiceType;
}) {
  const res = await apiFetch(`${API_BASE}/cleaning/tasks`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function startCleaningTask(taskId: string, expectedVersion?: number) {
  const res = await apiFetch(`${API_BASE}/cleaning/tasks/${taskId}/start`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      expectedVersion,
    }),
  });
  return parseJson(res);
}

export async function completeCleaningSession(
  sessionId: string,
  notes?: string,
  expectedVersion?: number,
) {
  const res = await apiFetch(`${API_BASE}/cleaning/sessions/${sessionId}/complete`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      ...(notes?.trim() ? { notes: notes.trim() } : {}),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    }),
  });
  return parseJson(res);
}

export async function cancelCleaningSession(
  sessionId: string,
  notes?: string,
  expectedVersion?: number,
) {
  const res = await apiFetch(`${API_BASE}/cleaning/sessions/${sessionId}/cancel`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      ...(notes?.trim() ? { notes: notes.trim() } : {}),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    }),
  });
  return parseJson(res);
}

export async function inspectCleaningTask(
  taskId: string,
  result: "approved" | "rejected",
  findings?: string,
  expectedVersion?: number,
) {
  const res = await apiFetch(`${API_BASE}/cleaning/tasks/${taskId}/inspect`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      commandId: crypto.randomUUID(),
      result,
      findings,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    }),
  });
  return parseJson(res);
}

export async function reassignCleaningTask(
  taskId: string,
  assignedEmployeeId: string,
  reason: string,
  expectedVersion?: number,
  shiftId?: string | null,
) {
  const res = await apiFetch(`${API_BASE}/cleaning/tasks/${taskId}/reassign`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      assignedEmployeeId,
      reason,
      expectedVersion,
      ...(shiftId !== undefined ? { shiftId } : {}),
    }),
  });
  return parseJson(res);
}

export async function fetchOverdueSessions(init?: {
  signal?: AbortSignal;
}): Promise<OverdueSession[]> {
  const res = await apiFetch(`${API_BASE}/cleaning/sessions/review`, {
    headers: authHeaders(),
    signal: init?.signal,
  });
  return parseJson(res);
}

export async function fetchOperationsLive(): Promise<OperationsLive> {
  const res = await apiFetch(`${API_BASE}/operations/live`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export type CleaningServiceType =
  | "stayover"
  | "departure"
  | "arrival"
  | "common_area";

export type CleaningResultsRow = {
  employeeId: string;
  fullName: string;
  employeeNumber: string;
  completedSessions: number;
  completedTasks: number;
  acceptedTasks: number;
  reworkEvents: number;
  anomalousSessions: number;
  distinctRooms: number;
  onTimePct: number | null;
  avgValidMinutes: number | null;
  totalValidSessionMinutes: number;
  totalExcludedSessionMinutes: number;
};

export type CleaningResultsResponse = {
  period: { from: string; to: string };
  summary: {
    housekeeperCount: number;
    completedSessions: number;
    completedTasks: number;
    acceptedTasks: number;
    reworkEvents: number;
    anomalousSessions: number;
    distinctRooms: number;
    onTimePct: number | null;
    productivity: number | null;
    totalValidSessionMinutes: number;
    totalExcludedSessionMinutes: number;
    byServiceType: Array<{ key: CleaningServiceType; count: number }>;
  };
  series: Array<{ hour: number; completedSessions: number }>;
  rows: CleaningResultsRow[];
  page: number;
  pageSize: number;
  total: number;
};

export async function fetchCleaningResults(params: {
  from: string;
  to: string;
  page?: number;
  pageSize?: number;
  serviceType?: CleaningServiceType | CleaningServiceType[];
}): Promise<CleaningResultsResponse> {
  const q = new URLSearchParams({
    from: params.from,
    to: params.to,
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 25),
  });
  if (params.serviceType) {
    const types = Array.isArray(params.serviceType)
      ? params.serviceType
      : [params.serviceType];
    if (types.length) q.set("serviceType", types.join(","));
  }
  const res = await apiFetch(`${API_BASE}/cleaning/results?${q}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

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

export type AnalyticsDomain = "maintenance" | "housekeeping";

export type AnalyticsMetricCompare = {
  current: number | null;
  previous: number | null;
  deltaPct: number | null;
};

export type AnalyticsSeriesPoint = { date: string; count: number };

export type MaintenanceAnalyticsKpis = {
  signals: number;
  slaBreaches: { active: number; closed: number };
  reopened: number;
  riskRooms: number;
  avgResolveMinutes: number | null;
  p50ResolveMinutes: number | null;
  p90ResolveMinutes: number | null;
  insufficientDurationData: boolean;
  durationSampleCount: number;
};

export type HousekeepingAnalyticsKpis = {
  cleanedTasks: number;
  completedSessions: number;
  acceptedTasks: number;
  reworkEvents: number;
  anomalousSessions: number;
  distinctRooms: number;
  readyRooms: number;
  onTimePct: number | null;
  onTimeSampleCount: number;
  auditFindings: number;
  riskRooms: number;
  avgMinutesPerTask: number | null;
  totalValidSessionMinutes: number;
  totalExcludedSessionMinutes: number;
  p50SessionMinutes: number | null;
  p90SessionMinutes: number | null;
  insufficientDurationData: boolean;
  durationSampleCount: number;
};

export type AnalyticsSummary =
  | {
      domain: "maintenance";
      period: { from: string; to: string };
      kpis: MaintenanceAnalyticsKpis;
      comparison: {
        signals: AnalyticsMetricCompare;
        reopened: AnalyticsMetricCompare;
        slaActive: AnalyticsMetricCompare;
      };
      series: AnalyticsSeriesPoint[];
      breakdowns: {
        byCategory?: Array<{ key: string; count: number }>;
        byPriority?: Array<{ key: string; count: number }>;
      };
      riskRooms: Array<{
        locationId: string;
        label: string;
        factors: string[];
        ticketCount: number;
      }>;
      forecast: {
        remainingDaysInMonth: number;
        dailyRate: number | null;
        predicted: number | null;
        formula: string;
        unit: "tickets" | "cleaned_tasks";
      };
    }
  | {
      domain: "housekeeping";
      period: { from: string; to: string };
      kpis: HousekeepingAnalyticsKpis;
      comparison: {
        cleanedTasks: AnalyticsMetricCompare;
        onTimePct: AnalyticsMetricCompare;
        auditFindings: AnalyticsMetricCompare;
        acceptedTasks: AnalyticsMetricCompare;
        reworkEvents: AnalyticsMetricCompare;
      };
      series: AnalyticsSeriesPoint[];
      breakdowns: {
        byCategory?: Array<{ key: string; count: number }>;
        byPriority?: Array<{ key: string; count: number }>;
        byServiceType?: Array<{ key: string; count: number }>;
      };
      riskRooms: Array<{
        locationId: string;
        label: string;
        factors: string[];
        ticketCount: number;
      }>;
      forecast: {
        remainingDaysInMonth: number;
        dailyRate: number | null;
        predicted: number | null;
        formula: string;
        unit: "tickets" | "cleaned_tasks";
      };
    };

export async function fetchAnalyticsSummary(params: {
  domain: AnalyticsDomain;
  from?: string;
  to?: string;
}): Promise<AnalyticsSummary> {
  const q = new URLSearchParams({ domain: params.domain });
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  const res = await apiFetch(`${API_BASE}/analytics/summary?${q}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function fetchHousekeepers(init?: { signal?: AbortSignal }) {
  const res = await apiFetch(`${API_BASE}/cleaning/employees/housekeepers`, {
    headers: authHeaders(),
    signal: init?.signal,
  });
  return parseJson<Array<{ id: string; fullName: string; employeeNumber: string }>>(res);
}

export async function fetchPeople(params?: {
  q?: string;
  role?: string;
  includeInactive?: boolean;
  notOnboarded?: boolean;
}): Promise<Person[]> {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.role) search.set("role", params.role);
  if (params?.includeInactive) search.set("includeInactive", "true");
  if (params?.notOnboarded) search.set("notOnboarded", "true");
  const qs = search.toString();
  const res = await apiFetch(`${API_BASE}/people${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function updatePersonRole(userId: string, role: Role): Promise<Person> {
  const res = await apiFetch(`${API_BASE}/people/${userId}/role`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ role }),
  });
  return parseJson(res);
}

export async function issueInvitation(
  body:
    | {
        kind: "new";
        fullName: string;
        employeeNumber: string;
        email: string;
        role: Role;
        department?: string | null;
      }
    | {
        kind: "existing";
        employeeId: string;
        email?: string;
        role?: Role;
      },
): Promise<IssuedInvitation> {
  const res = await apiFetch(`${API_BASE}/invitations`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function fetchInvitations(): Promise<Invitation[]> {
  const res = await apiFetch(`${API_BASE}/invitations`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function revokeInvitation(id: string): Promise<Invitation> {
  const res = await apiFetch(`${API_BASE}/invitations/${id}/revoke`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function redeemInvitation(body: {
  code: string;
  password?: string;
  deviceLabel: string;
  fingerprint: string;
}): Promise<{ user: AuthUser }> {
  const res = await fetch(`${API_BASE}/invitations/redeem`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJson<{ user: AuthUser }>(res);
  localStorage.setItem("user", JSON.stringify(data.user));
  return data;
}

export async function fetchDevices(employeeId?: string): Promise<DeviceRow[]> {
  const search = new URLSearchParams();
  if (employeeId) search.set("employeeId", employeeId);
  const qs = search.toString();
  const res = await apiFetch(`${API_BASE}/devices${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function revokeDevice(id: string): Promise<{ id: string; revokedAt: string }> {
  const res = await apiFetch(`${API_BASE}/devices/${id}/revoke`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export function deviceFingerprint(): string {
  const key = "device_fingerprint";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const next = `web-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  localStorage.setItem(key, next);
  return next;
}

const DEFAULT_HOTEL_TIMEZONE = "Europe/Sofia";
let cachedHotelTimezone = DEFAULT_HOTEL_TIMEZONE;

export function todayHotelDate(timeZone?: string, instant: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone ?? cachedHotelTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export type DailyPlanCategory = "departure" | "arrival" | "priority";
export type DailyPlanSource = "manual" | "import";

export type DailyPlanImportBatch = {
  id: string;
  hotelDate: string;
  sourceLabel: string;
  status: "completed" | "partial" | "failed";
  totalCount: number;
  createdCount: number;
  skippedCount: number;
  errorCount: number;
  errors: Array<{ index: number; room?: string; reason: string }>;
  createdByEmployeeId: string;
  createdAt: string;
};

export type DailyPlanEntry = {
  id: string;
  hotelDate: string;
  category: DailyPlanCategory;
  notes: string | null;
  source: DailyPlanSource | string;
  externalId?: string | null;
  createdAt: string;
  createdBy: { id: string; fullName: string; employeeNumber: string };
  room: {
    id: string;
    number: string;
    buildingCode: string;
    buildingName: string;
    floor: number;
    occupancy: string;
    cleaningStatus: string;
  };
  task: {
    id: string;
    status: string;
    priority: string;
    sector?: {
      id: string;
      code: string;
      nameBg: string;
      nameEn: string;
    } | null;
    sectorSupervisor?: {
      id: string;
      fullName: string;
      employeeNumber: string;
    } | null;
    assignedEmployee: {
      id: string;
      fullName: string;
      employeeNumber: string;
    } | null;
    shift?: {
      id: string;
      code: string;
      nameBg: string;
      nameEn: string;
      startTime: string;
      endTime: string;
    } | null;
  } | null;
};

export type DailyPlan = {
  date: string;
  departures: DailyPlanEntry[];
  arrivals: DailyPlanEntry[];
  priority: DailyPlanEntry[];
  lastImport?: DailyPlanImportBatch | null;
};

export type DailyPlanImportPayload = {
  hotelDate: string;
  sourceLabel?: string;
  entries: Array<{
    buildingCode: string;
    roomNumber: string;
    category: DailyPlanCategory;
    notes?: string;
    externalId?: string;
  }>;
};

export async function fetchDailyPlan(hotelDate: string): Promise<DailyPlan> {
  const search = new URLSearchParams({ hotelDate });
  const res = await apiFetch(`${API_BASE}/daily-plan?${search}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export type DepartureRoomEffectsResult = {
  hotelDate: string;
  applied: number;
  skipped: number;
  total: number;
};

export async function applyDepartureRoomEffects(
  hotelDate: string,
): Promise<DepartureRoomEffectsResult> {
  const res = await apiFetch(`${API_BASE}/daily-plan/apply-departure-effects`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ hotelDate }),
  });
  return parseJson(res);
}

export async function createDailyPlanEntry(input: {
  hotelDate: string;
  locationId: string;
  category: DailyPlanCategory;
  notes?: string;
  assignedEmployeeId?: string;
  shiftId?: string | null;
}): Promise<{ entry: DailyPlanEntry; effects: Record<string, unknown> }> {
  const res = await apiFetch(`${API_BASE}/daily-plan`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function importDailyPlan(
  payload: DailyPlanImportPayload,
): Promise<{ batch: DailyPlanImportBatch; plan: DailyPlan }> {
  const res = await apiFetch(`${API_BASE}/daily-plan/import`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

export async function deleteDailyPlanEntry(id: string): Promise<{ id: string; deleted: boolean }> {
  const res = await apiFetch(`${API_BASE}/daily-plan/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function fetchPublicSettings(): Promise<PublicSettings> {
  const res = await apiFetch(`${API_BASE}/settings/public`, {
    headers: authHeaders(),
  });
  const settings = await parseJson<PublicSettings>(res);
  const tz = settings?.operations?.hotelTimezone;
  if (typeof tz === "string" && tz.length > 0) {
    cachedHotelTimezone = tz;
  }
  return settings;
}

export async function fetchAllSettings(): Promise<SettingsBundle> {
  const res = await apiFetch(`${API_BASE}/settings`, { headers: authHeaders() });
  return parseJson(res);
}

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const res = await apiFetch(`${API_BASE}/settings/system`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function fetchSettingsHistory(params?: {
  key?: string;
  limit?: number;
}): Promise<SettingHistoryRow[]> {
  const search = new URLSearchParams();
  if (params?.key) search.set("key", params.key);
  if (params?.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  const res = await apiFetch(
    `${API_BASE}/settings/history${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() },
  );
  return parseJson(res);
}

export async function fetchAuditEvents(params?: {
  entityType?: string;
  entityId?: string;
  locationId?: string;
  actorEmployeeId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<AuditEventRow[]> {
  const search = new URLSearchParams();
  if (params?.entityType) search.set("entityType", params.entityType);
  if (params?.entityId) search.set("entityId", params.entityId);
  if (params?.locationId) search.set("locationId", params.locationId);
  if (params?.actorEmployeeId)
    search.set("actorEmployeeId", params.actorEmployeeId);
  if (params?.action) search.set("action", params.action);
  if (params?.from) search.set("from", params.from);
  if (params?.to) search.set("to", params.to);
  if (params?.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  const res = await apiFetch(
    `${API_BASE}/audit-events${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() },
  );
  return parseJson(res);
}

export async function patchSetting(
  key: string,
  value: unknown,
  reason?: string,
) {
  const res = await apiFetch(`${API_BASE}/settings/${key}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ value, reason }),
  });
  return parseJson(res);
}

export type PermissionMatrix = {
  panels: Panel[];
  actions: Action[];
  roles: Exclude<Role, "owner">[];
  byRole: Record<string, { panels: Panel[]; actions: Action[] }>;
  editableRoles: Exclude<Role, "owner">[];
  owner: { panels: Panel[]; actions: Action[] };
};

export type PermissionHistoryRow = {
  id: string;
  role: Role;
  kind: "panel" | "action";
  key: string;
  granted: boolean;
  reason: string | null;
  createdAt: string;
  actor: { id: string; fullName: string; employeeNumber: string };
};

export async function fetchPermissionMatrix(): Promise<PermissionMatrix> {
  const res = await apiFetch(`${API_BASE}/permissions/matrix`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function putRoleGrants(
  role: Role,
  panels: string[],
  actions: string[],
  reason?: string,
) {
  const res = await apiFetch(`${API_BASE}/permissions/roles/${role}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ panels, actions, reason }),
  });
  return parseJson(res);
}

export async function fetchPermissionHistory(params?: {
  role?: Role;
  limit?: number;
}): Promise<PermissionHistoryRow[]> {
  const search = new URLSearchParams();
  if (params?.role) search.set("role", params.role);
  if (params?.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  const res = await apiFetch(
    `${API_BASE}/permissions/history${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() },
  );
  return parseJson(res);
}

export type AttendanceScope = "month" | "today" | "week" | "review";

export type AttendanceInterval = {
  id: string;
  employeeId: string;
  employee: {
    id: string;
    fullName: string;
    employeeNumber: string;
    department: string | null;
  };
  hotelDate: string;
  startedAt: string;
  endedAt: string | null;
  breakMinutes: number;
  workedMinutes: number | null;
  status: "open" | "closed" | "needs_review" | "adjusted";
  anomalyFlags: string[];
  startEventId: string | null;
  endEventId: string | null;
  adjustments: Array<{
    id: string;
    status: "pending" | "approved" | "rejected";
    reason: string;
    proposedStartedAt: string | null;
    proposedEndedAt: string | null;
    proposedBreakMinutes: number | null;
    requestedBy: { id: string; fullName: string; employeeNumber: string };
    reviewedBy: { id: string; fullName: string; employeeNumber: string } | null;
    createdAt: string;
    reviewedAt: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
};

export async function fetchAttendanceIntervals(params?: {
  scope?: AttendanceScope;
  month?: string;
  department?: string;
  q?: string;
  limit?: number;
  cursor?: string;
}): Promise<{
  intervals: AttendanceInterval[];
  total: number;
  nextCursor: string | null;
  limit: number;
  maxClockSkewSeconds: number | null;
}> {
  const search = new URLSearchParams();
  if (params?.scope) search.set("scope", params.scope);
  if (params?.month) search.set("month", params.month);
  if (params?.department) search.set("department", params.department);
  if (params?.q) search.set("q", params.q);
  if (params?.limit != null) search.set("limit", String(params.limit));
  if (params?.cursor) search.set("cursor", params.cursor);
  const qs = search.toString();
  const res = await apiFetch(
    `${API_BASE}/attendance/intervals${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() },
  );
  return parseJson(res);
}

export async function downloadAttendanceCsv(params?: {
  scope?: AttendanceScope;
  month?: string;
  department?: string;
  q?: string;
}): Promise<{ truncated: boolean; total: number | null }> {
  const search = new URLSearchParams();
  if (params?.scope) search.set("scope", params.scope);
  if (params?.month) search.set("month", params.month);
  if (params?.department) search.set("department", params.department);
  if (params?.q) search.set("q", params.q);
  const qs = search.toString();
  const res = await apiFetch(
    `${API_BASE}/attendance/export.csv${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { message?: string }).message ?? `Export failed (${res.status})`,
    );
  }
  const truncated =
    res.headers.get("X-Attendance-Truncated")?.toLowerCase() === "true";
  const totalRaw = res.headers.get("X-Attendance-Total");
  const totalParsed = totalRaw != null ? Number(totalRaw) : NaN;
  const total = Number.isFinite(totalParsed) ? totalParsed : null;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "attendance.csv";
  a.click();
  URL.revokeObjectURL(url);
  return { truncated, total };
}

export async function requestAttendanceAdjustment(body: {
  intervalId: string;
  reason: string;
  proposedStartedAt?: string;
  proposedEndedAt?: string;
  proposedBreakMinutes?: number;
}) {
  const res = await apiFetch(`${API_BASE}/attendance/adjustments`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export async function reviewAttendanceAdjustment(
  id: string,
  body: { decision: "approved" | "rejected"; reason?: string },
) {
  const res = await apiFetch(`${API_BASE}/attendance/adjustments/${id}/review`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

export type CardType =
  | "guest"
  | "housekeeper"
  | "maintenance"
  | "manager"
  | "master";

export type CardStatus = "active" | "revoked";

export type AccessCardGrant = {
  id: string;
  locationId: string | null;
  validFrom: string;
  validUntil: string;
  location: {
    id: string;
    number: string;
    floor: { number: number; building: { code: string; name: string } };
  } | null;
};

export type AccessCard = {
  id: string;
  cardType: CardType;
  status: CardStatus;
  label: string | null;
  employeeId: string | null;
  commandId: string;
  createdAt: string;
  employee: {
    id: string;
    fullName: string;
    employeeNumber: string;
  } | null;
  issuedBy: {
    id: string;
    fullName: string;
    employeeNumber: string;
  };
  grants: AccessCardGrant[];
};

export type CardEmployeeOption = {
  id: string;
  fullName: string;
  employeeNumber: string;
  department: string | null;
};

export async function fetchCards(params?: {
  employeeId?: string;
  status?: CardStatus;
  cardType?: CardType;
  q?: string;
  staffOnly?: boolean;
}): Promise<AccessCard[]> {
  const search = new URLSearchParams();
  if (params?.employeeId) search.set("employeeId", params.employeeId);
  if (params?.status) search.set("status", params.status);
  if (params?.cardType) search.set("cardType", params.cardType);
  if (params?.q) search.set("q", params.q);
  if (params?.staffOnly) search.set("staffOnly", "true");
  const qs = search.toString();
  const res = await apiFetch(`${API_BASE}/cards${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function fetchCardEmployees(
  q?: string,
): Promise<CardEmployeeOption[]> {
  const search = new URLSearchParams();
  if (q) search.set("q", q);
  const qs = search.toString();
  const res = await apiFetch(
    `${API_BASE}/cards/employees${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() },
  );
  return parseJson(res);
}

export async function issueCard(input: {
  cardType: CardType;
  employeeId?: string | null;
  locationId?: string | null;
  validFrom: string;
  validUntil: string;
  label?: string | null;
  commandId?: string;
}): Promise<AccessCard> {
  const res = await apiFetch(`${API_BASE}/cards`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      ...input,
      commandId: input.commandId ?? crypto.randomUUID(),
    }),
  });
  return parseJson(res);
}

export async function revokeCard(id: string): Promise<AccessCard> {
  const res = await apiFetch(`${API_BASE}/cards/${id}/revoke`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export type SectorRow = {
  id: string;
  propertyId: string;
  code: string;
  nameBg: string;
  nameEn: string;
  isActive: boolean;
  primarySupervisor: {
    id: string;
    fullName: string;
    employeeNumber: string;
  } | null;
  locationCount: number;
  locationIds: string[];
  locations: Array<{
    id: string;
    number: string;
    kind: string;
    floor: number;
    buildingCode: string;
    building: string;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type ShiftRow = {
  id: string;
  code: string;
  nameBg: string;
  nameEn: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export async function fetchSectors(
  includeInactive = false,
): Promise<SectorRow[]> {
  const qs = includeInactive ? "?includeInactive=true" : "";
  const res = await apiFetch(`${API_BASE}/sectors${qs}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export type MySectorsResponse = {
  count: number;
  sectors: Array<{
    id: string;
    code: string;
    nameBg: string;
    nameEn: string;
    locationCount: number;
  }>;
};

export async function fetchMySectors(): Promise<MySectorsResponse> {
  const res = await apiFetch(`${API_BASE}/sectors/mine`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function createSector(input: {
  code: string;
  nameBg: string;
  nameEn: string;
  primarySupervisorEmployeeId?: string | null;
  locationIds?: string[];
  isActive?: boolean;
}): Promise<SectorRow> {
  const res = await apiFetch(`${API_BASE}/sectors`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function updateSector(
  id: string,
  input: {
    code?: string;
    nameBg?: string;
    nameEn?: string;
    primarySupervisorEmployeeId?: string | null;
    isActive?: boolean;
  },
): Promise<SectorRow> {
  const res = await apiFetch(`${API_BASE}/sectors/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function setSectorLocations(
  id: string,
  locationIds: string[],
): Promise<SectorRow> {
  const res = await apiFetch(`${API_BASE}/sectors/${id}/locations`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ locationIds }),
  });
  return parseJson(res);
}

export async function fetchShifts(includeInactive = false): Promise<ShiftRow[]> {
  const qs = includeInactive ? "?includeInactive=true" : "";
  const res = await apiFetch(`${API_BASE}/shifts${qs}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function createShift(input: {
  code: string;
  nameBg: string;
  nameEn: string;
  startTime: string;
  endTime: string;
  sortOrder?: number;
  isActive?: boolean;
}): Promise<ShiftRow> {
  const res = await apiFetch(`${API_BASE}/shifts`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export async function updateShift(
  id: string,
  input: {
    code?: string;
    nameBg?: string;
    nameEn?: string;
    startTime?: string;
    endTime?: string;
    sortOrder?: number;
    isActive?: boolean;
  },
): Promise<ShiftRow> {
  const res = await apiFetch(`${API_BASE}/shifts/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export type ShiftRosterEntry = {
  id: string;
  hotelDate: string;
  employee: {
    id: string;
    fullName: string;
    employeeNumber: string;
  };
  shift: {
    id: string;
    code: string;
    nameBg: string;
    nameEn: string;
    startTime: string;
    endTime: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type ShiftRoster = {
  hotelDate: string;
  entries: ShiftRosterEntry[];
};

export async function fetchShiftRoster(hotelDate: string): Promise<ShiftRoster> {
  const res = await apiFetch(
    `${API_BASE}/shifts/roster?hotelDate=${encodeURIComponent(hotelDate)}`,
    { headers: authHeaders() },
  );
  return parseJson(res);
}

export async function saveShiftRoster(input: {
  hotelDate: string;
  entries: Array<{ employeeId: string; shiftId: string }>;
}): Promise<ShiftRoster> {
  const res = await apiFetch(`${API_BASE}/shifts/roster`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  return parseJson(res);
}

export type LocationQrPayload = {
  locationId: string;
  qrToken: string;
  scanUrl: string;
  label: string;
  kind: string;
  buildingCode: string;
  floor: number;
  number: string;
};

export async function fetchLocationQr(
  locationId: string,
): Promise<LocationQrPayload> {
  const res = await apiFetch(`${API_BASE}/locations/${locationId}/qr`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function resolveLocationByQr(
  token: string,
): Promise<{ location: Room; qr: LocationQrPayload }> {
  const res = await apiFetch(
    `${API_BASE}/locations/by-qr/${encodeURIComponent(token)}`,
    { headers: authHeaders() },
  );
  return parseJson(res);
}

export function roomQrImageUrl(scanUrl: string, size = 200): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(scanUrl)}`;
}

export function roomQrScanUrl(qrToken: string): string {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/#/room-qr/${qrToken}`;
}

export type JobRunRow = {
  id: string;
  jobKey: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  summary: unknown;
  error: string | null;
};

export async function fetchJobRuns(limit = 50): Promise<JobRunRow[]> {
  const res = await apiFetch(`${API_BASE}/jobs/runs?limit=${limit}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function fetchMyWork(hotelDate?: string, shiftId?: string) {
  const search = new URLSearchParams();
  if (hotelDate) search.set("hotelDate", hotelDate);
  if (shiftId) search.set("shiftId", shiftId);
  const qs = search.toString();
  const res = await apiFetch(`${API_BASE}/my-work${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  return parseJson<{
    hotelDate: string;
    rosterShiftId: string | null;
    filterShiftId: string | null;
    tasks: CleaningTaskRow[];
    tickets: MaintenanceTicket[];
    summary: {
      taskCount: number;
      ticketCount: number;
      runningSessions: number;
    };
  }>(res);
}

export async function syncPush(commands: Array<{
  commandId: string;
  type: string;
  payload: Record<string, unknown>;
  clientTime?: string;
}>, deviceId?: string) {
  const res = await apiFetch(`${API_BASE}/sync/push`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ commands, deviceId }),
  });
  return parseJson(res);
}

export async function syncPull(params?: {
  since?: string;
  hotelDate?: string;
  deviceId?: string;
}) {
  const search = new URLSearchParams();
  if (params?.since) search.set("since", params.since);
  if (params?.hotelDate) search.set("hotelDate", params.hotelDate);
  if (params?.deviceId) search.set("deviceId", params.deviceId);
  const qs = search.toString();
  const res = await apiFetch(`${API_BASE}/sync/pull${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  locationId: string | null;
  payload: {
    panel?: Panel;
    ticketId?: string;
    taskId?: string;
    locationId?: string;
    locationNumber?: string;
    adjustmentId?: string;
    sessionId?: string;
  } | null;
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
  actorEmployeeId: string | null;
  unread: boolean;
  deliveries: Array<{
    channel: "in_app" | "email" | "device_push";
    status: string;
    attemptedAt: string;
    deliveredAt: string | null;
    error: string | null;
  }>;
};

export async function listNotifications(params?: {
  unread?: boolean;
  cursor?: string;
  limit?: number;
}): Promise<{ items: AppNotification[]; nextCursor: string | null }> {
  const search = new URLSearchParams();
  if (params?.unread) search.set("unread", "1");
  if (params?.cursor) search.set("cursor", params.cursor);
  if (params?.limit != null) search.set("limit", String(params.limit));
  const qs = search.toString();
  const res = await apiFetch(
    `${API_BASE}/notifications${qs ? `?${qs}` : ""}`,
    { headers: authHeaders() },
  );
  return parseJson(res);
}

export async function fetchNotificationUnreadCount(): Promise<{
  count: number;
}> {
  const res = await apiFetch(`${API_BASE}/notifications/unread-count`, {
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function markNotificationRead(
  id: string,
): Promise<AppNotification> {
  const res = await apiFetch(`${API_BASE}/notifications/${id}/read`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function markAllNotificationsRead(): Promise<{
  updated: number;
}> {
  const res = await apiFetch(`${API_BASE}/notifications/read-all`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

export async function dismissNotification(
  id: string,
): Promise<AppNotification> {
  const res = await apiFetch(`${API_BASE}/notifications/${id}/dismiss`, {
    method: "POST",
    headers: authHeaders(),
  });
  return parseJson(res);
}

