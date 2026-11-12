/**
 * Attendance service barrel: rules, ingest, rebuild, adjustments, and reports.
 */
export {
  // Export OPEN_MISSING_END_HOURS.
  OPEN_MISSING_END_HOURS,
  // Export addDaysYmd.
  addDaysYmd,
  // Export asFlags.
  asFlags,
  // Export assertValidAdjustmentTimes.
  assertValidAdjustmentTimes,
  // Export computeWorkedMinutes.
  computeWorkedMinutes,
  // Export eventRequiresIntervalLink.
  eventRequiresIntervalLink,
  // Export hotelDateKey.
  hotelDateKey,
  // Export pairEventsToIntervalDrafts.
  pairEventsToIntervalDrafts,
  // Export uniqueFlags.
  uniqueFlags,
  // Export type AnomalyFlag.
  type AnomalyFlag,
  // Export type FrozenRange.
  type FrozenRange,
  // Export type IntervalDraft.
  type IntervalDraft,
  // Export type RebuildEvent.
  type RebuildEvent,
// Support the surrounding control flow.
} from "../attendanceRules";
// Re-export symbols for a stable public API.
export {
  // Export EXPORT_BATCH.
  EXPORT_BATCH,
  // Export EXPORT_CEILING.
  EXPORT_CEILING,
  // Export LIST_DEFAULT_LIMIT.
  LIST_DEFAULT_LIMIT,
  // Export LIST_MAX_LIMIT.
  LIST_MAX_LIMIT,
  // Export decodeIntervalCursor.
  decodeIntervalCursor,
  // Export drainExportPages.
  drainExportPages,
  // Export encodeIntervalCursor.
  encodeIntervalCursor,
  // Export getInterval.
  getInterval,
  // Export intervalsToCsv.
  intervalsToCsv,
  // Export listIntervals.
  listIntervals,
  // Export listIntervalsForExport.
  listIntervalsForExport,
  // Export listPageFromRows.
  listPageFromRows,
  // Export mapInterval.
  mapInterval,
  // Export maxClockSkewSeconds.
  maxClockSkewSeconds,
  // Export resolveListLimit.
  resolveListLimit,
  // Export type IntervalCursor.
  type IntervalCursor,
  // Export type ListIntervalsFilter.
  type ListIntervalsFilter,
  // Export type ListIntervalsPage.
  type ListIntervalsPage,
// Support the surrounding control flow.
} from "./reports";

// Re-export symbols for a stable public API.
export {
  // Export formatHotelDate.
  formatHotelDate,
  // Export hotelDateAsUtcDate.
  hotelDateAsUtcDate,
  // Export hotelDateString.
  hotelDateString,
  // Export resolveUsableHotelTimeZone.
  resolveUsableHotelTimeZone,
  // Export todayHotelDateYmd.
  todayHotelDateYmd,
  // Export zonedDayStartUtc.
  zonedDayStartUtc,
// Support the surrounding control flow.
} from "../hotelTime";

// Re-export symbols for a stable public API.
export {
  // Export type StaleOpenClaimDb.
  type StaleOpenClaimDb,
  // Export claimStaleOpenInterval.
  claimStaleOpenInterval,
  // Export markStaleOpenIntervals.
  markStaleOpenIntervals,
  // Export rebuildIntervalsForEmployee.
  rebuildIntervalsForEmployee,
// Support the surrounding control flow.
} from "./rebuild";

// Re-export symbols for a stable public API.
export { ingestEvent } from "./ingest";

// Re-export symbols for a stable public API.
export { requestAdjustment, reviewAdjustment } from "./adjustments";
