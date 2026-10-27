/**
 * Public facade for the web API layer.
 *
 * UI code should import from here (or domain modules) rather than reaching into
 * `http` / offline internals. Re-exports auth, capabilities, live SSE, and
 * domain REST helpers; offline queue APIs live under `../offline`.
 */
export type { RefreshOutcome } from "./http";
// HTTP session / auth primitives.
// Re-export public API surface.
export {
  ApiRequestError,
  clearSession,
  fetchMe,
  getStoredUser,
  hasCachedSession,
  login,
  logout,
  logoutAll,
  refreshAccessToken,
} from "./http";
// Role / panel / action capabilities.
// Re-export public API surface.
export {
  ALL_ROLES,
  assignableRolesFor,
  // Permission / capability gate (SEC-003: do not re-export legacy role helpers).
  canPerformAction,
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
// Live SSE event subscription.
// Re-export public API surface.
export {
  subscribeLiveEvents,
  type LiveEvent,
  type LiveEventType,
} from "./liveEvents";
// Cleaning tasks & sessions API.
// Re-export public API surface.
export {
  cancelCleaningSession,
  completeCleaningSession,
  createCleaningTask,
  fetchAvailableHousekeepers,
  fetchCleaningResults,
  fetchCleaningTasks,
  fetchOverdueSessions,
  inspectCleaningTask,
  reassignCleaningTask,
  startCleaningTask,
  type AvailableHousekeeper,
  type AvailableHousekeepersResponse,
  type CleaningResultsResponse,
  type CleaningResultsRow,
  type CleaningServiceType,
  type CleaningTaskRow,
  type HousekeeperAvailabilityStatus,
  type OverdueSession,
} from "./cleaningApi";
export { fetchMyWork, type MyWorkPayload } from "./myWorkApi";
// Maintenance tickets & catalog API.
// Re-export public API surface.
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
  updateIssueOption,
  updateMaintenanceCategory,
  updateSlaPolicy,
  type IssueOptionRow,
  type MaintenanceCategoryRow,
  type MaintenanceTicket,
  type SlaPolicyRow,
  type TicketListPage,
} from "./maintenanceApi";

// Rooms / locations / QR API.
// Re-export public API surface.
export {
  archiveLocation,
  createLocation,
  fetchCommonAreas,
  fetchLocationHierarchy,
  fetchLocationsCatalog,
  fetchRooms,
  markCommonAreaDirty,
  markRoomDirty,
  resolveLocationByQr,
  restoreLocation,
  roomQrImageUrl,
  roomQrScanUrl,
  setLocationOccupancy,
  setLocationServiceStatus,
  updateLocation,
  type LocationHierarchyBuilding,
  type LocationKind,
  type LocationOccupancy,
  type LocationQrPayload,
  type LocationServiceStatus,
  type Room,
} from "./locationsApi";

// Operations live board API.
// Re-export public API surface.
export {
  fetchOperationsLive,
  type LiveActiveSession,
  type LiveAuditItem,
  type LiveBoardEmployee,
  type LiveBoardLocation,
  type LiveCompletedSession,
  type LiveNeedsAttention,
  type OperationsLive,
} from "./operationsLiveApi";

// Analytics summary API.
// Re-export public API surface.
export {
  fetchAnalyticsSummary,
  type AnalyticsDomain,
  type AnalyticsMetricCompare,
  type AnalyticsSeriesPoint,
  type AnalyticsSummary,
  type HousekeepingAnalyticsKpis,
  type MaintenanceAnalyticsKpis,
} from "./analyticsApi";

// People & invitations API.
// Re-export public API surface.
export {
  deviceFingerprint,
  fetchHousekeepers,
  fetchInvitations,
  fetchPeople,
  issueInvitation,
  redeemInvitation,
  revokeInvitation,
  updatePersonRole,
  type Invitation,
  type IssuedInvitation,
  type Person,
} from "./peopleApi";

// Daily plan API.
// Re-export public API surface.
export {
  applyDepartureRoomEffects,
  createDailyPlanEntry,
  deleteDailyPlanEntry,
  fetchDailyPlan,
  importDailyPlan,
  todayHotelDate,
  type DailyPlan,
  type DailyPlanCategory,
  type DailyPlanEntry,
  type DailyPlanImportBatch,
  type DailyPlanImportPayload,
  type DailyPlanSource,
  type DepartureRoomEffectsResult,
} from "./planApi";

// Settings & system status API.
// Re-export public API surface.
export {
  fetchAllSettings,
  fetchPublicSettings,
  fetchSettingsHistory,
  fetchSystemStatus,
  patchSetting,
  type PublicSettings,
  type SettingHistoryRow,
  type SettingsBundle,
  type SystemStatus,
} from "./settingsApi";

// Audit events API.
// Re-export public API surface.
export {
  fetchAuditEvents,
  type AuditEventRow,
} from "./auditApi";

// Permission matrix API.
// Re-export public API surface.
export {
  fetchPermissionHistory,
  fetchPermissionMatrix,
  putRoleGrants,
  type PermissionHistoryRow,
  type PermissionMatrix,
} from "./permissionsApi";

// Attendance intervals API.
// Re-export public API surface.
export {
  downloadAttendanceCsv,
  fetchAttendanceIntervals,
  requestAttendanceAdjustment,
  reviewAttendanceAdjustment,
  type AttendanceInterval,
  type AttendanceScope,
} from "./attendanceApi";

// Access cards API.
// Re-export public API surface.
export {
  fetchCardEmployees,
  fetchCards,
  issueCard,
  revokeCard,
  type AccessCard,
  type AccessCardGrant,
  type CardEmployeeOption,
  type CardStatus,
  type CardType,
} from "./cardsApi";

// Sectors API.
// Re-export public API surface.
export {
  createSector,
  fetchMySectors,
  fetchSectors,
  setSectorLocations,
  updateSector,
  type MySectorsResponse,
  type SectorRow,
} from "./sectorsApi";

// Shifts & roster API.
// Re-export public API surface.
export {
  createShift,
  fetchShiftRoster,
  fetchShifts,
  saveShiftRoster,
  updateShift,
  type ShiftRoster,
  type ShiftRosterEntry,
  type ShiftRow,
} from "./shiftsApi";

// Background job runs API.
// Re-export public API surface.
export {
  fetchJobRuns,
  type JobRunRow,
} from "./jobsApi";

// In-app notifications API.
// Re-export public API surface.
export {
  dismissNotification,
  fetchNotificationUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from "./notificationsApi";
