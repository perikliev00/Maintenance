import type { Action, AuthUser, ModuleToggles, Panel, Role } from "./capabilities";
import type { CleaningTaskRow } from "./cleaningApi";
import { API_BASE, apiFetch, authHeaders, parseJson } from "./http";
import type { MaintenanceTicket } from "./maintenanceApi";

export type { RefreshOutcome } from "./http";
export {
  ApiRequestError,
  clearSession,
  clearToken,
  fetchMe,
  getStoredUser,
  getToken,
  hasCachedSession,
  login,
  logout,
  logoutAll,
  refreshAccessToken,
} from "./http";
export {
  ALL_ROLES,
  assignableRolesFor,
  canAssignIssues,
  canCloseIssues,
  canPerformAction,
  canResolveIssues,
  canViewControl,
  canViewTeam,
  filterPanelsByModules,
  isOwner,
  landingForRole,
  landingForUser,
  panelsForRole,
  panelsForUser,
  ROLE_LABELS,
  type Action,
  type AuthUser,
  type ModuleToggles,
  type Panel,
  type Role,
} from "./capabilities";
export {
  fetchSseTicket,
  subscribeLiveEvents,
  type LiveEvent,
  type LiveEventType,
} from "./liveEvents";
export {
  cancelCleaningSession,
  completeCleaningSession,
  createCleaningTask,
  fetchCleaningResults,
  fetchCleaningTasks,
  fetchOverdueSessions,
  inspectCleaningTask,
  reassignCleaningTask,
  startCleaningTask,
  type CleaningResultsResponse,
  type CleaningResultsRow,
  type CleaningServiceType,
  type CleaningTaskRow,
  type OverdueSession,
} from "./cleaningApi";
export {
  archiveIssueOption,
  archiveMaintenanceCategory,
  assignIssue,
  closeIssue,
  createIssueOption,
  createMaintenanceCategory,
  fetchIssueOptions,
  fetchMaintenanceCategories,
  fetchSlaPolicies,
  fetchTicketEvents,
  fetchTickets,
  reopenIssue,
  reorderIssueOptions,
  reportIssue,
  resolveIssue,
  resumeIssue,
  startIssue,
  updateIssueOption,
  updateMaintenanceCategory,
  updateSlaPolicy,
  waitIssue,
  type IssueOptionRow,
  type MaintenanceCategoryRow,
  type MaintenanceTicket,
  type SlaPolicyRow,
} from "./maintenanceApi";


export type PublicSettings = {
  modules: ModuleToggles;
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


export async function fetchOperationsLive(): Promise<OperationsLive> {
  const res = await apiFetch(`${API_BASE}/operations/live`, {
    headers: authHeaders(),
  });
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
  deferred: number;
  deferredEntryIds: string[];
  total: number;
};

export async function applyDepartureRoomEffects(
  hotelDate: string,
  options?: { confirmEntryIds?: string[] },
): Promise<DepartureRoomEffectsResult> {
  const res = await apiFetch(`${API_BASE}/daily-plan/apply-departure-effects`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      hotelDate,
      confirmEntryIds: options?.confirmEntryIds,
    }),
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

