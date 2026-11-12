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
  // List item in import/export/params.
  ApiRequestError,
  // List item in import/export/params.
  clearSession,
  // List item in import/export/params.
  fetchMe,
  // List item in import/export/params.
  getStoredUser,
  // List item in import/export/params.
  hasCachedSession,
  // List item in import/export/params.
  login,
  // List item in import/export/params.
  logout,
  // List item in import/export/params.
  logoutAll,
  // List item in import/export/params.
  refreshAccessToken,
// Close multi-line construct with trailing syntax.
} from "./http";
// Role / panel / action capabilities.
// Re-export public API surface.
export {
  // List item in import/export/params.
  ALL_ROLES,
  // List item in import/export/params.
  assignableRolesFor,
  // Permission / capability gate (SEC-003: do not re-export legacy role helpers).
  canManagePersonAccess,
  // List item in import/export/params.
  canPerformAction,
  // List item in import/export/params.
  canViewControl,
  // List item in import/export/params.
  canViewTeam,
  // List item in import/export/params.
  filterPanelsByModules,
  // List item in import/export/params.
  isOwner,
  // List item in import/export/params.
  isPrivilegedRole,
  // List item in import/export/params.
  landingForRole,
  // List item in import/export/params.
  landingForUser,
  // List item in import/export/params.
  panelsForRole,
  // List item in import/export/params.
  panelsForUser,
  // List item in import/export/params.
  ROLE_LABELS,
  // Local type alias shaping data.
  type Action,
  // Local type alias shaping data.
  type AuthUser,
  // Local type alias shaping data.
  type ModuleToggles,
  // Local type alias shaping data.
  type Panel,
  // Local type alias shaping data.
  type Role,
// Close multi-line construct with trailing syntax.
} from "./capabilities";
// Live SSE event subscription.
// Re-export public API surface.
export {
  // List item in import/export/params.
  subscribeLiveEvents,
  // Local type alias shaping data.
  type LiveEvent,
  // Local type alias shaping data.
  type LiveEventType,
// Close multi-line construct with trailing syntax.
} from "./liveEvents";
// Cleaning tasks & sessions API.
// Re-export public API surface.
export {
  // List item in import/export/params.
  cancelCleaningSession,
  // List item in import/export/params.
  completeCleaningSession,
  // List item in import/export/params.
  createCleaningTask,
  // List item in import/export/params.
  fetchAvailableHousekeepers,
  // List item in import/export/params.
  fetchCleaningResults,
  // List item in import/export/params.
  fetchOverdueSessions,
  // List item in import/export/params.
  inspectCleaningTask,
  // List item in import/export/params.
  reassignCleaningTask,
  // List item in import/export/params.
  startCleaningTask,
  // Local type alias shaping data.
  type AvailableHousekeeper,
  // Local type alias shaping data.
  type AvailableHousekeepersResponse,
  // Local type alias shaping data.
  type CleaningResultsResponse,
  // Local type alias shaping data.
  type CleaningResultsRow,
  // Local type alias shaping data.
  type CleaningServiceType,
  // Local type alias shaping data.
  type CleaningTaskRow,
  // Local type alias shaping data.
  type HousekeeperAvailabilityStatus,
  // Local type alias shaping data.
  type OverdueSession,
// Close multi-line construct with trailing syntax.
} from "./cleaningApi";
// Re-export selected public symbols.
export { fetchMyWork, type MyWorkPayload } from "./myWorkApi";
// Maintenance tickets & catalog API.
// Re-export public API surface.
export {
  // List item in import/export/params.
  archiveIssueOption,
  // List item in import/export/params.
  archiveMaintenanceCategory,
  // List item in import/export/params.
  createIssueOption,
  // List item in import/export/params.
  createMaintenanceCategory,
  // List item in import/export/params.
  fetchIssueOptions,
  // List item in import/export/params.
  fetchMaintenanceCategories,
  // List item in import/export/params.
  fetchSlaPolicies,
  // List item in import/export/params.
  fetchTicketEvents,
  // List item in import/export/params.
  fetchTickets,
  // List item in import/export/params.
  reorderIssueOptions,
  // List item in import/export/params.
  reportIssue,
  // List item in import/export/params.
  updateIssueOption,
  // List item in import/export/params.
  updateMaintenanceCategory,
  // List item in import/export/params.
  updateSlaPolicy,
  // Local type alias shaping data.
  type IssueOptionRow,
  // Local type alias shaping data.
  type MaintenanceCategoryRow,
  // Local type alias shaping data.
  type MaintenanceTicket,
  // Local type alias shaping data.
  type SlaPolicyRow,
  // Local type alias shaping data.
  type TicketListPage,
// Close multi-line construct with trailing syntax.
} from "./maintenanceApi";
// Re-export selected public symbols.
export {
  // List item in import/export/params.
  parseDuplicateReportError,
  // Local type alias shaping data.
  type DuplicateReportInfo,
  // Local type alias shaping data.
  type ExistingTicketSummary,
// Close multi-line construct with trailing syntax.
} from "./duplicateReport";

// Rooms / locations API.
// Re-export public API surface.
export {
  // List item in import/export/params.
  archiveLocation,
  // List item in import/export/params.
  createLocation,
  // List item in import/export/params.
  fetchCommonAreas,
  // List item in import/export/params.
  fetchLocationHierarchy,
  // List item in import/export/params.
  fetchLocationsCatalogPage,
  // List item in import/export/params.
  fetchRooms,
  // List item in import/export/params.
  markCommonAreaDirty,
  // List item in import/export/params.
  markRoomDirty,
  // List item in import/export/params.
  restoreLocation,
  // List item in import/export/params.
  setLocationOccupancy,
  // List item in import/export/params.
  setLocationServiceStatus,
  // List item in import/export/params.
  updateLocation,
  // Local type alias shaping data.
  type LocationHierarchyBuilding,
  // Local type alias shaping data.
  type LocationKind,
  // Local type alias shaping data.
  type LocationOccupancy,
  // Local type alias shaping data.
  type LocationServiceStatus,
  // Local type alias shaping data.
  type LocationsCatalogPage,
  // Local type alias shaping data.
  type Room,
// Close multi-line construct with trailing syntax.
} from "./locationsApi";

// Operations live board API.
// Re-export public API surface.
export {
  // List item in import/export/params.
  fetchOperationsLive,
  // List item in import/export/params.
  fetchOperationsLiveAttention,
  // Local type alias shaping data.
  type LiveActiveSession,
  // Local type alias shaping data.
  type LiveAuditItem,
  // Local type alias shaping data.
  type LiveBoardEmployee,
  // Local type alias shaping data.
  type LiveBoardLocation,
  // Local type alias shaping data.
  type LiveCompletedSession,
  // Local type alias shaping data.
  type LiveNeedsAttention,
  // Local type alias shaping data.
  type AttentionPageMeta,
  // Local type alias shaping data.
  type LiveAttentionPage,
  // Local type alias shaping data.
  type OperationsLive,
// Close multi-line construct with trailing syntax.
} from "./operationsLiveApi";

// Analytics summary API.
// Re-export public API surface.
export {
  // List item in import/export/params.
  fetchAnalyticsSummary,
  // Local type alias shaping data.
  type AnalyticsDomain,
  // Local type alias shaping data.
  type AnalyticsMetricCompare,
  // Local type alias shaping data.
  type AnalyticsSeriesPoint,
  // Local type alias shaping data.
  type AnalyticsSummary,
  // Local type alias shaping data.
  type HousekeepingAnalyticsKpis,
  // Local type alias shaping data.
  type MaintenanceAnalyticsKpis,
// Close multi-line construct with trailing syntax.
} from "./analyticsApi";

// People & invitations API.
// Re-export public API surface.
export {
  // List item in import/export/params.
  archivePerson,
  // List item in import/export/params.
  blockPerson,
  // List item in import/export/params.
  deviceFingerprint,
  // List item in import/export/params.
  fetchEmployeeDevices,
  // List item in import/export/params.
  fetchHousekeepers,
  // List item in import/export/params.
  fetchInvitations,
  // List item in import/export/params.
  fetchPeople,
  // List item in import/export/params.
  fetchPeoplePage,
  // List item in import/export/params.
  issueInvitation,
  // List item in import/export/params.
  redeemInvitation,
  // List item in import/export/params.
  restorePerson,
  // List item in import/export/params.
  revokeEmployeeDevice,
  // List item in import/export/params.
  revokeInvitation,
  // List item in import/export/params.
  unblockPerson,
  // List item in import/export/params.
  updatePersonRole,
  // Local type alias shaping data.
  type Invitation,
  // Local type alias shaping data.
  type IssuedInvitation,
  // Local type alias shaping data.
  type PeoplePage,
  // Local type alias shaping data.
  type Person,
  // Local type alias shaping data.
  type PersonStatus,
  // Local type alias shaping data.
  type RegisteredDevice,
// Close multi-line construct with trailing syntax.
} from "./peopleApi";

// Daily plan API.
// Re-export public API surface.
export {
  // List item in import/export/params.
  applyDepartureRoomEffects,
  // List item in import/export/params.
  createDailyPlanEntry,
  // List item in import/export/params.
  deleteDailyPlanEntry,
  // List item in import/export/params.
  fetchDailyPlan,
  // List item in import/export/params.
  importDailyPlan,
  // List item in import/export/params.
  todayHotelDate,
  // Local type alias shaping data.
  type DailyPlan,
  // Local type alias shaping data.
  type DailyPlanCategory,
  // Local type alias shaping data.
  type DailyPlanEntry,
  // Local type alias shaping data.
  type DailyPlanImportBatch,
  // Local type alias shaping data.
  type DailyPlanImportPayload,
  // Local type alias shaping data.
  type DailyPlanSource,
  // Local type alias shaping data.
  type DepartureRoomEffectsResult,
// Close multi-line construct with trailing syntax.
} from "./planApi";

// Settings & system status API.
// Re-export public API surface.
export {
  // List item in import/export/params.
  fetchAllSettings,
  // List item in import/export/params.
  fetchPublicSettings,
  // List item in import/export/params.
  fetchSettingsHistory,
  // List item in import/export/params.
  fetchSystemStatus,
  // List item in import/export/params.
  patchSetting,
  // Local type alias shaping data.
  type PublicSettings,
  // Local type alias shaping data.
  type SettingHistoryRow,
  // Local type alias shaping data.
  type SettingsBundle,
  // Local type alias shaping data.
  type SystemStatus,
// Close multi-line construct with trailing syntax.
} from "./settingsApi";

// Audit events API.
// Re-export public API surface.
export {
  // List item in import/export/params.
  fetchAuditEvents,
  // Local type alias shaping data.
  type AuditEventRow,
// Close multi-line construct with trailing syntax.
} from "./auditApi";

// Permission matrix API.
// Re-export public API surface.
export {
  // List item in import/export/params.
  fetchPermissionHistory,
  // List item in import/export/params.
  fetchPermissionMatrix,
  // List item in import/export/params.
  putRoleGrants,
  // Local type alias shaping data.
  type PermissionHistoryRow,
  // Local type alias shaping data.
  type PermissionMatrix,
// Close multi-line construct with trailing syntax.
} from "./permissionsApi";

// Attendance intervals API.
// Re-export public API surface.
export {
  // List item in import/export/params.
  downloadAttendanceCsv,
  // List item in import/export/params.
  fetchAttendanceIntervals,
  // List item in import/export/params.
  requestAttendanceAdjustment,
  // List item in import/export/params.
  reviewAttendanceAdjustment,
  // Local type alias shaping data.
  type AttendanceInterval,
  // Local type alias shaping data.
  type AttendanceScope,
// Close multi-line construct with trailing syntax.
} from "./attendanceApi";

// Access cards API.
// Re-export public API surface.
export {
  // List item in import/export/params.
  fetchCardEmployees,
  // List item in import/export/params.
  fetchCards,
  // List item in import/export/params.
  issueCard,
  // List item in import/export/params.
  revokeCard,
  // Local type alias shaping data.
  type AccessCard,
  // Local type alias shaping data.
  type AccessCardGrant,
  // Local type alias shaping data.
  type CardEmployeeOption,
  // Local type alias shaping data.
  type CardStatus,
  // Local type alias shaping data.
  type CardType,
// Close multi-line construct with trailing syntax.
} from "./cardsApi";

// Sectors API.
// Re-export public API surface.
export {
  // List item in import/export/params.
  createSector,
  // List item in import/export/params.
  fetchMySectors,
  // List item in import/export/params.
  fetchSectors,
  // List item in import/export/params.
  updateSector,
  // Local type alias shaping data.
  type MySectorsResponse,
  // Local type alias shaping data.
  type SectorRow,
// Close multi-line construct with trailing syntax.
} from "./sectorsApi";

// Shifts & roster API.
// Re-export public API surface.
export {
  // List item in import/export/params.
  createShift,
  // List item in import/export/params.
  fetchShiftRoster,
  // List item in import/export/params.
  fetchShifts,
  // List item in import/export/params.
  saveShiftRoster,
  // List item in import/export/params.
  updateShift,
  // Local type alias shaping data.
  type ShiftRoster,
  // Local type alias shaping data.
  type ShiftRosterEntry,
  // Local type alias shaping data.
  type ShiftRow,
// Close multi-line construct with trailing syntax.
} from "./shiftsApi";

// Background job runs API.
// Re-export public API surface.
export {
  // List item in import/export/params.
  fetchJobRuns,
  // Local type alias shaping data.
  type JobRunRow,
// Close multi-line construct with trailing syntax.
} from "./jobsApi";

// In-app notifications API.
// Re-export public API surface.
export {
  // List item in import/export/params.
  dismissNotification,
  // List item in import/export/params.
  fetchNotificationUnreadCount,
  // List item in import/export/params.
  listNotifications,
  // List item in import/export/params.
  markAllNotificationsRead,
  // List item in import/export/params.
  markNotificationRead,
  // Local type alias shaping data.
  type AppNotification,
// Close multi-line construct with trailing syntax.
} from "./notificationsApi";
