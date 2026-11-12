/**
 * Real-time housekeeper availability for cleaning reassignment pickers.
 *
 * Classification never invents presence from roster alone. Missing or ambiguous
 * attendance yields `unknown`. Workload (assigned task count) is separate from
 * availability — assigned upcoming work does not make someone busy.
 */
import {
  // Run next step: AttendanceEventKind,
  AttendanceEventKind,
  // Run next step: AttendanceIntervalStatus,
  AttendanceIntervalStatus,
  // Run next step: Prisma,
  Prisma,
  // Run next step: Role,
  Role,
  // Run next step: SessionStatus,
  SessionStatus,
// Run next step: } from "@prisma/client";
} from "@prisma/client";
// Import module ../../constants for this service.
import { ACTIVE_TASK_STATUSES } from "../../constants";
// Import module ../../db for this service.
import { prisma } from "../../db";
// Import module ../../errors for this service.
import { AppError } from "../../errors";
// Import module ../assignees for this service.
import { CLEANING_ASSIGNEE_ROLES } from "../assignees";
// Import module dependency for this service.
import {
  // Run next step: getHotelNow,
  getHotelNow,
  // Run next step: hotelDateAsUtcDate,
  hotelDateAsUtcDate,
  // Run next step: hotelDateString,
  hotelDateString,
  // Run next step: hotelLocalHhMm,
  hotelLocalHhMm,
// Run next step: } from "../hotelTime";
} from "../hotelTime";

// Re-export selected symbols for barrel consumers.
export { hotelLocalHhMm };
// Import module ../settings for this service.
import { getOperations } from "../settings";

// Declare type AvailabilityStatus for callers and internals.
export type AvailabilityStatus =
  // Run next step: | "available"
  | "available"
  // Run next step: | "busy"
  | "busy"
  // Run next step: | "on_break"
  | "on_break"
  // Run next step: | "off_shift"
  | "off_shift"
  // Run next step: | "absent"
  | "absent"
  // Run next step: | "unknown";
  | "unknown";

// Declare type HousekeeperAvailability for callers and internals.
export type HousekeeperAvailability = {
  // Set employeeId on the structure being built.
  employeeId: string;
  // Set fullName on the structure being built.
  fullName: string;
  // Set employeeNumber on the structure being built.
  employeeNumber: string;
  // Set availabilityStatus on the structure being built.
  availabilityStatus: AvailabilityStatus;
  // Set availabilityReasons on the structure being built.
  availabilityReasons: string[];
  // Set currentShift on the structure being built.
  currentShift: {
    // Set id on the structure being built.
    id: string;
    // Set code on the structure being built.
    code: string;
    // Set nameBg on the structure being built.
    nameBg: string;
    // Set nameEn on the structure being built.
    nameEn: string;
    // Set startTime on the structure being built.
    startTime: string;
    // Set endTime on the structure being built.
    endTime: string;
  // Run next step: } | null;
  } | null;
  // Set currentRunningTask on the structure being built.
  currentRunningTask: {
    // Set taskId on the structure being built.
    taskId: string;
    // Set locationId on the structure being built.
    locationId: string;
    // Set locationNumber on the structure being built.
    locationNumber: string;
  // Run next step: } | null;
  } | null;
  // Set assignedTaskCount on the structure being built.
  assignedTaskCount: number;
  // Set sectorEligibility on the structure being built.
  sectorEligibility: "hotel_wide";
  // Set checkedAt on the structure being built.
  checkedAt: string;
};

// Declare type AvailableHousekeepersResult for callers and internals.
export type AvailableHousekeepersResult = {
  // Set locationId on the structure being built.
  locationId: string;
  // Set taskId on the structure being built.
  taskId: string | null;
  // Set hotelDate on the structure being built.
  hotelDate: string;
  // Set checkedAt on the structure being built.
  checkedAt: string;
  // Set housekeepers on the structure being built.
  housekeepers: HousekeeperAvailability[];
};

/** Roles allowed to force-reassign despite non-available status. */
export const AVAILABILITY_OVERRIDE_ROLES: readonly Role[] = [
  // Run next step: Role.owner,
  Role.owner,
  // Run next step: Role.admin,
  Role.admin,
  // Run next step: Role.manager,
  Role.manager,
  // Run next step: Role.supervisor,
  Role.supervisor,
];

/** Statuses that an authorized override may bypass (never busy). */
export const OVERRIDABLE_AVAILABILITY: ReadonlySet<AvailabilityStatus> =
  // Run next step: new Set(["off_shift", "unknown", "on_break", "absent"]);
  new Set(["off_shift", "unknown", "on_break", "absent"]);

// Capture status sort for use in this scope.
const STATUS_SORT: Record<AvailabilityStatus, number> = {
  // Set available on the structure being built.
  available: 0,
  // Set unknown on the structure being built.
  unknown: 1,
  // Set on_break on the structure being built.
  on_break: 2,
  // Set busy on the structure being built.
  busy: 3,
  // Set absent on the structure being built.
  absent: 4,
  // Set off_shift on the structure being built.
  off_shift: 5,
};

// Declare type AssigneeDb for callers and internals.
type AssigneeDb = Prisma.TransactionClient | typeof prisma;

/** Parse HH:mm to minutes since midnight; null if invalid. */
export function hhMmToMinutes(value: string): number | null {
  // Capture m for use in this scope.
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  // Branch when this condition holds so the right path runs.
  if (!m) return null;
  // Capture h for use in this scope.
  const h = Number(m[1]);
  // Capture min for use in this scope.
  const min = Number(m[2]);
  // Branch when this condition holds so the right path runs.
  if (h > 23 || min > 59) return null;
  // Return the computed result to the caller.
  return h * 60 + min;
}

/**
 * Whether hotel-local HH:mm falls inside a shift window.
 * Overnight when start > end (e.g. 22:00–06:00). Equal start/end = full day.
 */
export function isWithinShiftWindow(
  // Set nowHhMm on the structure being built.
  nowHhMm: string,
  // Set startTime on the structure being built.
  startTime: string,
  // Set endTime on the structure being built.
  endTime: string,
// Run next step: ): boolean {
): boolean {
  // Capture now for use in this scope.
  const now = hhMmToMinutes(nowHhMm);
  // Capture start for use in this scope.
  const start = hhMmToMinutes(startTime);
  // Capture end for use in this scope.
  const end = hhMmToMinutes(endTime);
  // Branch when this condition holds so the right path runs.
  if (now == null || start == null || end == null) return false;
  // Branch when this condition holds so the right path runs.
  if (start === end) return true;
  // Branch when this condition holds so the right path runs.
  if (start < end) return now >= start && now < end;
  // Return the computed result to the caller.
  return now >= start || now < end;
}

// Declare type ClassifyInput for callers and internals.
type ClassifyInput = {
  // Set hasRunningSession on the structure being built.
  hasRunningSession: boolean;
  // Set rosterShift on the structure being built.
  rosterShift: { startTime: string; endTime: string } | null;
  // Set nowHhMm on the structure being built.
  nowHhMm: string;
  /** Latest attendance interval for the hotel date, if any. */
  interval: {
    // Set status on the structure being built.
    status: AttendanceIntervalStatus;
    // Set startedAt on the structure being built.
    startedAt: Date;
    // Set endedAt on the structure being built.
    endedAt: Date | null;
  // Run next step: } | null;
  } | null;
  /** True when an unpaired break_start exists after interval start. */
  onBreak: boolean;
};

/**
 * Pure classifier — unit-test without DB.
 * Order: busy → off_shift → attendance-derived states.
 */
export function classifyAvailability(
  // Set input on the structure being built.
  input: ClassifyInput,
// Run next step: ): { status: AvailabilityStatus; reasons: string[] } {
): { status: AvailabilityStatus; reasons: string[] } {
  // Capture reasons for use in this scope.
  const reasons: string[] = [];

  // Branch when this condition holds so the right path runs.
  if (input.hasRunningSession) {
    // Append an entry to the accumulating collection.
    reasons.push("running_cleaning_session");
    // Return the computed result to the caller.
    return { status: "busy", reasons };
  }

  // Branch when this condition holds so the right path runs.
  if (!input.rosterShift) {
    // Append an entry to the accumulating collection.
    reasons.push("no_roster_shift");
    // Return the computed result to the caller.
    return { status: "off_shift", reasons };
  }

  // Branch when this condition holds so the right path runs.
  if (
    // Run next step: !isWithinShiftWindow(
    !isWithinShiftWindow(
      // Run next step: input.nowHhMm,
      input.nowHhMm,
      // Run next step: input.rosterShift.startTime,
      input.rosterShift.startTime,
      // Run next step: input.rosterShift.endTime,
      input.rosterShift.endTime,
    )
  // Run next step: ) {
  ) {
    // Append an entry to the accumulating collection.
    reasons.push("outside_shift_window");
    // Return the computed result to the caller.
    return { status: "off_shift", reasons };
  }

  // Append an entry to the accumulating collection.
  reasons.push("on_roster_shift");

  // Branch when this condition holds so the right path runs.
  if (!input.interval) {
    // Append an entry to the accumulating collection.
    reasons.push("missing_attendance");
    // Return the computed result to the caller.
    return { status: "unknown", reasons };
  }

  // Branch when this condition holds so the right path runs.
  if (input.interval.status === AttendanceIntervalStatus.needs_review) {
    // Append an entry to the accumulating collection.
    reasons.push("attendance_needs_review");
    // Return the computed result to the caller.
    return { status: "unknown", reasons };
  }

  // Branch when this condition holds so the right path runs.
  if (
    // Run next step: input.interval.status === AttendanceIntervalStatus.open &&
    input.interval.status === AttendanceIntervalStatus.open &&
    // Run next step: input.interval.endedAt == null
    input.interval.endedAt == null
  // Run next step: ) {
  ) {
    // Branch when this condition holds so the right path runs.
    if (input.onBreak) {
      // Append an entry to the accumulating collection.
      reasons.push("on_break");
      // Return the computed result to the caller.
      return { status: "on_break", reasons };
    }
    // Append an entry to the accumulating collection.
    reasons.push("clocked_in");
    // Return the computed result to the caller.
    return { status: "available", reasons };
  }

  // Branch when this condition holds so the right path runs.
  if (
    // Run next step: input.interval.status === AttendanceIntervalStatus.closed ||
    input.interval.status === AttendanceIntervalStatus.closed ||
    // Run next step: input.interval.status === AttendanceIntervalStatus.adjusted …
    input.interval.status === AttendanceIntervalStatus.adjusted ||
    // Run next step: input.interval.endedAt != null
    input.interval.endedAt != null
  // Run next step: ) {
  ) {
    // Append an entry to the accumulating collection.
    reasons.push("clocked_out");
    // Return the computed result to the caller.
    return { status: "absent", reasons };
  }

  // Append an entry to the accumulating collection.
  reasons.push("ambiguous_attendance");
  // Return the computed result to the caller.
  return { status: "unknown", reasons };
}

/**
 * Batch-fetch availability rows for the given housekeeper ids (newest-first sort).
 * Exported for characterization tests; prefer listAvailableHousekeepers at call sites.
 */
export async function buildAvailability(input: {
  // Set employees on the structure being built.
  employees: Array<{ id: string; fullName: string; employeeNumber: string }>;
  // Set db on the structure being built.
  db: AssigneeDb;
  // Set now on the structure being built.
  now: Date;
  // Set hotelDateKey on the structure being built.
  hotelDateKey: Date;
  // Set nowHhMm on the structure being built.
  nowHhMm: string;
  // Set checkedAt on the structure being built.
  checkedAt: string;
// Run next step: }): Promise<HousekeeperAvailability[]> {
}): Promise<HousekeeperAvailability[]> {
  // Destructure value fields needed locally.
  const { employees, db, now, hotelDateKey, nowHhMm, checkedAt } = input;
  // Branch when this condition holds so the right path runs.
  if (employees.length === 0) return [];

  // Capture ids for use in this scope.
  const ids = employees.map((h) => h.id);

  // Destructure value fields needed locally.
  const [rosters, intervals, runningSessions, taskCounts, breakEvents] =
    // Wait for the async step before continuing.
    await Promise.all([
      // Persist or query via Prisma for durable state.
      db.employeeShiftRoster.findMany({
        // Set where on the structure being built.
        where: { employeeId: { in: ids }, hotelDate: hotelDateKey },
        // Set include on the structure being built.
        include: {
          // Set shift on the structure being built.
          shift: {
            // Set select on the structure being built.
            select: {
              // Set id on the structure being built.
              id: true,
              // Set code on the structure being built.
              code: true,
              // Set nameBg on the structure being built.
              nameBg: true,
              // Set nameEn on the structure being built.
              nameEn: true,
              // Set startTime on the structure being built.
              startTime: true,
              // Set endTime on the structure being built.
              endTime: true,
              // Set isActive on the structure being built.
              isActive: true,
            },
          },
        },
      }),
      // Persist or query via Prisma for durable state.
      db.attendanceInterval.findMany({
        // Set where on the structure being built.
        where: {
          // Set employeeId on the structure being built.
          employeeId: { in: ids },
          // Set hotelDate on the structure being built.
          hotelDate: hotelDateKey,
          // Set status on the structure being built.
          status: {
            // Set in on the structure being built.
            in: [
              // Run next step: AttendanceIntervalStatus.open,
              AttendanceIntervalStatus.open,
              // Run next step: AttendanceIntervalStatus.closed,
              AttendanceIntervalStatus.closed,
              // Run next step: AttendanceIntervalStatus.needs_review,
              AttendanceIntervalStatus.needs_review,
              // Run next step: AttendanceIntervalStatus.adjusted,
              AttendanceIntervalStatus.adjusted,
            ],
          },
        },
        // Set orderBy on the structure being built.
        orderBy: { startedAt: "desc" },
      }),
      // Persist or query via Prisma for durable state.
      db.cleaningSession.findMany({
        // Set where on the structure being built.
        where: {
          // Set employeeId on the structure being built.
          employeeId: { in: ids },
          // Set status on the structure being built.
          status: SessionStatus.running,
        },
        // Set include on the structure being built.
        include: {
          // Set task on the structure being built.
          task: {
            // Set select on the structure being built.
            select: {
              // Set id on the structure being built.
              id: true,
              // Set locationId on the structure being built.
              locationId: true,
              // Set location on the structure being built.
              location: { select: { number: true } },
            },
          },
        },
      }),
      // Run next step: db.cleaningTask.groupBy({
      db.cleaningTask.groupBy({
        // Set by on the structure being built.
        by: ["assignedEmployeeId"],
        // Set where on the structure being built.
        where: {
          // Set assignedEmployeeId on the structure being built.
          assignedEmployeeId: { in: ids },
          // Set hotelDate on the structure being built.
          hotelDate: hotelDateKey,
          // Set status on the structure being built.
          status: { in: ACTIVE_TASK_STATUSES },
        },
        // Set _count on the structure being built.
        _count: { _all: true },
      }),
      // Persist or query via Prisma for durable state.
      db.attendanceEvent.findMany({
        // Set where on the structure being built.
        where: {
          // Set employeeId on the structure being built.
          employeeId: { in: ids },
          // Set kind on the structure being built.
          kind: {
            // Set in on the structure being built.
            in: [AttendanceEventKind.break_start, AttendanceEventKind.break_end],
          },
          // Set normalizedTime on the structure being built.
          normalizedTime: {
            // Set gte on the structure being built.
            gte: new Date(now.getTime() - 36 * 60 * 60 * 1000),
          },
        },
        // Set orderBy on the structure being built.
        orderBy: { normalizedTime: "asc" },
        // Set select on the structure being built.
        select: {
          // Set employeeId on the structure being built.
          employeeId: true,
          // Set kind on the structure being built.
          kind: true,
          // Set normalizedTime on the structure being built.
          normalizedTime: true,
        },
      }),
    ]);

  // Capture roster by employee for use in this scope.
  const rosterByEmployee = new Map(
    // Run next step: rosters
    rosters
      // Continue the chained call from the previous expression.
      .filter((r) => r.shift.isActive)
      // Continue the chained call from the previous expression.
      .map((r) => [r.employeeId, r.shift] as const),
  );

  // Capture interval by employee for use in this scope.
  const intervalByEmployee = new Map<
    // Run next step: string,
    string,
    // Run next step: {
    {
      // Set status on the structure being built.
      status: AttendanceIntervalStatus;
      // Set startedAt on the structure being built.
      startedAt: Date;
      // Set endedAt on the structure being built.
      endedAt: Date | null;
    }
  // Run next step: >();
  >();
  // Iterate items to apply the same logic to each entry.
  for (const row of intervals) {
    // Branch when this condition holds so the right path runs.
    if (!intervalByEmployee.has(row.employeeId)) {
      // Store a keyed value for later lookup.
      intervalByEmployee.set(row.employeeId, {
        // Set status on the structure being built.
        status: row.status,
        // Set startedAt on the structure being built.
        startedAt: row.startedAt,
        // Set endedAt on the structure being built.
        endedAt: row.endedAt,
      });
    }
  }

  // Capture running by employee for use in this scope.
  const runningByEmployee = new Map(
    // Run next step: runningSessions.map((s) => [
    runningSessions.map((s) => [
      // Run next step: s.employeeId,
      s.employeeId,
      // Run next step: {
      {
        // Set taskId on the structure being built.
        taskId: s.task.id,
        // Set locationId on the structure being built.
        locationId: s.task.locationId,
        // Set locationNumber on the structure being built.
        locationNumber: s.task.location.number,
      },
    ]),
  );

  // Capture count by employee for use in this scope.
  const countByEmployee = new Map(
    // Run next step: taskCounts
    taskCounts
      // Continue the chained call from the previous expression.
      .filter((c) => c.assignedEmployeeId != null)
      // Continue the chained call from the previous expression.
      .map((c) => [c.assignedEmployeeId!, c._count._all] as const),
  );

  // Capture on break by employee for use in this scope.
  const onBreakByEmployee = new Set<string>();
  // Capture break by employee for use in this scope.
  const breakByEmployee = new Map<
    // Run next step: string,
    string,
    // Run next step: Array<{ kind: AttendanceEventKind; normalizedTime: Date }>
    Array<{ kind: AttendanceEventKind; normalizedTime: Date }>
  // Run next step: >();
  >();
  // Iterate items to apply the same logic to each entry.
  for (const ev of breakEvents) {
    // Capture list for use in this scope.
    const list = breakByEmployee.get(ev.employeeId) ?? [];
    // Append an entry to the accumulating collection.
    list.push({ kind: ev.kind, normalizedTime: ev.normalizedTime });
    // Store a keyed value for later lookup.
    breakByEmployee.set(ev.employeeId, list);
  }
  // Iterate items to apply the same logic to each entry.
  for (const id of ids) {
    // Capture interval for use in this scope.
    const interval = intervalByEmployee.get(id);
    // Branch when this condition holds so the right path runs.
    if (
      // Run next step: !interval ||
      !interval ||
      // Run next step: interval.status !== AttendanceIntervalStatus.open ||
      interval.status !== AttendanceIntervalStatus.open ||
      // Run next step: interval.endedAt != null
      interval.endedAt != null
    // Run next step: ) {
    ) {
      // Skip to the next loop iteration.
      continue;
    }
    // Define events as a callable used by this flow.
    const events = (breakByEmployee.get(id) ?? []).filter(
      // Run next step: (e) => e.normalizedTime >= interval.startedAt,
      (e) => e.normalizedTime >= interval.startedAt,
    );
    // Capture open break for use in this scope.
    let openBreak = false;
    // Iterate items to apply the same logic to each entry.
    for (const e of events) {
      // Branch when this condition holds so the right path runs.
      if (e.kind === AttendanceEventKind.break_start) openBreak = true;
      // Handle the alternate condition when prior branches did not match.
      else if (e.kind === AttendanceEventKind.break_end) openBreak = false;
    }
    // Branch when this condition holds so the right path runs.
    if (openBreak) onBreakByEmployee.add(id);
  }

  // Capture result for use in this scope.
  const result: HousekeeperAvailability[] = employees.map((hk) => {
    // Capture shift for use in this scope.
    const shift = rosterByEmployee.get(hk.id) ?? null;
    // Capture running for use in this scope.
    const running = runningByEmployee.get(hk.id) ?? null;
    // Capture classified for use in this scope.
    const classified = classifyAvailability({
      // Set hasRunningSession on the structure being built.
      hasRunningSession: running != null,
      // Set rosterShift on the structure being built.
      rosterShift: shift
        // Complete the ternary or optional chain started above.
        ? { startTime: shift.startTime, endTime: shift.endTime }
        // Complete the ternary or optional chain started above.
        : null,
      // Run next step: nowHhMm,
      nowHhMm,
      // Set interval on the structure being built.
      interval: intervalByEmployee.get(hk.id) ?? null,
      // Set onBreak on the structure being built.
      onBreak: onBreakByEmployee.has(hk.id),
    });

    // Return the computed result to the caller.
    return {
      // Set employeeId on the structure being built.
      employeeId: hk.id,
      // Set fullName on the structure being built.
      fullName: hk.fullName,
      // Set employeeNumber on the structure being built.
      employeeNumber: hk.employeeNumber,
      // Set availabilityStatus on the structure being built.
      availabilityStatus: classified.status,
      // Set availabilityReasons on the structure being built.
      availabilityReasons: classified.reasons,
      // Set currentShift on the structure being built.
      currentShift: shift
        // Complete the ternary or optional chain started above.
        ? {
            // Set id on the structure being built.
            id: shift.id,
            // Set code on the structure being built.
            code: shift.code,
            // Set nameBg on the structure being built.
            nameBg: shift.nameBg,
            // Set nameEn on the structure being built.
            nameEn: shift.nameEn,
            // Set startTime on the structure being built.
            startTime: shift.startTime,
            // Set endTime on the structure being built.
            endTime: shift.endTime,
          }
        // Complete the ternary or optional chain started above.
        : null,
      // Set currentRunningTask on the structure being built.
      currentRunningTask: running,
      // Set assignedTaskCount on the structure being built.
      assignedTaskCount: countByEmployee.get(hk.id) ?? 0,
      // Set sectorEligibility on the structure being built.
      sectorEligibility: "hotel_wide" as const,
      // Run next step: checkedAt,
      checkedAt,
    };
  });

  // Run next step: result.sort(sortHousekeepers);
  result.sort(sortHousekeepers);
  // Return the computed result to the caller.
  return result;
}

// Define sortHousekeepers — core behavior for this module.
function sortHousekeepers(
  // Set a on the structure being built.
  a: HousekeeperAvailability,
  // Set b on the structure being built.
  b: HousekeeperAvailability,
// Run next step: ): number {
): number {
  // Capture by status for use in this scope.
  const byStatus =
    // Run next step: STATUS_SORT[a.availabilityStatus] - STATUS_SORT[b.availabili…
    STATUS_SORT[a.availabilityStatus] - STATUS_SORT[b.availabilityStatus];
  // Branch when this condition holds so the right path runs.
  if (byStatus !== 0) return byStatus;
  // Branch when this condition holds so the right path runs.
  if (a.availabilityStatus === "available") {
    // Capture by load for use in this scope.
    const byLoad = a.assignedTaskCount - b.assignedTaskCount;
    // Branch when this condition holds so the right path runs.
    if (byLoad !== 0) return byLoad;
  }
  // Return the computed result to the caller.
  return a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" });
}

/**
 * List housekeepers with real-time availability for a location (and optional task).
 * Excludes the task's current assignee when taskId is provided.
 */
export async function listAvailableHousekeepers(input: {
  // Set locationId on the structure being built.
  locationId: string;
  // Run next step: taskId?: string | null;
  taskId?: string | null;
  // Run next step: now?: Date;
  now?: Date;
  // Run next step: db?: AssigneeDb;
  db?: AssigneeDb;
// Run next step: }): Promise<AvailableHousekeepersResult> {
}): Promise<AvailableHousekeepersResult> {
  // Capture db for use in this scope.
  const db = input.db ?? prisma;
  // Capture now for use in this scope.
  const now = input.now ?? getHotelNow();
  // Load ops asynchronously for the next steps.
  const ops = await getOperations();
  // Capture time zone for use in this scope.
  const timeZone = ops.hotelTimezone;
  // Capture hotel date ymd for use in this scope.
  const hotelDateYmd = hotelDateString(now, timeZone);
  // Capture hotel date key for use in this scope.
  const hotelDateKey = hotelDateAsUtcDate(now, timeZone);
  // Capture now hh mm for use in this scope.
  const nowHhMm = hotelLocalHhMm(now, timeZone);
  // Capture checked at for use in this scope.
  const checkedAt = now.toISOString();

  // Load location asynchronously for the next steps.
  const location = await db.location.findUnique({
    // Set where on the structure being built.
    where: { id: input.locationId },
    // Set select on the structure being built.
    select: {
      // Set id on the structure being built.
      id: true,
      // Set number on the structure being built.
      number: true,
      // Set sectorMembership on the structure being built.
      sectorMembership: {
        // Set select on the structure being built.
        select: {
          // Set sector on the structure being built.
          sector: {
            // Set select on the structure being built.
            select: { id: true, code: true, nameBg: true, nameEn: true },
          },
        },
      },
    },
  });
  // Branch when this condition holds so the right path runs.
  if (!location) {
    // Abort with an error so callers can react.
    throw new AppError(404, "not_found", "Location not found");
  }

  // Capture exclude employee id for use in this scope.
  let excludeEmployeeId: string | null = null;
  // Branch when this condition holds so the right path runs.
  if (input.taskId) {
    // Load task asynchronously for the next steps.
    const task = await db.cleaningTask.findUnique({
      // Set where on the structure being built.
      where: { id: input.taskId },
      // Set select on the structure being built.
      select: { id: true, locationId: true, assignedEmployeeId: true },
    });
    // Branch when this condition holds so the right path runs.
    if (!task) {
      // Abort with an error so callers can react.
      throw new AppError(404, "not_found", "Task not found");
    }
    // Branch when this condition holds so the right path runs.
    if (task.locationId !== input.locationId) {
      // Abort with an error so callers can react.
      throw new AppError(
        // Run next step: 400,
        400,
        // Run next step: "validation",
        "validation",
        // Run next step: "Task does not belong to the given location",
        "Task does not belong to the given location",
      );
    }
    // Update exclude employee id as control flow progresses.
    excludeEmployeeId = task.assignedEmployeeId;
  }

  // Load housekeepers asynchronously for the next steps.
  const housekeepers = await db.employee.findMany({
    // Set where on the structure being built.
    where: {
      // Set archivedAt on the structure being built.
      archivedAt: null,
      // Set user on the structure being built.
      user: { role: { in: [...CLEANING_ASSIGNEE_ROLES] }, isActive: true },
      // Run next step: ...(excludeEmployeeId ? { id: { not: excludeEmployeeId } } :…
      ...(excludeEmployeeId ? { id: { not: excludeEmployeeId } } : {}),
    },
    // Set select on the structure being built.
    select: { id: true, fullName: true, employeeNumber: true },
    // Set orderBy on the structure being built.
    orderBy: { fullName: "asc" },
  });

  // Branch when this condition holds so the right path runs.
  if (housekeepers.length === 0) {
    // Return the computed result to the caller.
    return {
      // Set locationId on the structure being built.
      locationId: input.locationId,
      // Set taskId on the structure being built.
      taskId: input.taskId ?? null,
      // Set hotelDate on the structure being built.
      hotelDate: hotelDateYmd,
      // Run next step: checkedAt,
      checkedAt,
      // Set housekeepers on the structure being built.
      housekeepers: [],
    };
  }

  // Load result asynchronously for the next steps.
  const result = await buildAvailability({
    // Set employees on the structure being built.
    employees: housekeepers,
    // Run next step: db,
    db,
    // Run next step: now,
    now,
    // Run next step: hotelDateKey,
    hotelDateKey,
    // Run next step: nowHhMm,
    nowHhMm,
    // Run next step: checkedAt,
    checkedAt,
  });

  // Return the computed result to the caller.
  return {
    // Set locationId on the structure being built.
    locationId: input.locationId,
    // Set taskId on the structure being built.
    taskId: input.taskId ?? null,
    // Set hotelDate on the structure being built.
    hotelDate: hotelDateYmd,
    // Run next step: checkedAt,
    checkedAt,
    // Set housekeepers on the structure being built.
    housekeepers: result,
  };
}

/**
 * Evaluate availability for a specific employee without needing a location list.
 * Preferred for reassign validation inside a transaction.
 */
export async function evaluateEmployeeAvailability(
  // Set employeeId on the structure being built.
  employeeId: string,
  // Set opts on the structure being built.
  opts: { now?: Date; db?: AssigneeDb } = {},
// Run next step: ): Promise<HousekeeperAvailability | null> {
): Promise<HousekeeperAvailability | null> {
  // Capture db for use in this scope.
  const db = opts.db ?? prisma;
  // Capture now for use in this scope.
  const now = opts.now ?? getHotelNow();
  // Load ops asynchronously for the next steps.
  const ops = await getOperations();
  // Capture time zone for use in this scope.
  const timeZone = ops.hotelTimezone;
  // Capture hotel date key for use in this scope.
  const hotelDateKey = hotelDateAsUtcDate(now, timeZone);
  // Capture now hh mm for use in this scope.
  const nowHhMm = hotelLocalHhMm(now, timeZone);
  // Capture checked at for use in this scope.
  const checkedAt = now.toISOString();

  // Load employee asynchronously for the next steps.
  const employee = await db.employee.findUnique({
    // Set where on the structure being built.
    where: { id: employeeId },
    // Set select on the structure being built.
    select: {
      // Set id on the structure being built.
      id: true,
      // Set fullName on the structure being built.
      fullName: true,
      // Set employeeNumber on the structure being built.
      employeeNumber: true,
      // Set archivedAt on the structure being built.
      archivedAt: true,
      // Set user on the structure being built.
      user: { select: { role: true, isActive: true } },
    },
  });
  // Branch when this condition holds so the right path runs.
  if (
    // Run next step: employee?.archivedAt ||
    employee?.archivedAt ||
    // Run next step: !employee?.user?.isActive ||
    !employee?.user?.isActive ||
    // Run next step: !CLEANING_ASSIGNEE_ROLES.includes(employee.user.role)
    !CLEANING_ASSIGNEE_ROLES.includes(employee.user.role)
  // Run next step: ) {
  ) {
    // Return the computed result to the caller.
    return null;
  }

  // Load value asynchronously for the next steps.
  const [availability] = await buildAvailability({
    // Set employees on the structure being built.
    employees: [
      // Run next step: {
      {
        // Set id on the structure being built.
        id: employee.id,
        // Set fullName on the structure being built.
        fullName: employee.fullName,
        // Set employeeNumber on the structure being built.
        employeeNumber: employee.employeeNumber,
      },
    ],
    // Run next step: db,
    db,
    // Run next step: now,
    now,
    // Run next step: hotelDateKey,
    hotelDateKey,
    // Run next step: nowHhMm,
    nowHhMm,
    // Run next step: checkedAt,
    checkedAt,
  });
  // Return the computed result to the caller.
  return availability ?? null;
}

/** Assert reassignment target is available, or override is allowed. */
export function assertReassignAvailability(input: {
  // Set availability on the structure being built.
  availability: HousekeeperAvailability | null;
  // Set forceDespiteAvailability on the structure being built.
  forceDespiteAvailability: boolean;
  // Set actorRole on the structure being built.
  actorRole: Role | undefined;
// Run next step: }): void {
}): void {
  // Branch when this condition holds so the right path runs.
  if (!input.availability) {
    // Abort with an error so callers can react.
    throw new AppError(
      // Run next step: 400,
      400,
      // Run next step: "validation",
      "validation",
      // Run next step: "Replacement must be an active housekeeper",
      "Replacement must be an active housekeeper",
    );
  }

  // Branch when this condition holds so the right path runs.
  if (input.availability.availabilityStatus === "available") {
    // Exit early; nothing more to do on this path.
    return;
  }

  // Branch when this condition holds so the right path runs.
  if (input.availability.availabilityStatus === "busy") {
    // Abort with an error so callers can react.
    throw new AppError(
      // Run next step: 409,
      409,
      // Run next step: "availability_conflict",
      "availability_conflict",
      // Run next step: "Replacement is currently performing another cleaning sessio…
      "Replacement is currently performing another cleaning session",
      // Run next step: {
      {
        // Set availabilityStatus on the structure being built.
        availabilityStatus: input.availability.availabilityStatus,
        // Set availabilityReasons on the structure being built.
        availabilityReasons: input.availability.availabilityReasons,
        // Set currentRunningTask on the structure being built.
        currentRunningTask: input.availability.currentRunningTask,
        // Set checkedAt on the structure being built.
        checkedAt: input.availability.checkedAt,
      },
    );
  }

  // Branch when this condition holds so the right path runs.
  if (input.forceDespiteAvailability) {
    // Branch when this condition holds so the right path runs.
    if (
      // Run next step: !input.actorRole ||
      !input.actorRole ||
      // Run next step: !AVAILABILITY_OVERRIDE_ROLES.includes(input.actorRole)
      !AVAILABILITY_OVERRIDE_ROLES.includes(input.actorRole)
    // Run next step: ) {
    ) {
      // Abort with an error so callers can react.
      throw new AppError(
        // Run next step: 403,
        403,
        // Run next step: "forbidden",
        "forbidden",
        // Run next step: "Not authorized to override housekeeper availability",
        "Not authorized to override housekeeper availability",
      );
    }
    // Branch when this condition holds so the right path runs.
    if (!OVERRIDABLE_AVAILABILITY.has(input.availability.availabilityStatus)) {
      // Abort with an error so callers can react.
      throw new AppError(
        // Run next step: 409,
        409,
        // Run next step: "availability_conflict",
        "availability_conflict",
        // Run next step: "This availability status cannot be overridden",
        "This availability status cannot be overridden",
        // Run next step: {
        {
          // Set availabilityStatus on the structure being built.
          availabilityStatus: input.availability.availabilityStatus,
          // Set availabilityReasons on the structure being built.
          availabilityReasons: input.availability.availabilityReasons,
          // Set checkedAt on the structure being built.
          checkedAt: input.availability.checkedAt,
        },
      );
    }
    // Exit early; nothing more to do on this path.
    return;
  }

  // Abort with an error so callers can react.
  throw new AppError(
    // Run next step: 409,
    409,
    // Run next step: "availability_conflict",
    "availability_conflict",
    // Run next step: "Replacement is not currently available",
    "Replacement is not currently available",
    // Run next step: {
    {
      // Set availabilityStatus on the structure being built.
      availabilityStatus: input.availability.availabilityStatus,
      // Set availabilityReasons on the structure being built.
      availabilityReasons: input.availability.availabilityReasons,
      // Set currentRunningTask on the structure being built.
      currentRunningTask: input.availability.currentRunningTask,
      // Set checkedAt on the structure being built.
      checkedAt: input.availability.checkedAt,
    },
  );
}
