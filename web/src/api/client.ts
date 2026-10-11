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

export {
  archiveLocation,
  createLocation,
  fetchCommonAreas,
  fetchLocationHierarchy,
  fetchLocationQr,
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

export {
  fetchAnalyticsSummary,
  type AnalyticsDomain,
  type AnalyticsMetricCompare,
  type AnalyticsSeriesPoint,
  type AnalyticsSummary,
  type HousekeepingAnalyticsKpis,
  type MaintenanceAnalyticsKpis,
} from "./analyticsApi";

export {
  deviceFingerprint,
  fetchDevices,
  fetchHousekeepers,
  fetchInvitations,
  fetchPeople,
  issueInvitation,
  redeemInvitation,
  revokeDevice,
  revokeInvitation,
  updatePersonRole,
  type DeviceRow,
  type Invitation,
  type IssuedInvitation,
  type Person,
} from "./peopleApi";

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

export {
  fetchAuditEvents,
  type AuditEventRow,
} from "./auditApi";

export {
  fetchPermissionHistory,
  fetchPermissionMatrix,
  putRoleGrants,
  type PermissionHistoryRow,
  type PermissionMatrix,
} from "./permissionsApi";

export {
  downloadAttendanceCsv,
  fetchAttendanceIntervals,
  requestAttendanceAdjustment,
  reviewAttendanceAdjustment,
  type AttendanceInterval,
  type AttendanceScope,
} from "./attendanceApi";

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

export {
  createSector,
  fetchMySectors,
  fetchSectors,
  setSectorLocations,
  updateSector,
  type MySectorsResponse,
  type SectorRow,
} from "./sectorsApi";

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

export {
  fetchJobRuns,
  type JobRunRow,
} from "./jobsApi";

export { fetchMyWork } from "./myWorkApi";

export { syncPull, syncPush } from "./syncApi";

export {
  dismissNotification,
  fetchNotificationUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from "./notificationsApi";
